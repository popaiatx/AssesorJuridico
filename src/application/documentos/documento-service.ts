/**
 * Serviço de DOCUMENTOS (Passo 12A). Orquestra extrair → (resumir/extrair-chaves) →
 * guardar (Storage + tabela). Tudo escopado por tenant: a posse é decidida na tabela
 * (RLS, via store); o arquivo no Storage usa SEMPRE o caminho `${assinanteId}/${id}/…`.
 *
 * Duas entradas:
 *  - `processarComAcao`: ação já conhecida (legenda direta ou CLI) — passo único.
 *  - `receber` + `decidir`: ação desconhecida → fica `aguardando_decisao` (staging)
 *    e a resposta 1/2/3 resolve depois. Em ambos: SEMPRE extrai chaves ao guardar;
 *    se não há texto (escaneado/imagem), guarda o arquivo e avisa que ficará fora da
 *    busca por conteúdo (marca `sem_texto`). Nunca inventa chaves.
 */
import { randomUUID } from 'node:crypto';
import type { ExtracaoResultado } from '../../adapters/documentos/extractors.js';
import { AVISO, DISCLAIMER_RESUMO, ehOcr, temTexto } from '../../core/domain/documentos/formato.js';
import type { DocAcao } from '../../core/domain/documentos/decisao.js';
import { PERGUNTA_DECISAO } from '../../core/domain/documentos/decisao.js';
import type { DocumentoStore } from '../../core/ports/documentos.js';
import type { EmbeddingsPort } from '../../core/ports/embeddings.js';
import type { LlmPort } from '../../core/ports/llm.js';
import type { OcrPort } from '../../core/ports/ocr.js';
import type { StoragePort } from '../../core/ports/storage.js';
import { buscaTextoDe, extrairChaves } from './extrair-chaves.js';
import { extrairComOcr, type ExtrairComOcrDeps } from './extrair-com-ocr.js';
import { resumir } from './resumir.js';

const OCR_MIN_CONFIANCA_PADRAO = 60;
const OCR_MAX_PAGINAS_PADRAO = 3;

const DISCLAIMER = DISCLAIMER_RESUMO;

interface Logger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface DocumentoEntrada {
  bytes: Uint8Array;
  filename: string;
  contentType: string | null;
  legenda?: string | null;
  /** CNJ para vincular a um processo (resolvido por tenant; inexistente → solto). */
  numeroCnj?: string | null;
}

export interface DocumentoServiceDeps {
  storage: StoragePort;
  store: DocumentoStore;
  llm: LlmPort;
  /** Embeddings p/ a busca semântica do 12B. Ausente → guarda sem embedding
   *  (achável só pela busca exata); o backfill (doc:reindex) preenche depois. */
  embeddings?: EmbeddingsPort;
  /** Tamanho máximo aceito por documento (bytes). Acima disso, recusa com aviso
   *  ANTES de subir/extrair. Ausente → sem limite na aplicação. */
  maxBytes?: number;
  /** OCR local (Passo 13) — 2ª tentativa quando a extração nativa falha (imagem/PDF
   *  escaneado). Ausente → escaneado continua `sem_texto`, como antes. */
  ocr?: OcrPort;
  ocrMinConfianca?: number;
  ocrMaxPaginas?: number;
  resolveProcessoId: (assinanteId: string, numeroCnj: string) => Promise<string | null>;
  extrair?: (bytes: Uint8Array, filename: string, ct: string | null) => Promise<ExtracaoResultado>;
  novoId?: () => string;
  logger: Logger;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitize(nome: string): string {
  return (nome || 'arquivo').replace(/[^\w.\-]+/g, '_').slice(0, 120);
}

export class DocumentoService {
  constructor(private readonly deps: DocumentoServiceDeps) {}

  private extrair(e: DocumentoEntrada, maxPaginas?: number): Promise<ExtracaoResultado> {
    return extrairComOcr(e.bytes, e.filename, e.contentType, this.ocrDeps(maxPaginas));
  }

  /** Deps para a extração com OCR (2ª tentativa). Espalha opcionais só quando há. */
  private ocrDeps(maxPaginas?: number): ExtrairComOcrDeps {
    return {
      ...(this.deps.extrair ? { extrair: this.deps.extrair } : {}),
      ...(this.deps.ocr ? { ocr: this.deps.ocr } : {}),
      ocrMinConfianca: this.deps.ocrMinConfianca ?? OCR_MIN_CONFIANCA_PADRAO,
      ocrMaxPaginas: maxPaginas ?? this.deps.ocrMaxPaginas ?? OCR_MAX_PAGINAS_PADRAO,
      logger: this.deps.logger,
    };
  }

  /** Nota de OCR (transparência) quando o texto veio de OCR; senão ''. */
  private notaOcr(ex: ExtracaoResultado): string {
    return ehOcr(ex.status) && ex.aviso ? `\n\n${ex.aviso}` : '';
  }

  /** Retorna aviso se o arquivo excede o limite; null se estiver ok. */
  private excedeLimite(bytes: Uint8Array): string | null {
    const max = this.deps.maxBytes;
    if (!max || bytes.length <= max) return null;
    return (
      `📎 Esse arquivo é grande demais (${mb(bytes.length)}; o limite é ${mb(max)}). ` +
      'Envie uma versão menor ou comprima o arquivo.'
    );
  }

  private async resolverProcesso(
    assinanteId: string,
    numeroCnj: string | null | undefined,
  ): Promise<{ processoId: string | null; aviso: string }> {
    if (!numeroCnj) return { processoId: null, aviso: '' };
    const processoId = await this.deps.resolveProcessoId(assinanteId, numeroCnj);
    return processoId
      ? { processoId, aviso: '' }
      : { processoId: null, aviso: ' (não achei esse processo; guardei solto)' };
  }

  /** Ação conhecida (legenda direta ou CLI): faz tudo num passo. */
  async processarComAcao(
    assinanteId: string,
    entrada: DocumentoEntrada,
    acao: DocAcao,
  ): Promise<string> {
    const grande = this.excedeLimite(entrada.bytes);
    if (grande) return grande;
    const ex = await this.extrair(entrada);

    if (acao === 'resumir') {
      if (!temTexto(ex.status)) return ex.aviso ?? AVISO.falha; // não dá p/ resumir; nada guardado
      const resumo = await resumir(this.deps.llm, ex.texto);
      return `${resumo}\n\n${DISCLAIMER}${this.notaOcr(ex)}\n\n(Não guardei no acervo — você pediu só o resumo. Para guardar, é só pedir "salvar".)`;
    }

    // salvar | ambos → persiste o arquivo + extrai chaves (sempre que dá)
    const id = (this.deps.novoId ?? randomUUID)();
    const nome = entrada.filename || 'arquivo';
    const { processoId, aviso: avisoProc } = await this.resolverProcesso(assinanteId, entrada.numeroCnj);
    const path = `${assinanteId}/${id}/${sanitize(nome)}`;
    const { storageRef } = await this.deps.storage.putDocument({
      assinanteId,
      path,
      content: entrada.bytes,
      contentType: entrada.contentType ?? 'application/octet-stream',
    });
    await this.deps.store.inserir(assinanteId, {
      id,
      nome,
      tipo: entrada.contentType,
      storageRef,
      processoId,
      legenda: entrada.legenda ?? null,
      status: 'guardado',
    });
    return this.finalizarGuarda(assinanteId, id, ex, acao, avisoProc);
  }

  /** Ação desconhecida: sobe o arquivo (staging) e pergunta 1/2/3. */
  async receber(assinanteId: string, entrada: DocumentoEntrada): Promise<string> {
    const grande = this.excedeLimite(entrada.bytes);
    if (grande) return grande;
    const id = (this.deps.novoId ?? randomUUID)();
    const nome = entrada.filename || 'arquivo';
    const path = `${assinanteId}/${id}/${sanitize(nome)}`;
    const { storageRef } = await this.deps.storage.putDocument({
      assinanteId,
      path,
      content: entrada.bytes,
      contentType: entrada.contentType ?? 'application/octet-stream',
    });
    await this.deps.store.inserir(assinanteId, {
      id,
      nome,
      tipo: entrada.contentType,
      storageRef,
      processoId: null,
      legenda: entrada.legenda ?? null,
      status: 'aguardando_decisao',
    });
    return PERGUNTA_DECISAO;
  }

  /** Resolve a decisão (1/2/3) sobre o documento em staging. Re-verifica o dono. */
  async decidir(assinanteId: string, docId: string, acao: DocAcao): Promise<string> {
    const row = await this.deps.store.getById(assinanteId, docId); // RLS: só o dono
    if (!row) return 'Não encontrei mais esse documento.';

    let bytes: Uint8Array;
    try {
      bytes = await this.deps.storage.getDocument(row.storageRef);
    } catch (err) {
      this.deps.logger.error({ err, docId }, 'documentos: falha ao baixar staging');
      return AVISO.falha;
    }
    const ex = await this.extrair({ bytes, filename: row.nome, contentType: row.tipo });

    if (acao === 'resumir') {
      // Só resumir: mostra e NÃO guarda (apaga o staging).
      const resumo = temTexto(ex.status) ? await resumir(this.deps.llm, ex.texto) : null;
      const ref = await this.deps.store.remover(assinanteId, docId);
      if (ref) await this.deps.storage.deleteDocument(ref).catch(() => {});
      return resumo
        ? `${resumo}\n\n${DISCLAIMER}${this.notaOcr(ex)}\n\n(Não guardei no acervo — você pediu só o resumo.)`
        : `${ex.aviso ?? AVISO.falha}\n\n(Não guardei no acervo.)`;
    }
    // salvar | ambos: promove o staging a guardado (com ou sem chaves)
    return this.finalizarGuarda(assinanteId, docId, ex, acao, '');
  }

  /** Grava chaves/resumo (ou marca sem_texto) e devolve a resposta ao usuário. */
  private async finalizarGuarda(
    assinanteId: string,
    docId: string,
    ex: ExtracaoResultado,
    acao: DocAcao,
    avisoProc: string,
  ): Promise<string> {
    if (!temTexto(ex.status)) {
      await this.deps.store.gravarConteudo(assinanteId, docId, {
        chaves: null,
        resumo: null,
        extracaoStatus: ex.status,
        buscaTexto: null,
        embedding: null, // sem texto → sem embedding (achável só por nome/data)
      });
      return `📎 Guardei o arquivo${avisoProc}. ${ex.aviso ?? ''} ${AVISO.guardadoSemTexto}`.trim();
    }
    const chaves = await extrairChaves(this.deps.llm, ex.texto);
    const resumo = acao === 'ambos' ? await resumir(this.deps.llm, ex.texto) : null;
    const buscaTexto = buscaTextoDe(chaves);
    const embedding = await this.embeddingDe(buscaTexto, docId);
    await this.deps.store.gravarConteudo(assinanteId, docId, {
      chaves,
      resumo,
      extracaoStatus: ex.status, // 'ok' | 'ok_ocr' | 'ok_ocr_parcial'
      buscaTexto,
      embedding,
    });
    const tipo = chaves.tipo ? ` (${chaves.tipo})` : '';
    const guardei = `📎 Guardei no seu acervo${tipo}${avisoProc}.`;
    const corpo = resumo ? `${resumo}\n\n${DISCLAIMER}\n\n${guardei}` : guardei;
    return corpo + this.notaOcr(ex); // transparência: avisa quando o texto veio de OCR
  }

  /**
   * Re-OCR de um documento `sem_texto` já guardado (Passo 13; usado pela CLI doc:ocr).
   * Idempotente: só reprocessa quem ainda não tem texto. Isolamento: getById confirma
   * a posse por tenant ANTES de baixar do Storage (nunca toca arquivo de outro dono).
   * `maxPaginas` pode ser maior aqui (offline não trava a conversa).
   */
  async reprocessarOcr(
    assinanteId: string,
    docId: string,
    maxPaginas?: number,
  ): Promise<{ ok: boolean; status: string; mensagem: string }> {
    const row = await this.deps.store.getById(assinanteId, docId); // RLS: só o dono
    if (!row) return { ok: false, status: 'nao_encontrado', mensagem: 'documento não encontrado' };
    if (temTexto(row.extracaoStatus)) {
      return { ok: false, status: 'ja_tem_texto', mensagem: 'já tinha texto (pulado)' };
    }
    if (!this.deps.ocr) return { ok: false, status: 'ocr_off', mensagem: 'OCR desabilitado' };

    let bytes: Uint8Array;
    try {
      bytes = await this.deps.storage.getDocument(row.storageRef);
    } catch (err) {
      this.deps.logger.error({ err, docId }, 're-OCR: falha ao baixar do Storage');
      return { ok: false, status: 'falha_download', mensagem: 'falha ao baixar o arquivo' };
    }
    const ex = await extrairComOcr(bytes, row.nome, row.tipo, this.ocrDeps(maxPaginas));
    if (!temTexto(ex.status)) {
      return { ok: false, status: 'sem_texto', mensagem: ex.aviso ?? 'segue sem texto legível' };
    }
    // Reaproveita o pipeline normal (chaves + resumo + embedding), persistindo o status OCR.
    await this.finalizarGuarda(assinanteId, docId, ex, 'ambos', '');
    return { ok: true, status: ex.status, mensagem: `OCR aplicado (${ex.status})` };
  }

  /** Embedding do busca_texto p/ a busca semântica (12B). Falha NÃO perde o
   *  documento: loga e devolve null (achável pela exata; doc:reindex preenche). */
  private async embeddingDe(buscaTexto: string | null, docId: string): Promise<number[] | null> {
    if (!this.deps.embeddings || !buscaTexto) return null;
    try {
      const [vetor] = await this.deps.embeddings.embed([buscaTexto]);
      return vetor ?? null;
    } catch (err) {
      this.deps.logger.error({ err, docId }, 'documentos: falha ao gerar embedding (segue sem)');
      return null;
    }
  }
}

/**
 * Resumo de documento JÁ GUARDADO (Passo 12C). Dado um documento do acervo:
 *  - PADRÃO ('guardado'): devolve o `resumo` já salvo (instantâneo, sem LLM); se o
 *    documento é `ok` mas ainda não tem resumo, gera relendo do Storage e PERSISTE
 *    (acervo mais rico; próxima vez é instantânea).
 *  - SOB DEMANDA ('novo'/`foco`): gera um resumo novo relendo o Storage (map-reduce
 *    p/ doc longo), com foco custom; NÃO persiste (é one-off).
 *
 * ISOLAMENTO (mesma disciplina do 12A/12B): a posse é confirmada por tenant via
 * `getById` (RLS, withTenant). SÓ depois disso o arquivo é relido do Storage, e
 * sempre pelo `storageRef` da PRÓPRIA linha do tenant — nunca de id/ref vindo do
 * usuário/LLM. `setResumo` também é escopado por tenant. Documento de outro dono →
 * `getById` devolve null → nada é lido nem gerado.
 */
import { extrairTexto, type ExtracaoResultado } from '../../adapters/documentos/extractors.js';
import { AVISO, DISCLAIMER_RESUMO } from '../../core/domain/documentos/formato.js';
import type { DocumentoResumoStore } from '../../core/ports/documentos.js';
import type { LlmPort } from '../../core/ports/llm.js';
import type { StoragePort } from '../../core/ports/storage.js';
import { resumir } from './resumir.js';

interface Logger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

export type ModoResumo = 'guardado' | 'novo';

export interface PedidoResumo {
  /** 'guardado' (default) = usa o resumo salvo; 'novo' = regenera relendo o Storage. */
  modo?: ModoResumo;
  /** Foco custom ("prazos", "valores"…). Se presente, força modo 'novo'. */
  foco?: string;
}

export interface ResumirDocumentoDeps {
  store: DocumentoResumoStore;
  storage: StoragePort;
  llm: LlmPort;
  /** Extrator injetável (testes); default = extrairTexto (pdf/docx/txt). */
  extrair?: (bytes: Uint8Array, filename: string, ct: string | null) => Promise<ExtracaoResultado>;
  logger: Logger;
}

export class ResumirDocumento {
  constructor(private readonly deps: ResumirDocumentoDeps) {}

  /**
   * Resume o documento `docId` do `assinanteId`. Retorna o texto pronto para o
   * usuário (resumo + aviso de apoio, ou um aviso claro). Isolamento garantido:
   * `getById` re-verifica a posse antes de qualquer leitura do arquivo.
   */
  async resumirPorId(assinanteId: string, docId: string, pedido: PedidoResumo = {}): Promise<string> {
    const row = await this.deps.store.getById(assinanteId, docId); // RLS: null se não for dono
    if (!row) return AVISO.naoEncontrado;

    const foco = pedido.foco?.trim() ? pedido.foco.trim() : undefined;
    const modo: ModoResumo = foco ? 'novo' : (pedido.modo ?? 'guardado');

    // PADRÃO: resumo guardado, instantâneo (sem nova chamada de LLM).
    if (modo === 'guardado' && row.resumo && row.resumo.trim()) {
      return comAviso(row.resumo.trim());
    }

    // Documento sem texto (escaneado/imagem) → não há como resumir.
    if (row.extracaoStatus !== 'ok') return AVISO.semTextoResumo;

    // Precisa gerar: RELÊ do Storage SÓ com a posse confirmada (row veio do getById).
    let bytes: Uint8Array;
    try {
      bytes = await this.deps.storage.getDocument(row.storageRef);
    } catch (err) {
      this.deps.logger.error({ err, docId }, 'resumo 12C: falha ao reler do Storage');
      return AVISO.falhaRelerResumo;
    }
    const ex = await (this.deps.extrair ?? extrairTexto)(bytes, row.nome, row.tipo);
    if (ex.status !== 'ok') return AVISO.semTextoResumo;

    const resumo = await resumir(this.deps.llm, ex.texto, foco);

    // PADRÃO sem resumo salvo → persiste (escopado por tenant). 'novo'/foco → não.
    if (modo === 'guardado') {
      await this.deps.store.setResumo(assinanteId, docId, resumo).catch(() => {});
    }
    return comAviso(resumo);
  }
}

function comAviso(resumo: string): string {
  return `${resumo}\n\n${DISCLAIMER_RESUMO}`;
}

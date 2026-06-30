/**
 * Motor de SINCRONIZAÇÃO do corpus (Cérebro 2 / Passo 8B). É o MESMO código usado
 * pela ingestão inicial e pelo sync periódico (a ingestão é um sync com `force`).
 *
 * Por norma do escopo curado:
 *   buscar texto (fonte) → normalizar → hash → comparar com o armazenado
 *     (igual = skip idempotente; diferente/nova/force = re-chunk + re-embed só dela)
 *   → detectar vigência/revogação (defensivo) → gravar metadados de sync.
 *
 * Robustez: try/catch POR NORMA. Falha de uma (ex.: fonte offline) não corrompe o
 * corpus existente (só substituímos trechos APÓS baixar+embedar com sucesso) nem
 * aborta as demais; o erro vai para o run e é re-tentado na próxima cadência.
 * Back-office: escreve via `CorpusSyncStore` (pool), fora do caminho da mensagem.
 */
import { createHash } from 'node:crypto';
import { chunkLegislacao, type LegChunk } from '../../core/domain/cerebro2/chunk-legislacao.js';
import type { CorpusSyncStore, SyncRunResult } from '../../core/ports/corpus.js';
import type { EmbeddingsPort } from '../../core/ports/embeddings.js';
import type { NormaRef, SourcePort } from '../../core/ports/source.js';

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

const noopLogger: Logger = { info: () => {}, error: () => {} };

const EMBED_BATCH = 64;

export interface SyncCorpusDeps {
  source: SourcePort;
  embeddings: EmbeddingsPort;
  store: CorpusSyncStore;
  /** Relógio injetável (datas de sync/revogação determinísticas em teste). */
  now?: () => Date;
  /** Hash do texto normalizado (default SHA-256 hex). */
  hash?: (texto: string) => string;
  chunk?: (texto: string, meta: { sigla?: string; identificador: string; fonteUrl: string | null }) => LegChunk[];
  logger?: Logger;
}

export interface SyncCorpusOptions {
  /** Re-embeda mesmo sem mudança de hash (ingestão/reconstrução). */
  force?: boolean;
  /** Sincroniza só a norma com este identificador. */
  identificador?: string;
  /** Rótulo da fonte para a auditoria do run. */
  fonte?: string;
}

function normalizeForHash(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/** Mensagem de erro legível, expondo a CAUSA (ex.: ECONNRESET de um fetch falho),
 *  que de outro modo fica escondida atrás de um genérico "fetch failed". */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      const code = (cause as { code?: unknown }).code;
      const codeStr = typeof code === 'string' ? `${code}: ` : '';
      return `${err.message} — ${codeStr}${cause.message}`;
    }
    return err.message;
  }
  return String(err);
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function embedInBatches(embeddings: EmbeddingsPort, textos: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < textos.length; i += EMBED_BATCH) {
    const vetores = await embeddings.embed(textos.slice(i, i + EMBED_BATCH));
    out.push(...vetores);
  }
  return out;
}

export async function syncCorpus(
  deps: SyncCorpusDeps,
  opts: SyncCorpusOptions = {},
): Promise<SyncRunResult> {
  const now = deps.now ?? (() => new Date());
  const hash = deps.hash ?? sha256;
  const chunk = deps.chunk ?? chunkLegislacao;
  const logger = deps.logger ?? noopLogger;
  const fonte = opts.fonte ?? 'planalto';

  const result: SyncRunResult = {
    status: 'sucesso',
    normasVerificadas: 0,
    normasAtualizadas: 0,
    normasRevogadas: 0,
    erros: [],
  };

  const runId = await deps.store.startRun(fonte);

  let refs: NormaRef[] = await deps.source.listNormas();
  if (opts.identificador) {
    refs = refs.filter((r) => r.identificador === opts.identificador);
    if (refs.length === 0) {
      result.erros.push({
        identificador: opts.identificador,
        erro: 'identificador não encontrado no escopo curado (manifesto).',
      });
      result.status = 'erro';
    }
  }

  for (const ref of refs) {
    result.normasVerificadas += 1;
    try {
      const conteudo = await deps.source.fetchNorma(ref);
      const novoHash = hash(normalizeForHash(conteudo.texto));
      const estado = await deps.store.getNormaState(ref.identificador);

      // Vigência defensiva e "sticky": só marca revogada com sinal forte; e nunca
      // RESSUSCITA em silêncio (se já estava revogada e o marcador some, mantém
      // revogada e registra aviso para revisão humana).
      let vigencia: 'vigente' | 'revogada' = conteudo.vigenciaStatus;
      let revogadaEm: string | null = null;
      const eraRevogada = estado?.vigenciaStatus === 'revogada';
      if (vigencia === 'revogada') {
        if (!eraRevogada) {
          result.normasRevogadas += 1;
          revogadaEm = isoDate(now()); // transição vigente → revogada
          logger.info({ identificador: ref.identificador }, 'sync: norma marcada revogada');
        }
      } else if (eraRevogada) {
        vigencia = 'revogada'; // mantém
        result.erros.push({
          identificador: ref.identificador,
          erro: 'marcador de revogação não encontrado nesta sync; mantida REVOGADA para revisão.',
        });
      }

      const normaId = await deps.store.upsertNorma({
        tipo: ref.tipo,
        titulo: ref.titulo,
        identificador: ref.identificador,
        dataPublicacao: ref.dataPublicacao,
        vigenciaStatus: vigencia,
        fonteUrl: ref.fonteUrl,
      });

      const mudou = !estado || estado.fonteHash !== novoHash || Boolean(opts.force);
      if (mudou) {
        const chunks = chunk(conteudo.texto, {
          ...(ref.sigla !== undefined ? { sigla: ref.sigla } : {}),
          identificador: ref.identificador,
          fonteUrl: ref.fonteUrl,
        });
        if (chunks.length === 0) {
          // Não apaga o que já existe por um parser vazio: registra e segue.
          result.erros.push({
            identificador: ref.identificador,
            erro: '0 trechos extraídos (parser/URL); trechos existentes preservados.',
          });
        } else {
          const vetores = await embedInBatches(
            deps.embeddings,
            chunks.map((c) => c.texto),
          );
          const trechos = chunks.map((c, i) => ({
            artigo: c.artigo,
            paragrafo: c.paragrafo,
            inciso: c.inciso,
            ordem: c.ordem,
            texto: c.texto,
            citacao: c.citacao,
            fonteUrl: ref.fonteUrl,
            embedding: vetores[i]!,
          }));
          await deps.store.replaceTrechos(normaId, trechos);
          result.normasAtualizadas += 1;
        }
      }

      await deps.store.updateNormaSync(normaId, {
        fonteHash: novoHash,
        fonteVersao: conteudo.fonteVersao,
        ultimaSincronizacao: now().toISOString(),
        revogadaEm,
      });
    } catch (err) {
      // Resiliência por norma: corpus daquela norma fica intacto; segue as demais.
      result.status = result.status === 'erro' ? 'erro' : 'parcial';
      const msg = describeError(err);
      result.erros.push({ identificador: ref.identificador, erro: msg });
      logger.error({ identificador: ref.identificador, err: msg }, 'sync: falha na norma');
    }
  }

  await deps.store.finishRun(runId, result);
  return result;
}

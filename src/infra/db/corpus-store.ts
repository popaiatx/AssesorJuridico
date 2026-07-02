/**
 * Acesso ao corpus jurídico (Cérebro 2).
 *
 *  - Busca (caminho da mensagem): leitura PÚBLICA via `pool` — corpus não é por
 *    tenant, não precisa de `withTenant`.
 *  - Ingestão (back-office): upsert de norma + (re)inserção de trechos, via `pool`.
 *    Não usa service_role; corpus não tem RLS de tenant.
 */
import { pool } from './pool.js';
import type {
  CorpusTrecho,
  NormaInput,
  NormaSyncState,
  NormaSyncUpdate,
  SyncRunResult,
  TrechoInput,
} from '../../core/ports/corpus.js';

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function searchCorpus(embedding: number[], k: number): Promise<CorpusTrecho[]> {
  const vec = vectorLiteral(embedding);
  const rows = await pool<
    {
      citacao: string;
      texto: string;
      fonte_url: string | null;
      similarity: number;
      vigencia_status: string | null;
    }[]
  >`
    select t.citacao, t.texto, t.fonte_url,
           1 - (t.embedding <=> ${vec}::vector) as similarity,
           n.vigencia_status
    from corpus_trechos t
    join corpus_normas n on n.id = t.norma_id
    where t.embedding is not null
    order by t.embedding <=> ${vec}::vector
    limit ${k}
  `;
  return rows.map((r) => ({
    citacao: r.citacao,
    texto: r.texto,
    fonteUrl: r.fonte_url,
    similarity: Number(r.similarity),
    vigenciaStatus: r.vigencia_status,
  }));
}

/** Ingestão: cria/atualiza a norma (por identificador) e retorna o id. */
export async function upsertNorma(n: NormaInput): Promise<string> {
  const rows = await pool<{ id: string }[]>`
    insert into corpus_normas
      (tipo, titulo, identificador, data_publicacao, vigencia_status, fonte_url)
    values
      (${n.tipo}, ${n.titulo}, ${n.identificador}, ${n.dataPublicacao}::date,
       ${n.vigenciaStatus}, ${n.fonteUrl})
    on conflict (identificador) do update
      set tipo = excluded.tipo, titulo = excluded.titulo,
          data_publicacao = excluded.data_publicacao,
          vigencia_status = excluded.vigencia_status, fonte_url = excluded.fonte_url
    returning id
  `;
  return rows[0]!.id;
}

// Trechos inseridos por statement (multi-row via unnest). Mantém a requisição num
// tamanho saudável (cada embedding é grande) e corta milhares de round-trips para poucos.
const INSERT_BATCH = 200;

/** Ingestão/sync: substitui TODOS os trechos da norma (delete + insert em LOTE) numa
 *  ÚNICA transação, para nunca deixar a norma sem trechos por falha parcial.
 *  Insere em multi-row (unnest) — muito mais rápido que um INSERT por trecho. */
export async function replaceTrechos(normaId: string, trechos: TrechoInput[]): Promise<void> {
  await pool.begin(async (tx) => {
    await tx`delete from corpus_trechos where norma_id = ${normaId}`;
    for (let i = 0; i < trechos.length; i += INSERT_BATCH) {
      const slice = trechos.slice(i, i + INSERT_BATCH);
      const artigo = slice.map((t) => t.artigo);
      const paragrafo = slice.map((t) => t.paragrafo);
      const inciso = slice.map((t) => t.inciso);
      const ordem = slice.map((t) => t.ordem);
      const texto = slice.map((t) => t.texto);
      const citacao = slice.map((t) => t.citacao);
      const fonteUrl = slice.map((t) => t.fonteUrl);
      const embedding = slice.map((t) => vectorLiteral(t.embedding));
      await tx`
        insert into corpus_trechos
          (norma_id, artigo, paragrafo, inciso, ordem, texto, citacao, fonte_url, embedding)
        select ${normaId}, a, p, inc, ord, txt, cit, url, emb::vector
        from unnest(
          ${artigo}::text[], ${paragrafo}::text[], ${inciso}::text[],
          ${ordem}::int[], ${texto}::text[], ${citacao}::text[],
          ${fonteUrl}::text[], ${embedding}::text[]
        ) as t(a, p, inc, ord, txt, cit, url, emb)
      `;
    }
  });
}

// --- Sincronização (Passo 8B, back-office) ---

// Chave do advisory lock que serializa o sync do corpus (evita execução concorrente).
const SYNC_LOCK_KEY = 8201;

/**
 * Executa `fn` segurando um advisory lock dedicado: se outra sync já está em
 * andamento, NÃO roda e retorna `null`. Usa uma conexão reservada (o pooler em modo
 * transaction não mantém lock de sessão entre statements de conexões diferentes).
 */
export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const reserved = await pool.reserve();
  try {
    const got = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${SYNC_LOCK_KEY}) as locked
    `;
    if (!got[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await reserved`select pg_advisory_unlock(${SYNC_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
}

/** Estado de sync de uma norma, lido por identificador (null se ainda não existe). */
export async function getNormaSyncState(identificador: string): Promise<NormaSyncState | null> {
  const rows = await pool<
    { id: string; fonte_hash: string | null; vigencia_status: string | null }[]
  >`
    select id, fonte_hash, vigencia_status
    from corpus_normas
    where identificador = ${identificador}
  `;
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, fonteHash: r.fonte_hash, vigenciaStatus: r.vigencia_status };
}

/** Atualiza os metadados de sync da norma (hash/versão/última sync + revogação). */
export async function updateNormaSync(normaId: string, s: NormaSyncUpdate): Promise<void> {
  // coalesce em revogada_em: passar null PRESERVA a data anterior (nunca apaga uma
  // revogação já registrada num re-sync); passar uma data registra a transição.
  await pool`
    update corpus_normas set
      fonte_hash = ${s.fonteHash},
      fonte_versao = ${s.fonteVersao},
      ultima_sincronizacao = ${s.ultimaSincronizacao}::timestamptz,
      revogada_em = coalesce(${s.revogadaEm}::date, revogada_em)
    where id = ${normaId}
  `;
}

/** Quantidade de trechos de uma norma (apoio a verificação/idempotência). */
export async function countTrechos(normaId: string): Promise<number> {
  const rows = await pool<{ n: number }[]>`
    select count(*)::int as n from corpus_trechos where norma_id = ${normaId}
  `;
  return rows[0]?.n ?? 0;
}

/** Abre um registro de execução de sync e retorna seu id. */
export async function startSyncRun(fonte: string): Promise<string> {
  const rows = await pool<{ id: string }[]>`
    insert into corpus_sync_runs (fonte) values (${fonte}) returning id
  `;
  return rows[0]!.id;
}

/** Fecha o registro de execução de sync com o resultado. */
export async function finishSyncRun(id: string, r: SyncRunResult): Promise<void> {
  await pool`
    update corpus_sync_runs set
      finalizado_em = now(),
      status = ${r.status},
      normas_verificadas = ${r.normasVerificadas},
      normas_atualizadas = ${r.normasAtualizadas},
      normas_revogadas = ${r.normasRevogadas},
      erros = ${r.erros as never}::jsonb
    where id = ${id}
  `;
}

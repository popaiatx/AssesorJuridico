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

/** Ingestão: remove os trechos da norma (reingestão substitui). */
export async function deleteTrechos(normaId: string): Promise<void> {
  await pool`delete from corpus_trechos where norma_id = ${normaId}`;
}

/** Ingestão: insere um trecho com seu embedding. */
export async function insertTrecho(normaId: string, t: TrechoInput): Promise<void> {
  await pool`
    insert into corpus_trechos
      (norma_id, artigo, paragrafo, inciso, ordem, texto, citacao, fonte_url, embedding)
    values
      (${normaId}, ${t.artigo}, ${t.paragrafo}, ${t.inciso}, ${t.ordem}, ${t.texto},
       ${t.citacao}, ${t.fonteUrl}, ${vectorLiteral(t.embedding)}::vector)
  `;
}

/** Ingestão/sync: substitui TODOS os trechos da norma (delete + insert) numa
 *  ÚNICA transação, para nunca deixar a norma sem trechos por falha parcial. */
export async function replaceTrechos(normaId: string, trechos: TrechoInput[]): Promise<void> {
  await pool.begin(async (tx) => {
    await tx`delete from corpus_trechos where norma_id = ${normaId}`;
    for (const t of trechos) {
      await tx`
        insert into corpus_trechos
          (norma_id, artigo, paragrafo, inciso, ordem, texto, citacao, fonte_url, embedding)
        values
          (${normaId}, ${t.artigo}, ${t.paragrafo}, ${t.inciso}, ${t.ordem}, ${t.texto},
           ${t.citacao}, ${t.fonteUrl}, ${vectorLiteral(t.embedding)}::vector)
      `;
    }
  });
}

// --- Sincronização (Passo 8B, back-office) ---

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
      erros = ${JSON.stringify(r.erros)}::jsonb
    where id = ${id}
  `;
}

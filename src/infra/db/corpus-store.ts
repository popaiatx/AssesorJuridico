/**
 * Acesso ao corpus jurídico (Cérebro 2).
 *
 *  - Busca (caminho da mensagem): leitura PÚBLICA via `pool` — corpus não é por
 *    tenant, não precisa de `withTenant`.
 *  - Ingestão (back-office): upsert de norma + (re)inserção de trechos, via `pool`.
 *    Não usa service_role; corpus não tem RLS de tenant.
 */
import { pool } from './pool.js';
import type { CorpusTrecho, NormaInput, TrechoInput } from '../../core/ports/corpus.js';

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function searchCorpus(embedding: number[], k: number): Promise<CorpusTrecho[]> {
  const vec = vectorLiteral(embedding);
  const rows = await pool<
    { citacao: string; texto: string; fonte_url: string | null; similarity: number }[]
  >`
    select citacao, texto, fonte_url, 1 - (embedding <=> ${vec}::vector) as similarity
    from corpus_trechos
    where embedding is not null
    order by embedding <=> ${vec}::vector
    limit ${k}
  `;
  return rows.map((r) => ({
    citacao: r.citacao,
    texto: r.texto,
    fonteUrl: r.fonte_url,
    similarity: Number(r.similarity),
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

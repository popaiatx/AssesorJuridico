/**
 * Store de DOCUMENTOS — metadados + chaves por TENANT, via withTenant (RLS,
 * sem service_role). O service_role só toca o ARQUIVO no Storage; "de quem é o
 * documento" é decidido AQUI (RLS). O `assinante_id` vem sempre da identidade.
 */
import { pool } from './pool.js';
import { withTenant } from './tenant.js';
import type {
  ConteudoExtraido,
  DocumentoResultado,
  DocumentoRow,
  ExtracaoStatus,
  KeyInfo,
  NovoDocumento,
} from '../../core/ports/documentos.js';

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

interface DbDoc {
  id: string;
  nome: string;
  tipo: string | null;
  storage_ref: string;
  processo_id: string | null;
  chaves: KeyInfo | null;
  resumo: string | null;
  extracao_status: string;
  status: string;
}

function toRow(r: DbDoc): DocumentoRow {
  return {
    id: r.id,
    nome: r.nome,
    tipo: r.tipo,
    storageRef: r.storage_ref,
    processoId: r.processo_id,
    chaves: r.chaves ?? null,
    resumo: r.resumo,
    extracaoStatus: (r.extracao_status as ExtracaoStatus) ?? 'ok',
    status: r.status,
  };
}

export async function inserirDocumento(assinanteId: string, doc: NovoDocumento): Promise<void> {
  await withTenant(assinanteId, async (tx) => {
    await tx`
      insert into documentos
        (id, assinante_id, processo_id, nome, tipo, storage_ref, status, legenda)
      values
        (${doc.id}, ${assinanteId}, ${doc.processoId}, ${doc.nome}, ${doc.tipo},
         ${doc.storageRef}, ${doc.status}, ${doc.legenda})
    `;
  });
}

export async function gravarConteudoDocumento(
  assinanteId: string,
  id: string,
  c: ConteudoExtraido,
): Promise<boolean> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update documentos set
        chaves = ${c.chaves === null ? null : JSON.stringify(c.chaves)}::jsonb,
        resumo = ${c.resumo},
        extracao_status = ${c.extracaoStatus},
        busca_texto = ${c.buscaTexto},
        embedding = ${c.embedding === null ? null : vectorLiteral(c.embedding)}::vector,
        status = 'guardado'
      where id = ${id} and assinante_id = ${assinanteId}
      returning id
    `;
    return rows.length > 0;
  });
}

/** Persiste o resumo gerado (Passo 12C) — escopado por tenant (RLS). */
export async function setResumoDocumento(
  assinanteId: string,
  id: string,
  resumo: string,
): Promise<boolean> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update documentos set resumo = ${resumo}
      where id = ${id} and assinante_id = ${assinanteId}
      returning id
    `;
    return rows.length > 0;
  });
}

export async function getDocumentoById(
  assinanteId: string,
  id: string,
): Promise<DocumentoRow | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbDoc[]>`
      select id, nome, tipo, storage_ref, processo_id, chaves, resumo, extracao_status, status
      from documentos
      where id = ${id} and assinante_id = ${assinanteId}
    `;
    return rows[0] ? toRow(rows[0]) : null;
  });
}

export async function documentoPendenteDecisao(assinanteId: string): Promise<DocumentoRow | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbDoc[]>`
      select id, nome, tipo, storage_ref, processo_id, chaves, resumo, extracao_status, status
      from documentos
      where assinante_id = ${assinanteId} and status = 'aguardando_decisao'
      order by enviado_em desc
      limit 1
    `;
    return rows[0] ? toRow(rows[0]) : null;
  });
}

export async function removerDocumento(assinanteId: string, id: string): Promise<string | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ storage_ref: string }[]>`
      delete from documentos where id = ${id} and assinante_id = ${assinanteId}
      returning storage_ref
    `;
    return rows[0]?.storage_ref ?? null;
  });
}

// --- Passo 12B: busca (SEMPRE escopada por tenant na própria query; RLS backstop) ---

/** Exata: casa QUALQUER token (palavra/fragmento de número) em busca_texto/nome,
 *  ranqueado pelo nº de tokens que casaram. Tudo do PRÓPRIO tenant. */
export async function buscarDocumentosExato(
  assinanteId: string,
  termos: string[],
  limite: number,
): Promise<DocumentoResultado[]> {
  if (termos.length === 0) return [];
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbDoc[]>`
      select id, nome, tipo, storage_ref, processo_id, chaves, resumo, extracao_status, status
      from documentos d
      where d.assinante_id = ${assinanteId}
        and d.status = 'guardado'
        and exists (
          select 1 from unnest(${termos}::text[]) tk
          where d.busca_texto ilike '%' || tk || '%' or d.nome ilike '%' || tk || '%'
        )
      order by (
        select count(*) from unnest(${termos}::text[]) tk
        where d.busca_texto ilike '%' || tk || '%' or d.nome ilike '%' || tk || '%'
      ) desc, d.enviado_em desc
      limit ${limite}
    `;
    return rows.map(toRow);
  });
}

/** Semântica: vizinhos do embedding ENTRE os documentos do próprio tenant. */
export async function buscarDocumentosSemantico(
  assinanteId: string,
  embedding: number[],
  limite: number,
): Promise<DocumentoResultado[]> {
  const vec = vectorLiteral(embedding);
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<(DbDoc & { similarity: number })[]>`
      select id, nome, tipo, storage_ref, processo_id, chaves, resumo, extracao_status, status,
             1 - (embedding <=> ${vec}::vector) as similarity
      from documentos
      where assinante_id = ${assinanteId}
        and status = 'guardado'
        and embedding is not null
      order by embedding <=> ${vec}::vector
      limit ${limite}
    `;
    return rows.map((r) => ({ ...toRow(r), similarity: Number(r.similarity) }));
  });
}

/** Quantos documentos do tenant ficaram SEM texto (ponto cego da busca). */
export async function contarDocumentosSemTexto(assinanteId: string): Promise<number> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ n: number }[]>`
      select count(*)::int as n from documentos
      where assinante_id = ${assinanteId} and status = 'guardado' and extracao_status = 'sem_texto'
    `;
    return rows[0]?.n ?? 0;
  });
}

// --- Backfill de embeddings (BACK-OFFICE / CLI; via pool, fora do caminho de mensagem) ---

export interface DocSemEmbedding {
  id: string;
  assinanteId: string;
  buscaTexto: string;
}

/** Documentos com texto (nativo ou OCR) e busca_texto, mas SEM embedding (idempotente). */
export async function listarDocumentosSemEmbedding(limite: number): Promise<DocSemEmbedding[]> {
  const rows = await pool<{ id: string; assinante_id: string; busca_texto: string }[]>`
    select id, assinante_id, busca_texto from documentos
    where embedding is null and extracao_status in ('ok', 'ok_ocr', 'ok_ocr_parcial')
      and busca_texto is not null and status = 'guardado'
    limit ${limite}
  `;
  return rows.map((r) => ({ id: r.id, assinanteId: r.assinante_id, buscaTexto: r.busca_texto }));
}

/** Grava o embedding de um documento (back-office). */
export async function setDocumentoEmbedding(id: string, embedding: number[]): Promise<void> {
  await pool`update documentos set embedding = ${vectorLiteral(embedding)}::vector where id = ${id}`;
}

// --- Re-OCR dos "ponto cego" (BACK-OFFICE / CLI doc:ocr) ---

export interface DocSemTexto {
  id: string;
  assinanteId: string;
  nome: string;
}

/** Documentos `sem_texto` guardados (candidatos a re-OCR). Opcionalmente de 1 tenant. */
export async function listarDocumentosSemTexto(
  limite: number,
  assinanteId?: string,
): Promise<DocSemTexto[]> {
  const rows = assinanteId
    ? await pool<{ id: string; assinante_id: string; nome: string }[]>`
        select id, assinante_id, nome from documentos
        where extracao_status = 'sem_texto' and status = 'guardado'
          and assinante_id = ${assinanteId}
        order by enviado_em limit ${limite}
      `
    : await pool<{ id: string; assinante_id: string; nome: string }[]>`
        select id, assinante_id, nome from documentos
        where extracao_status = 'sem_texto' and status = 'guardado'
        order by enviado_em limit ${limite}
      `;
  return rows.map((r) => ({ id: r.id, assinanteId: r.assinante_id, nome: r.nome }));
}

/**
 * Store de DOCUMENTOS — metadados + chaves por TENANT, via withTenant (RLS,
 * sem service_role). O service_role só toca o ARQUIVO no Storage; "de quem é o
 * documento" é decidido AQUI (RLS). O `assinante_id` vem sempre da identidade.
 */
import { withTenant } from './tenant.js';
import type {
  ConteudoExtraido,
  DocumentoRow,
  ExtracaoStatus,
  KeyInfo,
  NovoDocumento,
} from '../../core/ports/documentos.js';

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
        status = 'guardado'
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

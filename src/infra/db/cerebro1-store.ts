/**
 * Camada de dados do Cérebro 1: queries PARAMETRIZADAS e escopadas por tenant
 * (via `withTenant` → RLS/authenticated, sem service_role). O `assinanteId` vem
 * sempre da identidade; nunca de texto/parâmetro do LLM.
 */
import { withTenant } from './tenant.js';
import { jsonbParse } from './jsonb.js';
import type {
  CompromissoAlvo,
  CompromissoPatch,
  CompromissoRow,
  CompromissoSelector,
  NovoCompromisso,
  NovoProcesso,
  PendingAction,
  ProcessoPatch,
  ProcessoRow,
  ProcessoSelector,
} from '../../core/ports/cerebro1.js';

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

interface DbCompromisso {
  id: string;
  tipo: string;
  data_hora: Date | string;
  descricao: string | null;
  local: string | null;
  processo_id: string | null;
}
function toCompromisso(r: DbCompromisso): CompromissoRow {
  return {
    id: r.id,
    tipo: r.tipo,
    dataHora: iso(r.data_hora),
    descricao: r.descricao,
    local: r.local,
    processoId: r.processo_id,
  };
}

export async function criarCompromisso(
  assinanteId: string,
  c: NovoCompromisso,
): Promise<CompromissoRow> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbCompromisso[]>`
      insert into compromissos
        (assinante_id, processo_id, tipo, data_hora, descricao, lembrete_em, origem)
      values
        (${assinanteId}, ${c.processoId}, ${c.tipo}::compromisso_tipo,
         ${c.dataHora}::timestamptz, ${c.descricao}, ${c.lembreteEm}::timestamptz[], 'manual')
      returning id, tipo, data_hora, descricao, local, processo_id
    `;
    return toCompromisso(rows[0]!);
  });
}

export async function listarCompromissos(
  assinanteId: string,
  range: { fromISO: string | null; toISO: string | null },
): Promise<CompromissoRow[]> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbCompromisso[]>`
      select id, tipo, data_hora, descricao, local, processo_id
      from compromissos
      where assinante_id = ${assinanteId}
        and (${range.fromISO}::timestamptz is null or data_hora >= ${range.fromISO}::timestamptz)
        and (${range.toISO}::timestamptz is null or data_hora <= ${range.toISO}::timestamptz)
      order by data_hora asc
      limit 50
    `;
    return rows.map(toCompromisso);
  });
}

export async function resolveProcessoIdByCnj(
  assinanteId: string,
  numeroCnj: string,
): Promise<string | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from processos
      where assinante_id = ${assinanteId} and numero_cnj = ${numeroCnj}
      limit 1
    `;
    return rows[0]?.id ?? null;
  });
}

export async function upsertClienteByNome(assinanteId: string, nome: string): Promise<string> {
  return withTenant(assinanteId, async (tx) => {
    const existing = await tx<{ id: string }[]>`
      select id from clientes
      where assinante_id = ${assinanteId} and lower(nome) = lower(${nome})
      limit 1
    `;
    if (existing[0]) return existing[0].id;
    const inserted = await tx<{ id: string }[]>`
      insert into clientes (assinante_id, nome) values (${assinanteId}, ${nome})
      returning id
    `;
    return inserted[0]!.id;
  });
}

interface DbProcesso {
  id: string;
  numero_cnj: string | null;
  cliente_nome: string | null;
  parte_contraria: string | null;
  area: string | null;
  status: string | null;
}
function toProcesso(r: DbProcesso): ProcessoRow {
  return {
    id: r.id,
    numeroCnj: r.numero_cnj,
    clienteNome: r.cliente_nome,
    parteContraria: r.parte_contraria,
    area: r.area,
    status: r.status,
  };
}

export async function cadastrarProcesso(
  assinanteId: string,
  p: NovoProcesso,
): Promise<ProcessoRow> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbProcesso[]>`
      insert into processos
        (assinante_id, cliente_id, numero_cnj, parte_contraria, area, status)
      values
        (${assinanteId}, ${p.clienteId}, ${p.numeroCnj}, ${p.parteContraria}, ${p.area}, ${p.status})
      returning id, numero_cnj, parte_contraria, area, status, null::text as cliente_nome
    `;
    return toProcesso(rows[0]!);
  });
}

export async function listarProcessos(
  assinanteId: string,
  filtro: { clienteNome: string | null; status: string | null },
): Promise<ProcessoRow[]> {
  const clientePattern = filtro.clienteNome ? `%${filtro.clienteNome}%` : null;
  const statusPattern = filtro.status ? `%${filtro.status}%` : null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbProcesso[]>`
      select p.id, p.numero_cnj, p.parte_contraria, p.area, p.status, c.nome as cliente_nome
      from processos p
      left join clientes c on c.id = p.cliente_id
      where p.assinante_id = ${assinanteId}
        and (${clientePattern}::text is null or c.nome ilike ${clientePattern})
        and (${statusPattern}::text is null or p.status ilike ${statusPattern})
      order by p.criado_em desc
      limit 50
    `;
    return rows.map(toProcesso);
  });
}

export async function consultarProcesso(
  assinanteId: string,
  filtro: { numeroCnj: string | null; parte: string | null },
): Promise<ProcessoRow[]> {
  const partePattern = filtro.parte ? `%${filtro.parte}%` : null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbProcesso[]>`
      select p.id, p.numero_cnj, p.parte_contraria, p.area, p.status, c.nome as cliente_nome
      from processos p
      left join clientes c on c.id = p.cliente_id
      where p.assinante_id = ${assinanteId}
        and (${filtro.numeroCnj}::text is null or p.numero_cnj = ${filtro.numeroCnj})
        and (${partePattern}::text is null or p.parte_contraria ilike ${partePattern})
      order by p.criado_em desc
      limit 20
    `;
    return rows.map(toProcesso);
  });
}

// --- Passo 11: editar/remover (sempre escopado por tenant via withTenant/RLS) ---

interface DbAlvo {
  id: string;
  tipo: string;
  data_hora: Date | string;
  descricao: string | null;
  processo_id: string | null;
  processo_numero: string | null;
  cliente_nome: string | null;
}
function toAlvo(r: DbAlvo): CompromissoAlvo {
  return {
    id: r.id,
    tipo: r.tipo,
    dataHora: iso(r.data_hora),
    descricao: r.descricao,
    processoId: r.processo_id,
    processoNumero: r.processo_numero,
    clienteNome: r.cliente_nome,
  };
}

export async function findCompromissos(
  assinanteId: string,
  sel: CompromissoSelector,
): Promise<CompromissoAlvo[]> {
  const cnj = sel.numeroCnj ?? null;
  const tipo = sel.tipo ?? null;
  const dia = sel.dia ?? null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbAlvo[]>`
      select c.id, c.tipo, c.data_hora, c.descricao, c.processo_id,
             p.numero_cnj as processo_numero, cl.nome as cliente_nome
      from compromissos c
      left join processos p on p.id = c.processo_id
      left join clientes cl on cl.id = p.cliente_id
      where c.assinante_id = ${assinanteId}
        and (${cnj}::text is null or p.numero_cnj = ${cnj})
        and (${tipo}::text is null or c.tipo::text = ${tipo})
        and (${dia}::date is null
             or (c.data_hora at time zone 'America/Sao_Paulo')::date = ${dia}::date)
      order by c.data_hora asc
      limit 10
    `;
    return rows.map(toAlvo);
  });
}

export async function getCompromissoById(
  assinanteId: string,
  id: string,
): Promise<CompromissoAlvo | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbAlvo[]>`
      select c.id, c.tipo, c.data_hora, c.descricao, c.processo_id,
             p.numero_cnj as processo_numero, cl.nome as cliente_nome
      from compromissos c
      left join processos p on p.id = c.processo_id
      left join clientes cl on cl.id = p.cliente_id
      where c.assinante_id = ${assinanteId} and c.id = ${id}
    `;
    return rows[0] ? toAlvo(rows[0]) : null;
  });
}

export async function updateCompromisso(
  assinanteId: string,
  id: string,
  patch: CompromissoPatch,
): Promise<boolean> {
  const tipo = patch.tipo ?? null;
  const dataHora = patch.dataHora ?? null;
  const descricao = patch.descricao ?? null;
  const processoId = patch.processoId ?? null;
  const lembrete = patch.lembreteEm ?? null; // presente só quando a data mudou
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update compromissos set
        tipo = coalesce(${tipo}::compromisso_tipo, tipo),
        data_hora = coalesce(${dataHora}::timestamptz, data_hora),
        descricao = coalesce(${descricao}, descricao),
        processo_id = coalesce(${processoId}::uuid, processo_id),
        lembrete_em = coalesce(${lembrete}::timestamptz[], lembrete_em)
      where id = ${id} and assinante_id = ${assinanteId}
      returning id
    `;
    if (rows.length === 0) return false;
    // Data mudou → a marcação antiga não vale mais para a nova data.
    if (lembrete !== null) {
      await tx`delete from lembretes_enviados where compromisso_id = ${id}`;
    }
    return true;
  });
}

export async function deleteCompromisso(assinanteId: string, id: string): Promise<boolean> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      delete from compromissos where id = ${id} and assinante_id = ${assinanteId} returning id
    `;
    return rows.length > 0; // cascade limpa lembretes_enviados
  });
}

export async function findProcessos(
  assinanteId: string,
  sel: ProcessoSelector,
): Promise<ProcessoRow[]> {
  const cnj = sel.numeroCnj ?? null;
  // Fragmento de número ("processo 12345"): casa por trecho do numero_cnj —
  // dentro da MESMA query já escopada por tenant (o LIKE nunca roda fora dela).
  const fragPattern = sel.numeroFragmento ? `%${sel.numeroFragmento}%` : null;
  const clientePattern = sel.clienteNome ? `%${sel.clienteNome}%` : null;
  const partePattern = sel.parte ? `%${sel.parte}%` : null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbProcesso[]>`
      select p.id, p.numero_cnj, p.parte_contraria, p.area, p.status, c.nome as cliente_nome
      from processos p
      left join clientes c on c.id = p.cliente_id
      where p.assinante_id = ${assinanteId}
        and (${cnj}::text is null or p.numero_cnj = ${cnj})
        and (${fragPattern}::text is null or p.numero_cnj like ${fragPattern})
        and (${clientePattern}::text is null or c.nome ilike ${clientePattern})
        and (${partePattern}::text is null or p.parte_contraria ilike ${partePattern})
      order by p.criado_em desc
      limit 10
    `;
    return rows.map(toProcesso);
  });
}

export async function getProcessoById(
  assinanteId: string,
  id: string,
): Promise<ProcessoRow | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbProcesso[]>`
      select p.id, p.numero_cnj, p.parte_contraria, p.area, p.status, c.nome as cliente_nome
      from processos p
      left join clientes c on c.id = p.cliente_id
      where p.assinante_id = ${assinanteId} and p.id = ${id}
    `;
    return rows[0] ? toProcesso(rows[0]) : null;
  });
}

export async function updateProcesso(
  assinanteId: string,
  id: string,
  patch: ProcessoPatch,
): Promise<boolean> {
  const status = patch.status ?? null;
  const clienteId = patch.clienteId ?? null;
  const parte = patch.parteContraria ?? null;
  const area = patch.area ?? null;
  const fase = patch.fase ?? null;
  const instancia = patch.instancia ?? null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update processos set
        status = coalesce(${status}, status),
        cliente_id = coalesce(${clienteId}::uuid, cliente_id),
        parte_contraria = coalesce(${parte}, parte_contraria),
        area = coalesce(${area}, area),
        fase = coalesce(${fase}, fase),
        instancia = coalesce(${instancia}, instancia)
      where id = ${id} and assinante_id = ${assinanteId}
      returning id
    `;
    return rows.length > 0;
  });
}

export async function arquivarProcesso(assinanteId: string, id: string): Promise<boolean> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update processos set status = 'arquivado'
      where id = ${id} and assinante_id = ${assinanteId}
      returning id
    `;
    return rows.length > 0;
  });
}

// --- Ação pendente (confirmar-antes-de-gravar / slot-filling), por tenant ---

export async function getPendingAction(assinanteId: string): Promise<PendingAction | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<
      { acao: string; params: Record<string, unknown>; fase: string; faltando: string[] }[]
    >`
      select acao, params, fase, faltando from acoes_pendentes
      where assinante_id = ${assinanteId}
    `;
    const r = rows[0];
    if (!r) return null;
    const fase =
      r.fase === 'confirmando' ? 'confirmando' : r.fase === 'desambiguando' ? 'desambiguando' : 'coletando';
    return { acao: r.acao, params: jsonbParse(r.params, {}), fase, faltando: r.faltando };
  });
}

export async function savePendingAction(
  assinanteId: string,
  pending: PendingAction,
): Promise<void> {
  await withTenant(assinanteId, async (tx) => {
    await tx`
      insert into acoes_pendentes (assinante_id, acao, params, fase, faltando)
      values (${assinanteId}, ${pending.acao}, ${pending.params as never}::jsonb,
              ${pending.fase}, ${pending.faltando})
      on conflict (assinante_id) do update
        set acao = excluded.acao, params = excluded.params,
            fase = excluded.fase, faltando = excluded.faltando, atualizado_em = now()
    `;
  });
}

export async function clearPendingAction(assinanteId: string): Promise<void> {
  await withTenant(assinanteId, async (tx) => {
    await tx`delete from acoes_pendentes where assinante_id = ${assinanteId}`;
  });
}

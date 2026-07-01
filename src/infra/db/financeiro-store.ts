/**
 * Camada de dados do FINANCEIRO (Passo 16): queries parametrizadas e escopadas
 * por tenant (withTenant → RLS force de backstop; FK composta amarra a parcela
 * ao (processo, assinante)). `assinanteId` vem SEMPRE da identidade.
 */
import { withTenant } from './tenant.js';
import type {
  AcordoResumo,
  FinanceiroFiltro,
  NovoAcordoHonorario,
  ParcelaAlvo,
  ParcelaPatch,
  ParcelaSelector,
} from '../../core/ports/financeiro.js';
import type { ProcessoSelector } from '../../core/ports/cerebro1.js';

interface DbParcela {
  id: string;
  acordo_id: string | null;
  parcela: number | null;
  total_parcelas: number | null;
  valor: string;
  vencimento: string | null;
  status: string;
  descricao: string | null;
  pago_em: Date | string | null;
  processo_id: string;
  processo_numero: string | null;
  cliente_nome: string | null;
}

function toParcela(r: DbParcela): ParcelaAlvo {
  return {
    id: r.id,
    acordoId: r.acordo_id,
    parcela: r.parcela,
    totalParcelas: r.total_parcelas,
    valorDecimal: r.valor,
    vencimento: r.vencimento,
    status: r.status,
    descricao: r.descricao,
    pagoEm: r.pago_em ? new Date(r.pago_em).toISOString() : null,
    processoId: r.processo_id,
    processoNumero: r.processo_numero,
    clienteNome: r.cliente_nome,
  };
}

export async function criarHonorario(
  assinanteId: string,
  acordo: NovoAcordoHonorario,
): Promise<number> {
  return withTenant(assinanteId, async (tx) => {
    // Posse do processo re-verificada NA transação (id alheio → 0 linhas → erro).
    const proc = await tx<{ id: string }[]>`
      select id from processos where assinante_id = ${assinanteId} and id = ${acordo.processoId}
    `;
    if (!proc[0]) throw new Error('processo não encontrado para este assinante');
    const valores = acordo.parcelas.map((p) => p.valorDecimal);
    const vencimentos = acordo.parcelas.map((p) => p.vencimento);
    const nums = acordo.parcelas.map((p) => p.parcela);
    const totais = acordo.parcelas.map((p) => p.totalParcelas);
    const rows = await tx<{ id: string }[]>`
      insert into lancamentos_financeiros
        (assinante_id, processo_id, tipo, valor, vencimento, status,
         descricao, acordo_id, parcela, total_parcelas)
      select ${assinanteId}, ${acordo.processoId}, 'honorario',
             v.valor::numeric, v.venc::date, 'pendente',
             ${acordo.descricao}, ${acordo.acordoId}, v.num, v.total
      from unnest(${valores}::text[], ${vencimentos}::text[],
                  ${nums}::int[], ${totais}::int[]) as v(valor, venc, num, total)
      returning id
    `;
    return rows.length;
  });
}

export async function findParcelas(
  assinanteId: string,
  sel: ParcelaSelector,
): Promise<ParcelaAlvo[]> {
  const cnj = sel.numeroCnj ?? null;
  const fragPattern = sel.numeroFragmento ? `%${sel.numeroFragmento}%` : null;
  const clientePattern = sel.clienteNome ? `%${sel.clienteNome}%` : null;
  const partePattern = sel.parte ? `%${sel.parte}%` : null;
  const mes = sel.mesAno ?? null; // YYYY-MM
  const num = sel.parcelaNum ?? null;
  const soPendentes = sel.apenasPendentes !== false;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbParcela[]>`
      select l.id, l.acordo_id, l.parcela, l.total_parcelas, l.valor::text,
             l.vencimento::text, l.status::text, l.descricao, l.pago_em,
             l.processo_id, p.numero_cnj as processo_numero, c.nome as cliente_nome
      from lancamentos_financeiros l
      join processos p on p.id = l.processo_id
      left join clientes c on c.id = p.cliente_id
      where l.assinante_id = ${assinanteId}
        and (${soPendentes}::boolean is false or l.status = 'pendente')
        and (${cnj}::text is null or p.numero_cnj = ${cnj})
        and (${fragPattern}::text is null or p.numero_cnj like ${fragPattern})
        and (${clientePattern}::text is null or c.nome ilike ${clientePattern})
        and (${partePattern}::text is null or p.parte_contraria ilike ${partePattern})
        and (${mes}::text is null or to_char(l.vencimento, 'YYYY-MM') = ${mes})
        and (${num}::int is null or l.parcela = ${num})
      order by l.vencimento asc nulls last, l.parcela asc
      limit 10
    `;
    return rows.map(toParcela);
  });
}

export async function getParcelaById(
  assinanteId: string,
  id: string,
): Promise<ParcelaAlvo | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbParcela[]>`
      select l.id, l.acordo_id, l.parcela, l.total_parcelas, l.valor::text,
             l.vencimento::text, l.status::text, l.descricao, l.pago_em,
             l.processo_id, p.numero_cnj as processo_numero, c.nome as cliente_nome
      from lancamentos_financeiros l
      join processos p on p.id = l.processo_id
      left join clientes c on c.id = p.cliente_id
      where l.assinante_id = ${assinanteId} and l.id = ${id}
    `;
    return rows[0] ? toParcela(rows[0]) : null;
  });
}

export async function marcarParcelaPaga(
  assinanteId: string,
  id: string,
  pagoEmISO: string,
): Promise<boolean> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update lancamentos_financeiros
      set status = 'pago', pago_em = ${pagoEmISO}::timestamptz
      where id = ${id} and assinante_id = ${assinanteId} and status = 'pendente'
      returning id
    `;
    return rows.length > 0;
  });
}

export async function updateParcela(
  assinanteId: string,
  id: string,
  patch: ParcelaPatch,
): Promise<boolean> {
  const valor = patch.valorDecimal ?? null;
  const venc = patch.vencimento ?? null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update lancamentos_financeiros
      set valor = coalesce(${valor}::numeric, valor),
          vencimento = coalesce(${venc}::date, vencimento)
      where id = ${id} and assinante_id = ${assinanteId} and status = 'pendente'
      returning id
    `;
    return rows.length > 0;
  });
}

export async function cancelarParcela(assinanteId: string, id: string): Promise<boolean> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update lancamentos_financeiros
      set status = 'cancelado'
      where id = ${id} and assinante_id = ${assinanteId} and status = 'pendente'
      returning id
    `;
    return rows.length > 0;
  });
}

interface DbAcordo {
  acordo_id: string;
  processo_id: string;
  processo_numero: string | null;
  cliente_nome: string | null;
  descricao: string | null;
  total_parcelas: number;
  pendentes: number;
  pagas: number;
  soma_pendente: string;
}
function toAcordo(r: DbAcordo): AcordoResumo {
  return {
    acordoId: r.acordo_id,
    processoId: r.processo_id,
    processoNumero: r.processo_numero,
    clienteNome: r.cliente_nome,
    descricao: r.descricao,
    totalParcelas: Number(r.total_parcelas),
    pendentes: Number(r.pendentes),
    pagas: Number(r.pagas),
    somaPendenteDecimal: r.soma_pendente,
  };
}

export async function findAcordos(
  assinanteId: string,
  sel: ProcessoSelector,
): Promise<AcordoResumo[]> {
  const cnj = sel.numeroCnj ?? null;
  const fragPattern = sel.numeroFragmento ? `%${sel.numeroFragmento}%` : null;
  const clientePattern = sel.clienteNome ? `%${sel.clienteNome}%` : null;
  const partePattern = sel.parte ? `%${sel.parte}%` : null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbAcordo[]>`
      select l.acordo_id, l.processo_id, p.numero_cnj as processo_numero,
             c.nome as cliente_nome, max(l.descricao) as descricao,
             max(l.total_parcelas) as total_parcelas,
             count(*) filter (where l.status = 'pendente')::int as pendentes,
             count(*) filter (where l.status = 'pago')::int as pagas,
             coalesce(sum(l.valor) filter (where l.status = 'pendente'), 0)::text as soma_pendente
      from lancamentos_financeiros l
      join processos p on p.id = l.processo_id
      left join clientes c on c.id = p.cliente_id
      where l.assinante_id = ${assinanteId}
        and l.acordo_id is not null
        and (${cnj}::text is null or p.numero_cnj = ${cnj})
        and (${fragPattern}::text is null or p.numero_cnj like ${fragPattern})
        and (${clientePattern}::text is null or c.nome ilike ${clientePattern})
        and (${partePattern}::text is null or p.parte_contraria ilike ${partePattern})
      group by l.acordo_id, l.processo_id, p.numero_cnj, c.nome
      having count(*) filter (where l.status = 'pendente') > 0
      order by min(l.vencimento) asc
      limit 10
    `;
    return rows.map(toAcordo);
  });
}

export async function getAcordoById(
  assinanteId: string,
  acordoId: string,
): Promise<AcordoResumo | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbAcordo[]>`
      select l.acordo_id, l.processo_id, p.numero_cnj as processo_numero,
             c.nome as cliente_nome, max(l.descricao) as descricao,
             max(l.total_parcelas) as total_parcelas,
             count(*) filter (where l.status = 'pendente')::int as pendentes,
             count(*) filter (where l.status = 'pago')::int as pagas,
             coalesce(sum(l.valor) filter (where l.status = 'pendente'), 0)::text as soma_pendente
      from lancamentos_financeiros l
      join processos p on p.id = l.processo_id
      left join clientes c on c.id = p.cliente_id
      where l.assinante_id = ${assinanteId} and l.acordo_id = ${acordoId}
      group by l.acordo_id, l.processo_id, p.numero_cnj, c.nome
    `;
    return rows[0] ? toAcordo(rows[0]) : null;
  });
}

export async function cancelarAcordoPendentes(
  assinanteId: string,
  acordoId: string,
): Promise<{ canceladas: number; somaDecimal: string }> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ valor: string }[]>`
      update lancamentos_financeiros
      set status = 'cancelado'
      where assinante_id = ${assinanteId} and acordo_id = ${acordoId} and status = 'pendente'
      returning valor::text
    `;
    // Soma exibida é recomputada em centavos no domínio pelo chamador se preciso;
    // aqui devolvemos a soma agregada pelo próprio Postgres (decimal exato).
    const soma = await tx<{ s: string }[]>`
      select coalesce(sum(valor), 0)::text as s from lancamentos_financeiros
      where assinante_id = ${assinanteId} and acordo_id = ${acordoId} and status = 'cancelado'
    `;
    return { canceladas: rows.length, somaDecimal: soma[0]?.s ?? '0' };
  });
}

export async function listarPendentes(
  assinanteId: string,
  filtro: FinanceiroFiltro,
): Promise<ParcelaAlvo[]> {
  const p = filtro.processo ?? {};
  const cnj = p.numeroCnj ?? null;
  const fragPattern = p.numeroFragmento ? `%${p.numeroFragmento}%` : null;
  const clientePattern = p.clienteNome ? `%${p.clienteNome}%` : null;
  const partePattern = p.parte ? `%${p.parte}%` : null;
  const de = filtro.de ?? null;
  const ate = filtro.ate ?? null;
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<DbParcela[]>`
      select l.id, l.acordo_id, l.parcela, l.total_parcelas, l.valor::text,
             l.vencimento::text, l.status::text, l.descricao, l.pago_em,
             l.processo_id, pr.numero_cnj as processo_numero, c.nome as cliente_nome
      from lancamentos_financeiros l
      join processos pr on pr.id = l.processo_id
      left join clientes c on c.id = pr.cliente_id
      where l.assinante_id = ${assinanteId}
        and l.status = 'pendente'
        and (${cnj}::text is null or pr.numero_cnj = ${cnj})
        and (${fragPattern}::text is null or pr.numero_cnj like ${fragPattern})
        and (${clientePattern}::text is null or c.nome ilike ${clientePattern})
        and (${partePattern}::text is null or pr.parte_contraria ilike ${partePattern})
        and (${de}::date is null or l.vencimento >= ${de}::date)
        and (${ate}::date is null or l.vencimento <= ${ate}::date)
      order by l.vencimento asc nulls last
      limit 50
    `;
    return rows.map(toParcela);
  });
}

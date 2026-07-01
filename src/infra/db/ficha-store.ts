/**
 * Agregação da FICHA DO PROCESSO (Passo 15) no Postgres, escopada por tenant.
 *
 * ISOLAMENTO NA AGREGAÇÃO (crítico): as 4 consultas rodam em UMA transação
 * `withTenant` e CADA uma tem `assinante_id = ${assinanteId}` embutido — além
 * do RLS force de backstop em todas as tabelas e das FKs compostas
 * (processo_id, assinante_id) que impedem filho de processo alheio por
 * construção. A posse do processo é RE-VERIFICADA na primeira consulta: se a
 * linha não é do tenant, devolve null e NENHUM filho é consultado.
 */
import { withTenant } from './tenant.js';
import type {
  FichaBruta,
  FichaCompromisso,
  FichaDocumento,
  FichaLancamento,
  FichaProcessoDados,
} from '../../core/ports/ficha.js';

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export async function getFichaBruta(
  assinanteId: string,
  processoId: string,
): Promise<FichaBruta | null> {
  return withTenant(assinanteId, async (tx) => {
    // 1) Processo do TENANT (posse re-verificada aqui; null → para tudo).
    const procs = await tx<
      Array<{
        id: string;
        numero_cnj: string | null;
        cliente_nome: string | null;
        parte_contraria: string | null;
        vara: string | null;
        comarca: string | null;
        area: string | null;
        valor_causa: string | null;
        status: string | null;
        fase: string | null;
        instancia: string | null;
        segredo_justica: boolean;
      }>
    >`
      select p.id, p.numero_cnj, c.nome as cliente_nome, p.parte_contraria,
             p.vara, p.comarca, p.area, p.valor_causa::text, p.status,
             p.fase, p.instancia, p.segredo_justica
      from processos p
      left join clientes c on c.id = p.cliente_id
      where p.assinante_id = ${assinanteId} and p.id = ${processoId}
    `;
    const proc = procs[0];
    if (!proc) return null;
    const processo: FichaProcessoDados = {
      id: proc.id,
      numeroCnj: proc.numero_cnj,
      clienteNome: proc.cliente_nome,
      parteContraria: proc.parte_contraria,
      vara: proc.vara,
      comarca: proc.comarca,
      area: proc.area,
      valorCausa: proc.valor_causa,
      status: proc.status,
      fase: proc.fase,
      instancia: proc.instancia,
      segredoJustica: proc.segredo_justica,
    };

    // 2) Agenda do processo (do tenant), ordem cronológica.
    const comps = await tx<
      Array<{ id: string; tipo: string; data_hora: Date | string; descricao: string | null }>
    >`
      select id, tipo, data_hora, descricao
      from compromissos
      where assinante_id = ${assinanteId} and processo_id = ${processoId}
      order by data_hora asc
      limit 100
    `;
    const compromissos: FichaCompromisso[] = comps.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      dataHora: iso(r.data_hora),
      descricao: r.descricao,
    }));

    // 3) Documentos GUARDADOS vinculados (do tenant), mais recentes primeiro.
    const docs = await tx<
      Array<{ id: string; nome: string; extracao_status: string; enviado_em: Date | string }>
    >`
      select id, nome, extracao_status, enviado_em
      from documentos
      where assinante_id = ${assinanteId} and processo_id = ${processoId}
        and status = 'guardado'
      order by enviado_em desc
      limit 50
    `;
    const documentos: FichaDocumento[] = docs.map((r) => ({
      id: r.id,
      nome: r.nome,
      extracaoStatus: r.extracao_status,
      enviadoEm: iso(r.enviado_em),
    }));

    // 4) Financeiro do processo (do tenant) — slot real desde já (Passo 16 preenche).
    const lancs = await tx<
      Array<{ id: string; tipo: string; valor: string; vencimento: string | null; status: string }>
    >`
      select id, tipo::text, valor::text, vencimento::text, status::text
      from lancamentos_financeiros
      where assinante_id = ${assinanteId} and processo_id = ${processoId}
      order by vencimento asc nulls last, criado_em asc
      limit 100
    `;
    const lancamentos: FichaLancamento[] = lancs.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      valor: r.valor,
      vencimento: r.vencimento,
      status: r.status,
    }));

    return { processo, compromissos, documentos, lancamentos };
  });
}

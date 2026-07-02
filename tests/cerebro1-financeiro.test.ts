/**
 * Financeiro/honorários no handler do Cérebro 1 (Passo 16): registrar à
 * vista/parcelado (cenário do Gabriel), confirmação com o plano completo,
 * marcar paga, cancelar acordo REFORÇADO preservando pagas, consulta geral
 * com "atrasada" derivada, e ISOLAMENTO A×B.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Cerebro1Handler } from '../src/application/cerebro1/cerebro1-handler';
import type { MessageContext } from '../src/core/orchestration/handler';
import type {
  Cerebro1Store,
  CompromissoAlvo,
  CompromissoRow,
  NovoCompromisso,
  NovoProcesso,
  PendingAction,
  PendingActionStore,
  ProcessoRow,
  ProcessoSelector,
} from '../src/core/ports/cerebro1';
import type {
  AcordoResumo,
  FinanceiroFiltro,
  FinanceiroStore,
  NovoAcordoHonorario,
  ParcelaAlvo,
  ParcelaPatch,
  ParcelaSelector,
} from '../src/core/ports/financeiro';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';
import { makeMessage } from './helpers';

const CLOCK = new Date('2026-07-01T12:00:00.000Z');
const clock = () => CLOCK;
const logger = { error: () => {} };

class FakeLlm implements LlmPort {
  constructor(private readonly responder: (p: LlmGenerateParams) => LlmGenerateResult) {}
  generate(p: LlmGenerateParams): Promise<LlmGenerateResult> {
    return Promise.resolve(this.responder(p));
  }
}
const tool = (name: string, input: Record<string, unknown>): LlmGenerateResult => ({
  text: '',
  toolCalls: [{ id: 't', name, input }],
  stopReason: 'tool_use',
});

class InMemoryPending implements PendingActionStore {
  m = new Map<string, PendingAction>();
  get(id: string) {
    return Promise.resolve(this.m.get(id) ?? null);
  }
  save(id: string, p: PendingAction) {
    this.m.set(id, p);
    return Promise.resolve();
  }
  clear(id: string) {
    this.m.delete(id);
    return Promise.resolve();
  }
}

/** Store de processos por tenant (só o que o fluxo usa). */
class TenantStore implements Cerebro1Store {
  proc = new Map<string, ProcessoRow[]>();
  seedProc(tenant: string, p: ProcessoRow): void {
    const arr = this.proc.get(tenant) ?? [];
    arr.push(p);
    this.proc.set(tenant, arr);
  }
  findProcessos(tenant: string, sel: ProcessoSelector): Promise<ProcessoRow[]> {
    const arr = this.proc.get(tenant) ?? [];
    return Promise.resolve(
      arr.filter(
        (p) =>
          (!sel.numeroCnj || p.numeroCnj === sel.numeroCnj) &&
          (!sel.numeroFragmento || (p.numeroCnj ?? '').includes(sel.numeroFragmento)) &&
          (!sel.clienteNome || (p.clienteNome ?? '').toLowerCase().includes(sel.clienteNome.toLowerCase())) &&
          (!sel.parte || (p.parteContraria ?? '').toLowerCase().includes(sel.parte.toLowerCase())),
      ),
    );
  }
  getProcessoById(tenant: string, id: string): Promise<ProcessoRow | null> {
    return Promise.resolve((this.proc.get(tenant) ?? []).find((p) => p.id === id) ?? null);
  }
  // inertes:
  criarCompromisso(_t: string, c: NovoCompromisso): Promise<CompromissoRow> {
    return Promise.resolve({ id: 'x', tipo: c.tipo, dataHora: c.dataHora, descricao: c.descricao, local: null, processoId: c.processoId });
  }
  listarCompromissos(): Promise<CompromissoRow[]> {
    return Promise.resolve([]);
  }
  resolveProcessoIdByCnj(): Promise<string | null> {
    return Promise.resolve(null);
  }
  upsertClienteByNome(): Promise<string> {
    return Promise.resolve('cli');
  }
  cadastrarProcesso(_t: string, p: NovoProcesso): Promise<ProcessoRow> {
    return Promise.resolve({ id: 'p', numeroCnj: p.numeroCnj, clienteNome: null, parteContraria: p.parteContraria, area: p.area, status: p.status });
  }
  listarProcessos(): Promise<ProcessoRow[]> {
    return Promise.resolve([]);
  }
  consultarProcesso(): Promise<ProcessoRow[]> {
    return Promise.resolve([]);
  }
  findCompromissos(): Promise<CompromissoAlvo[]> {
    return Promise.resolve([]);
  }
  getCompromissoById(): Promise<CompromissoAlvo | null> {
    return Promise.resolve(null);
  }
  updateCompromisso(): Promise<boolean> {
    return Promise.resolve(false);
  }
  deleteCompromisso(): Promise<boolean> {
    return Promise.resolve(false);
  }
  updateProcesso(): Promise<boolean> {
    return Promise.resolve(false);
  }
  arquivarProcesso(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** FinanceiroStore em memória, por tenant, honrando o contrato de escopo. */
class TenantFinStore implements FinanceiroStore {
  parcelas = new Map<string, ParcelaAlvo[]>();
  private arr(tenant: string): ParcelaAlvo[] {
    const a = this.parcelas.get(tenant) ?? [];
    this.parcelas.set(tenant, a);
    return a;
  }
  seed(tenant: string, p: ParcelaAlvo): void {
    this.arr(tenant).push(p);
  }
  criarHonorario(tenant: string, acordo: NovoAcordoHonorario): Promise<number> {
    for (const p of acordo.parcelas) {
      this.arr(tenant).push({
        id: randomUUID(),
        acordoId: acordo.acordoId,
        parcela: p.parcela,
        totalParcelas: p.totalParcelas,
        valorDecimal: p.valorDecimal,
        vencimento: p.vencimento,
        status: 'pendente',
        descricao: acordo.descricao,
        pagoEm: null,
        processoId: acordo.processoId,
        processoNumero: null,
        clienteNome: null,
      });
    }
    return Promise.resolve(acordo.parcelas.length);
  }
  findParcelas(tenant: string, sel: ParcelaSelector): Promise<ParcelaAlvo[]> {
    return Promise.resolve(
      this.arr(tenant).filter(
        (p) =>
          (sel.apenasPendentes === false || p.status === 'pendente') &&
          (!sel.numeroCnj || p.processoNumero === sel.numeroCnj) &&
          (!sel.numeroFragmento || (p.processoNumero ?? '').includes(sel.numeroFragmento)) &&
          (!sel.clienteNome || (p.clienteNome ?? '').toLowerCase().includes(sel.clienteNome.toLowerCase())) &&
          (!sel.mesAno || (p.vencimento ?? '').startsWith(sel.mesAno)) &&
          (!sel.parcelaNum || p.parcela === sel.parcelaNum),
      ),
    );
  }
  getParcelaById(tenant: string, id: string): Promise<ParcelaAlvo | null> {
    return Promise.resolve(this.arr(tenant).find((p) => p.id === id) ?? null);
  }
  marcarParcelaPaga(tenant: string, id: string, pagoEmISO: string): Promise<boolean> {
    const p = this.arr(tenant).find((x) => x.id === id && x.status === 'pendente');
    if (!p) return Promise.resolve(false);
    p.status = 'pago';
    p.pagoEm = pagoEmISO;
    return Promise.resolve(true);
  }
  updateParcela(tenant: string, id: string, patch: ParcelaPatch): Promise<boolean> {
    const p = this.arr(tenant).find((x) => x.id === id && x.status === 'pendente');
    if (!p) return Promise.resolve(false);
    if (patch.valorDecimal) p.valorDecimal = patch.valorDecimal;
    if (patch.vencimento) p.vencimento = patch.vencimento;
    return Promise.resolve(true);
  }
  cancelarParcela(tenant: string, id: string): Promise<boolean> {
    const p = this.arr(tenant).find((x) => x.id === id && x.status === 'pendente');
    if (!p) return Promise.resolve(false);
    p.status = 'cancelado';
    return Promise.resolve(true);
  }
  findAcordos(tenant: string, sel: ProcessoSelector): Promise<AcordoResumo[]> {
    const grupos = new Map<string, ParcelaAlvo[]>();
    for (const p of this.arr(tenant)) {
      if (!p.acordoId) continue;
      if (sel.numeroFragmento && !(p.processoNumero ?? '').includes(sel.numeroFragmento)) continue;
      if (sel.clienteNome && !(p.clienteNome ?? '').toLowerCase().includes(sel.clienteNome.toLowerCase())) continue;
      const g = grupos.get(p.acordoId) ?? [];
      g.push(p);
      grupos.set(p.acordoId, g);
    }
    const out: AcordoResumo[] = [];
    for (const [acordoId, ps] of grupos) {
      const pend = ps.filter((p) => p.status === 'pendente');
      if (pend.length === 0) continue;
      out.push(this.resumo(acordoId, ps));
    }
    return Promise.resolve(out);
  }
  getAcordoById(tenant: string, acordoId: string): Promise<AcordoResumo | null> {
    const ps = this.arr(tenant).filter((p) => p.acordoId === acordoId);
    return Promise.resolve(ps.length > 0 ? this.resumo(acordoId, ps) : null);
  }
  private resumo(acordoId: string, ps: ParcelaAlvo[]): AcordoResumo {
    const pend = ps.filter((p) => p.status === 'pendente');
    const somaCent = pend.reduce((a, p) => a + Math.round(Number(p.valorDecimal) * 100), 0);
    return {
      acordoId,
      processoId: ps[0]!.processoId,
      processoNumero: ps[0]!.processoNumero,
      clienteNome: ps[0]!.clienteNome,
      descricao: ps[0]!.descricao,
      totalParcelas: ps[0]!.totalParcelas ?? ps.length,
      pendentes: pend.length,
      pagas: ps.filter((p) => p.status === 'pago').length,
      somaPendenteDecimal: `${Math.floor(somaCent / 100)}.${String(somaCent % 100).padStart(2, '0')}`,
    };
  }
  cancelarAcordoPendentes(tenant: string, acordoId: string): Promise<{ canceladas: number; somaDecimal: string }> {
    let n = 0;
    for (const p of this.arr(tenant)) {
      if (p.acordoId === acordoId && p.status === 'pendente') {
        p.status = 'cancelado';
        n++;
      }
    }
    return Promise.resolve({ canceladas: n, somaDecimal: '0' });
  }
  listarPendentes(tenant: string, filtro: FinanceiroFiltro): Promise<ParcelaAlvo[]> {
    const sel = filtro.processo ?? {};
    return Promise.resolve(
      this.arr(tenant)
        .filter(
          (p) =>
            p.status === 'pendente' &&
            (!sel.numeroFragmento || (p.processoNumero ?? '').includes(sel.numeroFragmento)) &&
            (!sel.clienteNome || (p.clienteNome ?? '').toLowerCase().includes(sel.clienteNome.toLowerCase())) &&
            (!filtro.de || (p.vencimento ?? '') >= filtro.de) &&
            (!filtro.ate || (p.vencimento ?? '') <= filtro.ate),
        )
        .sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? '')),
    );
  }
}

const ctx = (text: string, assinanteId = 'A'): MessageContext => ({
  assinanteId,
  intent: 'consulta_dados',
  message: makeMessage(text, '5511900000001'),
});

function build(
  responder: (p: LlmGenerateParams) => LlmGenerateResult,
  store = new TenantStore(),
  fin = new TenantFinStore(),
) {
  const pending = new InMemoryPending();
  const handler = new Cerebro1Handler({ llm: new FakeLlm(responder), store, pending, clock, logger, financeiro: fin });
  return { handler, store, fin, pending };
}

const procGabriel: ProcessoRow = {
  id: 'p-gab',
  numeroCnj: '00012345620248260100',
  clienteNome: 'Gabriel Machado',
  parteContraria: null,
  area: null,
  status: 'ativo',
};

function parcela(over: Partial<ParcelaAlvo>): ParcelaAlvo {
  return {
    id: randomUUID(),
    acordoId: 'ac-1',
    parcela: 1,
    totalParcelas: 10,
    valorDecimal: '1000.00',
    vencimento: '2026-07-20',
    status: 'pendente',
    descricao: null,
    pagoEm: null,
    processoId: 'p-gab',
    processoNumero: '00012345620248260100',
    clienteNome: 'Gabriel Machado',
    ...over,
  };
}

describe('registrar_honorario', () => {
  it('PARCELADO (Gabriel: 10x R$ 1.000 todo dia 20) → confirma com o PLANO COMPLETO → grava as 10', async () => {
    const store = new TenantStore();
    store.seedProc('A', procGabriel);
    const { handler, fin } = build(
      (p) =>
        p.tools
          ? tool('registrar_honorario', {
              alvo_cliente: 'Gabriel',
              valor_parcela: '1.000',
              num_parcelas: 10,
              vencimento: '2026-07-20',
              dia_vencimento: 20,
            })
          : tool('x', {}),
      store,
    );
    const r1 = await handler.handle(ctx('registra honorário de 10x R$ 1.000 todo dia 20 no processo do Gabriel'));
    expect(r1.replyText).toContain('10 parcelas de R$ 1.000,00');
    expect(r1.replyText).toContain('todo dia 20');
    expect(r1.replyText).toContain('20/07/2026 a 20/04/2027');
    expect(r1.replyText).toContain('total R$ 10.000,00');
    expect(r1.replyText).toContain('eu nunca cobro o seu cliente');
    expect(r1.replyText).toContain('SIM');

    const r2 = await handler.handle(ctx('sim'));
    expect(r2.replyText).toContain('✅ Honorário registrado');
    const gravadas = await fin.findParcelas('A', {});
    expect(gravadas).toHaveLength(10);
    expect(gravadas.every((p) => p.status === 'pendente')).toBe(true);
    expect(new Set(gravadas.map((p) => p.acordoId)).size).toBe(1);
    expect(gravadas.map((p) => p.vencimento)).toContain('2027-04-20');
  });

  it('À VISTA (R$ 10.000 vencendo 20/07) → 1 parcela única', async () => {
    const store = new TenantStore();
    store.seedProc('A', procGabriel);
    const { handler, fin } = build(
      (p) =>
        p.tools
          ? tool('registrar_honorario', { alvo_cliente: 'Gabriel', valor_total: '10.000,00', vencimento: '2026-07-20' })
          : tool('x', {}),
      store,
    );
    const r1 = await handler.handle(ctx('registra honorário de R$ 10.000 no processo do Gabriel, vencendo 20/07'));
    expect(r1.replyText).toContain('R$ 10.000,00 à vista, vencendo 20/07/2026');
    await handler.handle(ctx('sim'));
    const gravadas = await fin.findParcelas('A', {});
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]).toMatchObject({ parcela: 1, totalParcelas: 1, valorDecimal: '10000.00' });
  });

  it('arredondamento visível na confirmação (10.000 em 3: 1ª maior) e soma exata gravada', async () => {
    const store = new TenantStore();
    store.seedProc('A', procGabriel);
    const { handler, fin } = build(
      (p) =>
        p.tools
          ? tool('registrar_honorario', { alvo_cliente: 'Gabriel', valor_total: '10.000', num_parcelas: 3, vencimento: '2026-08-10' })
          : tool('x', {}),
      store,
    );
    const r1 = await handler.handle(ctx('honorário de 10 mil em 3x no Gabriel'));
    expect(r1.replyText).toContain('1ª de R$ 3.333,34');
    expect(r1.replyText).toContain('demais de R$ 3.333,33');
    await handler.handle(ctx('sim'));
    const soma = (await fin.findParcelas('A', {})).reduce((a, p) => a + Math.round(Number(p.valorDecimal) * 100), 0);
    expect(soma).toBe(1000000);
  });

  it('1º vencimento no PASSADO → pede a data certa, não grava', async () => {
    const store = new TenantStore();
    store.seedProc('A', procGabriel);
    const { handler, fin } = build(
      (p) =>
        p.tools
          ? tool('registrar_honorario', { alvo_cliente: 'Gabriel', valor_total: '1.000', vencimento: '2026-06-20' })
          : tool('x', {}),
      store,
    );
    const r = await handler.handle(ctx('honorário de mil vencendo 20/06'));
    expect(r.replyText).toContain('ficaria no passado');
    expect(await fin.findParcelas('A', {})).toHaveLength(0);
  });
});

describe('marcar_parcela_paga / cancelar_acordo', () => {
  it('duas pendentes → desambiguação numerada → escolhe → confirma → PAGA', async () => {
    const fin = new TenantFinStore();
    fin.seed('A', parcela({ parcela: 1, vencimento: '2026-07-20' }));
    fin.seed('A', parcela({ parcela: 2, vencimento: '2026-08-20' }));
    const { handler } = build(
      (p) => (p.tools ? tool('marcar_parcela_paga', { alvo_cliente: 'Gabriel' }) : tool('x', {})),
      new TenantStore(),
      fin,
    );
    const r1 = await handler.handle(ctx('a parcela do Gabriel foi paga'));
    expect(r1.replyText).toContain('Qual deles?');
    const r2 = await handler.handle(ctx('1'));
    expect(r2.replyText).toContain('marcar como *PAGA*');
    const r3 = await handler.handle(ctx('sim'));
    expect(r3.replyText).toContain('✅ Parcela marcada como *paga*');
    expect((await fin.findParcelas('A', { apenasPendentes: false })).find((p) => p.parcela === 1)!.status).toBe('pago');
  });

  it('com o MÊS na frase ("parcela de julho") → resolve direto, sem desambiguar', async () => {
    const fin = new TenantFinStore();
    fin.seed('A', parcela({ parcela: 1, vencimento: '2026-07-20' }));
    fin.seed('A', parcela({ parcela: 2, vencimento: '2026-08-20' }));
    const { handler } = build(
      (p) => (p.tools ? tool('marcar_parcela_paga', { alvo_cliente: 'Gabriel', mes: '2026-07' }) : tool('x', {})),
      new TenantStore(),
      fin,
    );
    const r1 = await handler.handle(ctx('a parcela de julho do Gabriel foi paga'));
    expect(r1.replyText).toContain('1/10');
    expect(r1.replyText).toContain('PAGA');
  });

  it('cancelar_acordo REFORÇADO: mostra pendentes/pagas → SIM cancela SÓ pendentes', async () => {
    const fin = new TenantFinStore();
    fin.seed('A', parcela({ parcela: 1, status: 'pago', pagoEm: '2026-06-20T12:00:00Z' }));
    fin.seed('A', parcela({ parcela: 2, status: 'pago', pagoEm: '2026-06-20T12:00:00Z' }));
    for (let i = 3; i <= 10; i++) fin.seed('A', parcela({ parcela: i, vencimento: `2026-0${Math.min(9, i)}-20` }));
    const { handler } = build(
      (p) => (p.tools ? tool('cancelar_acordo', { alvo_cliente: 'Gabriel' }) : tool('x', {})),
      new TenantStore(),
      fin,
    );
    const r1 = await handler.handle(ctx('cancela o acordo de honorários do Gabriel'));
    expect(r1.replyText).toContain('⚠️');
    expect(r1.replyText).toContain('CANCELAR 8 parcela(s) PENDENTE(S)');
    expect(r1.replyText).toContain('As 2 paga(s) ficam no histórico');
    const r2 = await handler.handle(ctx('sim'));
    expect(r2.replyText).toContain('8 parcela(s) pendente(s) cancelada(s)');
    const todas = await fin.findParcelas('A', { apenasPendentes: false });
    expect(todas.filter((p) => p.status === 'pago')).toHaveLength(2); // pagas PRESERVADAS
    expect(todas.filter((p) => p.status === 'cancelado')).toHaveLength(8);
  });
});

describe('consultar_financeiro (leitura determinística)', () => {
  it('totais + atrasada DERIVADA (vencimento < hoje BRT) + anti-paredão', async () => {
    const fin = new TenantFinStore();
    fin.seed('A', parcela({ parcela: 1, vencimento: '2026-06-20' })); // atrasada (hoje = 01/07)
    for (let i = 2; i <= 8; i++) fin.seed('A', parcela({ parcela: i, vencimento: `2026-1${i % 2}-2${i}` }));
    const { handler } = build(
      (p) => (p.tools ? tool('consultar_financeiro', {}) : tool('x', {})),
      new TenantStore(),
      fin,
    );
    const r = await handler.handle(ctx('o que tenho a receber?'));
    expect(r.replyText).toContain('R$ 8.000,00 em 8 parcela(s)');
    expect(r.replyText).toContain('1 atrasada(s) ⚠️');
    expect(r.replyText).toContain('… e mais 3');
    expect(r.replyText).toContain('confira antes de cobrar');
  });
});

describe('guard de pendência alheia (Passo 18 — colisão entre handlers)', () => {
  it('pendência de OUTRO handler (vincular_documento) → descarta e segue como pedido novo', async () => {
    const fin = new TenantFinStore();
    fin.seed('A', parcela({}));
    const { handler, pending } = build(
      (p) => (p.tools ? tool('consultar_financeiro', {}) : tool('x', {})),
      new TenantStore(),
      fin,
    );
    await pending.save('A', {
      acao: 'vincular_documento', // não é do Cérebro 1
      params: { docId: 'd1', processoId: 'p1' },
      fase: 'confirmando',
      faltando: [],
    });
    const r = await handler.handle(ctx('o que tenho a receber?'));
    expect(r.replyText).toContain('A receber'); // processou o pedido novo…
    expect(await pending.get('A')).toBeNull(); // …e limpou a pendência alheia
  });
});

describe('ISOLAMENTO A×B (financeiro)', () => {
  it('a consulta de A nunca contém parcela de B (números e clientes similares)', async () => {
    const fin = new TenantFinStore();
    fin.seed('A', parcela({}));
    fin.seed('B', parcela({ processoNumero: '00012345920248260100', clienteNome: 'Gabriela Machado', valorDecimal: '777.00' }));
    const { handler } = build(
      (p) => (p.tools ? tool('consultar_financeiro', { alvo_cnj: '12345' }) : tool('x', {})),
      new TenantStore(),
      fin,
    );
    const r = await handler.handle(ctx('a receber do processo 12345', 'A'));
    expect(r.replyText).toContain('R$ 1.000,00');
    expect(r.replyText).not.toContain('777');
    expect(r.replyText).not.toContain('Gabriela');
  });

  it('A tentando pagar parcela que só existe em B → "não encontrei"; id de B forjado → posse re-verificada', async () => {
    const fin = new TenantFinStore();
    const deB = parcela({ processoNumero: '00099999920248260100', clienteNome: 'Cliente B' });
    fin.seed('B', deB);
    const pending = new InMemoryPending();
    const handler = new Cerebro1Handler({
      llm: new FakeLlm((p) => (p.tools ? tool('marcar_parcela_paga', { alvo_cnj: '99999' }) : tool('x', {}))),
      store: new TenantStore(),
      pending,
      clock,
      logger,
      financeiro: fin,
    });
    const r1 = await handler.handle(ctx('paga a parcela do 99999', 'A'));
    expect(r1.replyText).toContain('Não encontrei parcela pendente');

    // Pendência FORJADA com o id da parcela de B, confirmada por A:
    await pending.save('A', { acao: 'marcar_parcela_paga', params: { _alvoId: deB.id }, fase: 'confirmando', faltando: [] });
    const r2 = await handler.handle(ctx('sim', 'A'));
    expect(r2.replyText).toContain('Não encontrei mais essa parcela');
    expect((await fin.findParcelas('B', {}))[0]!.status).toBe('pendente'); // B intacto
  });
});

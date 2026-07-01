/**
 * consultar_ficha no handler do Cérebro 1 (Passo 15), via InboundMessage
 * simulado: ficha completa, seções vazias honestas, desambiguação numerada,
 * inexistente claro e ISOLAMENTO adversarial (A×B com números similares).
 */
import { describe, expect, it } from 'vitest';
import { Cerebro1Handler } from '../src/application/cerebro1/cerebro1-handler';
import { FichaProcessoService } from '../src/application/cerebro1/ficha-processo';
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
import type { FichaBruta, FichaStore } from '../src/core/ports/ficha';
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

/** Store por tenant; só o que a ficha usa de verdade (resto inerte). */
class TenantStore implements Cerebro1Store {
  proc = new Map<string, ProcessoRow[]>();
  seedProc(tenant: string, p: ProcessoRow): void {
    const arr = this.proc.get(tenant) ?? [];
    arr.push(p);
    this.proc.set(tenant, arr);
  }
  findProcessos(tenant: string, sel: ProcessoSelector): Promise<ProcessoRow[]> {
    const arr = this.proc.get(tenant) ?? []; // ESCOPADO: só o acervo do tenant
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
  // inertes para estes testes:
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
  getProcessoById(tenant: string, id: string): Promise<ProcessoRow | null> {
    return Promise.resolve((this.proc.get(tenant) ?? []).find((p) => p.id === id) ?? null);
  }
  updateProcesso(): Promise<boolean> {
    return Promise.resolve(false);
  }
  arquivarProcesso(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** FichaStore por tenant, honrando o contrato: posse re-verificada. */
class TenantFichaStore implements FichaStore {
  dados = new Map<string, Map<string, FichaBruta>>();
  chamadas: Array<{ assinanteId: string; processoId: string }> = [];
  seed(tenant: string, bruta: FichaBruta): void {
    const m = this.dados.get(tenant) ?? new Map<string, FichaBruta>();
    m.set(bruta.processo.id, bruta);
    this.dados.set(tenant, m);
  }
  getFichaBruta(assinanteId: string, processoId: string): Promise<FichaBruta | null> {
    this.chamadas.push({ assinanteId, processoId });
    return Promise.resolve(this.dados.get(assinanteId)?.get(processoId) ?? null);
  }
}

function brutaCompleta(id: string, numero: string, marcador: string): FichaBruta {
  return {
    processo: {
      id,
      numeroCnj: numero,
      clienteNome: `Cliente ${marcador}`,
      parteContraria: `Parte ${marcador}`,
      vara: '2ª Vara Cível',
      comarca: 'São Paulo',
      area: 'cível',
      valorCausa: '10000.00',
      status: 'ativo',
      fase: 'conhecimento',
      instancia: '1º grau',
      segredoJustica: false,
    },
    compromissos: [
      { id: `c-${marcador}`, tipo: 'audiencia', dataHora: '2026-07-15T17:00:00Z', descricao: `Instrução ${marcador}` },
    ],
    documentos: [
      { id: `d-${marcador}`, nome: `contrato-${marcador}.pdf`, extracaoStatus: 'ok', enviadoEm: '2026-06-01T00:00:00Z' },
    ],
    lancamentos: [
      { id: `l-${marcador}`, tipo: 'honorario', valor: '500.00', vencimento: '2026-08-01', status: 'pendente' },
    ],
  };
}

function procRow(id: string, numero: string, cliente: string): ProcessoRow {
  return { id, numeroCnj: numero, clienteNome: cliente, parteContraria: null, area: null, status: 'ativo' };
}

const ctx = (text: string, assinanteId = 'A'): MessageContext => ({
  assinanteId,
  intent: 'consulta_dados',
  message: makeMessage(text, '5511900000001'),
});

function build(
  responder: (p: LlmGenerateParams) => LlmGenerateResult,
  store: TenantStore,
  fichaStore: TenantFichaStore,
) {
  const pending = new InMemoryPending();
  const handler = new Cerebro1Handler({
    llm: new FakeLlm(responder),
    store,
    pending,
    clock,
    logger,
    ficha: new FichaProcessoService({ store: fichaStore, clock }),
  });
  return { handler, pending };
}

const pedirFicha = (input: Record<string, unknown>) => (p: LlmGenerateParams) =>
  p.tools ? tool('consultar_ficha', input) : tool('x', {});

describe('Cérebro 1 — consultar_ficha (Passo 15)', () => {
  it('processo com tudo vinculado → ficha completa por fragmento do número', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    store.seedProc('A', procRow('p-a', '00012345620248260100', 'Maria Silva'));
    fichas.seed('A', brutaCompleta('p-a', '00012345620248260100', 'A'));
    const { handler } = build(pedirFicha({ alvo_cnj: '12345' }), store, fichas);

    const r = await handler.handle(ctx('mostra a ficha do processo 12345'));
    expect(r.replyText).toContain('📁 *Ficha do processo*');
    expect(r.replyText).toContain('👤 Cliente: Cliente A');
    expect(r.replyText).toContain('audiência');
    expect(r.replyText).toContain('contrato-A.pdf');
    expect(r.replyText).toContain('pendente(s)');
    expect(r.replyText).toContain('confira nos autos');
  });

  it('ficha por nome do cliente ("resumo do processo do Gabriel")', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    store.seedProc('A', procRow('p-g', '00098765420248260100', 'Gabriel Machado'));
    fichas.seed('A', brutaCompleta('p-g', '00098765420248260100', 'G'));
    const { handler } = build(pedirFicha({ alvo_cliente: 'Gabriel' }), store, fichas);

    const r = await handler.handle(ctx('me dá um resumo do processo do Gabriel'));
    expect(r.replyText).toContain('Cliente G');
  });

  it('processo vazio → seções vazias HONESTAS (não somem)', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    store.seedProc('A', procRow('p-v', '00011122233344455566', 'Novo Cliente'));
    fichas.seed('A', {
      ...brutaCompleta('p-v', '00011122233344455566', 'V'),
      compromissos: [],
      documentos: [],
      lancamentos: [],
    });
    const { handler } = build(pedirFicha({ alvo_cnj: '11122' }), store, fichas);

    const r = await handler.handle(ctx('ficha do processo 11122'));
    expect(r.replyText).toContain('sem compromissos vinculados ainda.');
    expect(r.replyText).toContain('nenhum vinculado ainda.');
    expect(r.replyText).toContain('sem lançamentos ainda.');
  });

  it('referência ambígua → desambiguação numerada; o número escolhido resolve', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    store.seedProc('A', procRow('p-1', '00012345620248260100', 'Maria'));
    store.seedProc('A', procRow('p-2', '00012345920138260100', 'João'));
    fichas.seed('A', brutaCompleta('p-1', '00012345620248260100', 'UM'));
    fichas.seed('A', brutaCompleta('p-2', '00012345920138260100', 'DOIS'));
    const { handler, pending } = build(pedirFicha({ alvo_cnj: '12345' }), store, fichas);

    const r1 = await handler.handle(ctx('ficha do processo 12345'));
    expect(r1.replyText).toContain('Qual deles?');
    expect(r1.replyText).toContain('1)');
    expect(r1.replyText).toContain('2)');
    expect((await pending.get('A'))?.fase).toBe('desambiguando');

    const r2 = await handler.handle(ctx('2'));
    expect(r2.replyText).toContain('Cliente DOIS'); // resolveu o certo, sem confirmação
    expect(await pending.get('A')).toBeNull();
  });

  it('número fora da lista → re-pede sem adivinhar', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    store.seedProc('A', procRow('p-1', '00012345620248260100', 'Maria'));
    store.seedProc('A', procRow('p-2', '00012345920138260100', 'João'));
    const { handler } = build(pedirFicha({ alvo_cnj: '12345' }), store, fichas);
    await handler.handle(ctx('ficha do 12345'));
    const r = await handler.handle(ctx('7'));
    expect(r.replyText).toContain('Não entendi qual');
  });

  it('inexistente → resposta clara', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    const { handler } = build(pedirFicha({ alvo_cnj: '99999' }), store, fichas);
    const r = await handler.handle(ctx('ficha do processo 99999'));
    expect(r.replyText).toContain('Não encontrei esse processo');
  });

  it('ISOLAMENTO adversarial: B tem processo de número SIMILAR com filhos "parecidos" — nada de B aparece para A', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    // A e B compartilham o fragmento 12345 nos números; filhos de B são "parecidos".
    store.seedProc('A', procRow('p-a', '00012345620248260100', 'Maria Silva'));
    store.seedProc('B', procRow('p-b', '00012345920248260100', 'Maria Silveira'));
    fichas.seed('A', brutaCompleta('p-a', '00012345620248260100', 'A'));
    fichas.seed('B', brutaCompleta('p-b', '00012345920248260100', 'B'));
    const { handler } = build(pedirFicha({ alvo_cnj: '12345' }), store, fichas);

    const r = await handler.handle(ctx('ficha do processo 12345', 'A'));
    // Sem desambiguação: o processo de B nem entra na lista de candidatos de A.
    expect(r.replyText).toContain('📁 *Ficha do processo*');
    expect(r.replyText).toContain('Cliente A');
    expect(r.replyText).not.toContain('Cliente B');
    expect(r.replyText).not.toContain('contrato-B.pdf');
    // A agregação só foi chamada com a identidade de A e o processo de A:
    expect(fichas.chamadas).toEqual([{ assinanteId: 'A', processoId: 'p-a' }]);
  });

  it('ISOLAMENTO: id de processo de B injetado na desambiguação de A → nada vaza (posse re-verificada)', async () => {
    const store = new TenantStore();
    const fichas = new TenantFichaStore();
    store.seedProc('B', procRow('p-b', '00012345920248260100', 'Cliente B'));
    fichas.seed('B', brutaCompleta('p-b', '00012345920248260100', 'B'));
    const pending = new InMemoryPending();
    const handler = new Cerebro1Handler({
      llm: new FakeLlm(pedirFicha({ alvo_cnj: '12345' })),
      store,
      pending,
      clock,
      logger,
      ficha: new FichaProcessoService({ store: fichas, clock }),
    });
    // Pendência FORJADA apontando para o processo de B (pior caso):
    await pending.save('A', {
      acao: 'consultar_ficha',
      params: { _candidatos: [{ id: 'p-b', label: 'processo' }] },
      fase: 'desambiguando',
      faltando: [],
    });
    const r = await handler.handle(ctx('1', 'A'));
    // getFichaBruta re-verifica a posse: chamado com identidade A → null → nada de B.
    expect(r.replyText).toContain('Não encontrei mais esse processo');
    expect(r.replyText).not.toContain('Cliente B');
    expect(fichas.chamadas).toEqual([{ assinanteId: 'A', processoId: 'p-b' }]);
  });
});

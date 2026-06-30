import { describe, expect, it } from 'vitest';
import { Cerebro1Handler } from '../src/application/cerebro1/cerebro1-handler';
import type { MessageContext } from '../src/core/orchestration/handler';
import type {
  Cerebro1Store,
  CompromissoAlvo,
  CompromissoPatch,
  CompromissoRow,
  NovoCompromisso,
  NovoProcesso,
  PendingAction,
  PendingActionStore,
  ProcessoPatch,
  ProcessoRow,
  ProcessoSelector,
  CompromissoSelector,
} from '../src/core/ports/cerebro1';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';
import { makeMessage } from './helpers';

const CLOCK = new Date('2026-06-29T12:00:00.000Z');
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

function diaBRT(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Store CIENTE DE TENANT: tudo escopado por assinante; ids nunca cruzam. */
class TenantStore implements Cerebro1Store {
  comp = new Map<string, CompromissoAlvo[]>();
  lembretes = new Map<string, string[]>(); // compromissoId -> lembrete_em
  enviadosLimpos: string[] = [];
  deletados: string[] = [];
  procUpdates: Array<{ id: string; patch: ProcessoPatch }> = [];
  arquivados: string[] = [];
  proc = new Map<string, ProcessoRow[]>();

  seedComp(tenant: string, c: CompromissoAlvo, lembrete: string[] = []): void {
    const arr = this.comp.get(tenant) ?? [];
    arr.push(c);
    this.comp.set(tenant, arr);
    this.lembretes.set(c.id, lembrete);
  }
  seedProc(tenant: string, p: ProcessoRow): void {
    const arr = this.proc.get(tenant) ?? [];
    arr.push(p);
    this.proc.set(tenant, arr);
  }

  // criar/listar (não foco aqui)
  criarCompromisso(_id: string, c: NovoCompromisso): Promise<CompromissoRow> {
    return Promise.resolve({ id: 'x', tipo: c.tipo, dataHora: c.dataHora, descricao: c.descricao, local: null, processoId: c.processoId });
  }
  listarCompromissos(): Promise<CompromissoRow[]> {
    return Promise.resolve([]);
  }
  resolveProcessoIdByCnj(tenant: string, cnj: string): Promise<string | null> {
    const p = (this.proc.get(tenant) ?? []).find((x) => x.numeroCnj === cnj);
    return Promise.resolve(p?.id ?? null);
  }
  upsertClienteByNome(_id: string, nome: string): Promise<string> {
    return Promise.resolve(`cli-${nome}`);
  }
  cadastrarProcesso(_id: string, p: NovoProcesso): Promise<ProcessoRow> {
    return Promise.resolve({ id: 'p', numeroCnj: p.numeroCnj, clienteNome: null, parteContraria: p.parteContraria, area: p.area, status: p.status });
  }
  listarProcessos(tenant: string): Promise<ProcessoRow[]> {
    return Promise.resolve(this.proc.get(tenant) ?? []);
  }
  consultarProcesso(tenant: string): Promise<ProcessoRow[]> {
    return Promise.resolve(this.proc.get(tenant) ?? []);
  }

  findCompromissos(tenant: string, sel: CompromissoSelector): Promise<CompromissoAlvo[]> {
    const arr = this.comp.get(tenant) ?? [];
    return Promise.resolve(
      arr.filter(
        (c) =>
          (!sel.numeroCnj || c.processoNumero === sel.numeroCnj) &&
          (!sel.tipo || c.tipo === sel.tipo) &&
          (!sel.dia || diaBRT(c.dataHora) === sel.dia),
      ),
    );
  }
  getCompromissoById(tenant: string, id: string): Promise<CompromissoAlvo | null> {
    return Promise.resolve((this.comp.get(tenant) ?? []).find((c) => c.id === id) ?? null);
  }
  updateCompromisso(tenant: string, id: string, patch: CompromissoPatch): Promise<boolean> {
    const c = (this.comp.get(tenant) ?? []).find((x) => x.id === id);
    if (!c) return Promise.resolve(false);
    if (patch.tipo) c.tipo = patch.tipo;
    if (patch.descricao !== undefined) c.descricao = patch.descricao;
    if (patch.dataHora) c.dataHora = patch.dataHora;
    if (patch.lembreteEm) {
      this.lembretes.set(id, patch.lembreteEm);
      this.enviadosLimpos.push(id); // espelha o DELETE em lembretes_enviados
    }
    return Promise.resolve(true);
  }
  deleteCompromisso(tenant: string, id: string): Promise<boolean> {
    const arr = this.comp.get(tenant) ?? [];
    const idx = arr.findIndex((c) => c.id === id);
    if (idx < 0) return Promise.resolve(false);
    arr.splice(idx, 1);
    this.deletados.push(id);
    this.lembretes.delete(id); // cascade
    return Promise.resolve(true);
  }
  findProcessos(tenant: string, sel: ProcessoSelector): Promise<ProcessoRow[]> {
    const arr = this.proc.get(tenant) ?? [];
    return Promise.resolve(
      arr.filter(
        (p) =>
          (!sel.numeroCnj || p.numeroCnj === sel.numeroCnj) &&
          (!sel.clienteNome || (p.clienteNome ?? '').toLowerCase().includes(sel.clienteNome.toLowerCase())) &&
          (!sel.parte || (p.parteContraria ?? '').toLowerCase().includes(sel.parte.toLowerCase())),
      ),
    );
  }
  getProcessoById(tenant: string, id: string): Promise<ProcessoRow | null> {
    return Promise.resolve((this.proc.get(tenant) ?? []).find((p) => p.id === id) ?? null);
  }
  updateProcesso(tenant: string, id: string, patch: ProcessoPatch): Promise<boolean> {
    const p = (this.proc.get(tenant) ?? []).find((x) => x.id === id);
    if (!p) return Promise.resolve(false);
    if (patch.status !== undefined && patch.status !== null) p.status = patch.status;
    this.procUpdates.push({ id, patch });
    return Promise.resolve(true);
  }
  arquivarProcesso(tenant: string, id: string): Promise<boolean> {
    const p = (this.proc.get(tenant) ?? []).find((x) => x.id === id);
    if (!p) return Promise.resolve(false);
    p.status = 'arquivado';
    this.arquivados.push(id);
    return Promise.resolve(true);
  }
}

const ctx = (text: string, assinanteId = 'A'): MessageContext => ({
  assinanteId,
  intent: 'consulta_dados',
  message: makeMessage(text, '5511900000001'),
});

function build(responder: (p: LlmGenerateParams) => LlmGenerateResult, store = new TenantStore()) {
  const pending = new InMemoryPending();
  const handler = new Cerebro1Handler({ llm: new FakeLlm(responder), store, pending, clock, logger });
  return { handler, store, pending };
}

const compA = (over: Partial<CompromissoAlvo> = {}): CompromissoAlvo => ({
  id: 'c1',
  tipo: 'audiencia',
  dataHora: '2026-07-15T17:00:00.000Z',
  descricao: 'Instrução',
  processoId: 'p1',
  processoNumero: '00012345620248260100',
  clienteNome: 'Maria Silva',
  ...over,
});

describe('Cerebro1 — editar compromisso', () => {
  it('editar descrição → confirma → grava (sem mexer em lembrete)', async () => {
    const store = new TenantStore();
    store.seedComp('A', compA(), ['L1', 'L2']);
    const { handler } = build(
      (p) => (p.tools ? tool('editar_compromisso', { alvo_tipo: 'audiencia', nova_descricao: 'Instrução e oitiva' }) : tool('x', {})),
      store,
    );
    const r1 = await handler.handle(ctx('muda a descrição da audiência'));
    expect(r1.replyText).toContain('alterar');
    const r2 = await handler.handle(ctx('sim'));
    expect(r2.replyText).toContain('atualizado');
    expect(store.comp.get('A')![0]!.descricao).toBe('Instrução e oitiva');
    expect(store.lembretes.get('c1')).toEqual(['L1', 'L2']); // não tocou
    expect(store.enviadosLimpos).toEqual([]); // não limpou (data não mudou)
  });

  it('editar DATA → recalcula lembretes (antigo some, novos na data certa) e limpa enviados', async () => {
    const store = new TenantStore();
    store.seedComp('A', compA(), ['2026-07-14T17:00:00.000Z', '2026-07-15T16:00:00.000Z']);
    const novaData = '2026-07-18T17:00:00.000Z';
    const { handler } = build(
      (p) => (p.tools ? tool('editar_compromisso', { alvo_tipo: 'audiencia', nova_data_hora: novaData }) : tool('x', {})),
      store,
    );
    await handler.handle(ctx('remarca a audiência'));
    await handler.handle(ctx('sim'));
    const novos = store.lembretes.get('c1')!;
    expect(novos).toEqual([
      new Date(new Date(novaData).getTime() - 24 * 3600_000).toISOString(),
      new Date(new Date(novaData).getTime() - 3600_000).toISOString(),
    ]);
    expect(novos).not.toContain('2026-07-14T17:00:00.000Z'); // antigo sumiu
    expect(store.enviadosLimpos).toContain('c1'); // marcação antiga limpa
  });

  it('remarcar para daqui a 30 min → nenhum lembrete no passado', async () => {
    const store = new TenantStore();
    store.seedComp('A', compA(), ['old']);
    const novaData = new Date(CLOCK.getTime() + 30 * 60_000).toISOString(); // +30min (futuro)
    const { handler } = build(
      (p) => (p.tools ? tool('editar_compromisso', { alvo_tipo: 'audiencia', nova_data_hora: novaData }) : tool('x', {})),
      store,
    );
    await handler.handle(ctx('remarca pra daqui a pouco'));
    await handler.handle(ctx('sim'));
    expect(store.lembretes.get('c1')).toEqual([]); // 24h/1h antes já passaram → nada no passado
  });

  it('nova data no passado → recusa (não confirma)', async () => {
    const store = new TenantStore();
    store.seedComp('A', compA());
    const { handler, store: s } = build(
      (p) => (p.tools ? tool('editar_compromisso', { alvo_tipo: 'audiencia', nova_data_hora: '2020-01-01T10:00:00Z' }) : tool('x', {})),
      store,
    );
    const r = await handler.handle(ctx('remarca a audiência para 2020'));
    expect(r.replyText.toLowerCase()).toContain('futuro');
    expect(s.enviadosLimpos).toEqual([]); // nada atualizado
    expect(s.comp.get('A')![0]!.dataHora).toBe('2026-07-15T17:00:00.000Z'); // data intacta
  });
});

describe('Cerebro1 — cancelar compromisso (destrutivo)', () => {
  it('confirmação REFORÇADA mostra o registro real; "sim" remove e cancela lembretes', async () => {
    const store = new TenantStore();
    store.seedComp('A', compA(), ['L1']);
    const { handler } = build(
      (p) => (p.tools ? tool('cancelar_compromisso', { alvo_tipo: 'audiencia' }) : tool('x', {})),
      store,
    );
    const r1 = await handler.handle(ctx('cancela a audiência'));
    expect(r1.replyText).toContain('REMOVER');
    expect(r1.replyText).toContain('Maria Silva'); // registro real
    expect(r1.replyText.toLowerCase()).toContain('definitivo');
    const r2 = await handler.handle(ctx('sim'));
    expect(r2.replyText).toContain('removido');
    expect(store.deletados).toEqual(['c1']);
    expect(store.comp.get('A')).toEqual([]);
    expect(store.lembretes.has('c1')).toBe(false); // não gera mais lembrete
  });

  it('ambiguidade: 2 compromissos → pergunta qual; "2" → confirma o 2º', async () => {
    const store = new TenantStore();
    store.seedComp('A', compA({ id: 'c1', dataHora: '2026-07-15T17:00:00.000Z' }));
    store.seedComp('A', compA({ id: 'c2', dataHora: '2026-07-15T19:00:00.000Z', clienteNome: 'João' }));
    const { handler, pending } = build(
      (p) => (p.tools ? tool('cancelar_compromisso', { alvo_tipo: 'audiencia', alvo_dia: '2026-07-15' }) : tool('x', {})),
      store,
    );
    const r1 = await handler.handle(ctx('cancela a audiência de 15/07'));
    expect(r1.replyText).toContain('Qual deles');
    expect((await pending.get('A'))?.fase).toBe('desambiguando');
    const r2 = await handler.handle(ctx('2'));
    expect(r2.replyText).toContain('REMOVER');
    expect(r2.replyText).toContain('João'); // o 2º
    const r3 = await handler.handle(ctx('sim'));
    expect(store.deletados).toEqual(['c2']); // removeu só o escolhido
    void r3;
  });

  it('nenhum compromisso casa → resposta clara', async () => {
    const { handler } = build((p) => (p.tools ? tool('cancelar_compromisso', { alvo_tipo: 'reuniao' }) : tool('x', {})));
    const r = await handler.handle(ctx('cancela a reunião'));
    expect(r.replyText).toContain('Não encontrei');
  });
});

describe('Cerebro1 — processo: editar e arquivar', () => {
  it('editar status → confirma → aplica', async () => {
    const store = new TenantStore();
    store.seedProc('A', { id: 'p1', numeroCnj: '00012345620248260100', clienteNome: 'Maria', parteContraria: null, area: null, status: 'ativo' });
    const { handler } = build(
      (p) => (p.tools ? tool('editar_processo', { alvo_cnj: '0001234-56.2024.8.26.0100', novo_status: 'suspenso' }) : tool('x', {})),
      store,
    );
    await handler.handle(ctx('muda o status do processo'));
    const r = await handler.handle(ctx('sim'));
    expect(r.replyText).toContain('atualizado');
    expect(store.proc.get('A')![0]!.status).toBe('suspenso');
  });

  it('arquivar → confirma → status arquivado', async () => {
    const store = new TenantStore();
    store.seedProc('A', { id: 'p1', numeroCnj: '00012345620248260100', clienteNome: 'Maria', parteContraria: null, area: null, status: 'ativo' });
    const { handler } = build(
      (p) => (p.tools ? tool('arquivar_processo', { alvo_cnj: '0001234-56.2024.8.26.0100' }) : tool('x', {})),
      store,
    );
    const r1 = await handler.handle(ctx('arquiva esse processo'));
    expect(r1.replyText).toContain('arquivar');
    await handler.handle(ctx('sim'));
    expect(store.arquivados).toEqual(['p1']);
    expect(store.proc.get('A')![0]!.status).toBe('arquivado');
  });
});

describe('Cerebro1 — ISOLAMENTO em editar/remover', () => {
  it('B não acha o compromisso de A para cancelar (resolução escopada)', async () => {
    const store = new TenantStore();
    store.seedComp('A', compA(), ['L1']);
    const { handler } = build(
      (p) => (p.tools ? tool('cancelar_compromisso', { alvo_tipo: 'audiencia' }) : tool('x', {})),
      store,
    );
    const r = await handler.handle(ctx('cancela a audiência', 'B'));
    expect(r.replyText).toContain('Não encontrei');
    expect(store.comp.get('A')).toHaveLength(1); // o de A intacto
    expect(store.deletados).toEqual([]);
  });

  it('desambiguação re-verifica tenant: id de B nunca resolve no contexto de A', async () => {
    const store = new TenantStore();
    store.seedComp('B', compA({ id: 'cB' }), ['L1']); // compromisso é do B
    const { handler, pending } = build(
      () => tool('x', {}),
      store,
    );
    // Pendência forjada: A em desambiguando com um candidato que é do B.
    await pending.save('A', {
      acao: 'cancelar_compromisso',
      params: { alvoTipo: 'audiencia', _candidatos: [{ id: 'cB', label: 'audiência' }] },
      fase: 'desambiguando',
      faltando: [],
    });
    const r = await handler.handle(ctx('1', 'A')); // A escolhe o candidato (id do B)
    expect(r.replyText).toContain('Não encontrei mais'); // re-verificação por tenant barra
    expect(store.comp.get('B')).toHaveLength(1); // o de B intacto
    expect(store.deletados).toEqual([]);
  });
});

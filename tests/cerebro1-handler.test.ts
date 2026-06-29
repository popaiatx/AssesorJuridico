import { describe, expect, it } from 'vitest';
import { Cerebro1Handler } from '../src/application/cerebro1/cerebro1-handler';
import type { MessageContext } from '../src/core/orchestration/handler';
import type {
  Cerebro1Store,
  CompromissoRow,
  NovoCompromisso,
  NovoProcesso,
  PendingAction,
  PendingActionStore,
  ProcessoRow,
} from '../src/core/ports/cerebro1';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';
import { makeMessage } from './helpers';

class FakeLlm implements LlmPort {
  calls: LlmGenerateParams[] = [];
  constructor(private readonly responder: (p: LlmGenerateParams) => LlmGenerateResult) {}
  generate(p: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.calls.push(p);
    return Promise.resolve(this.responder(p));
  }
}

function toolCall(name: string, input: Record<string, unknown>): LlmGenerateResult {
  return { text: '', toolCalls: [{ id: 't', name, input }], stopReason: 'tool_use' };
}
function textResult(text: string): LlmGenerateResult {
  return { text, toolCalls: [], stopReason: 'end_turn' };
}

class InMemoryPending implements PendingActionStore {
  m = new Map<string, PendingAction>();
  get(id: string): Promise<PendingAction | null> {
    return Promise.resolve(this.m.get(id) ?? null);
  }
  save(id: string, p: PendingAction): Promise<void> {
    this.m.set(id, p);
    return Promise.resolve();
  }
  clear(id: string): Promise<void> {
    this.m.delete(id);
    return Promise.resolve();
  }
}

class InMemoryStore implements Cerebro1Store {
  criadosCompromisso: Array<{ id: string; c: NovoCompromisso }> = [];
  criadosProcesso: Array<{ id: string; p: NovoProcesso }> = [];
  processosPorTenant = new Map<string, ProcessoRow[]>();

  criarCompromisso(assinanteId: string, c: NovoCompromisso): Promise<CompromissoRow> {
    this.criadosCompromisso.push({ id: assinanteId, c });
    return Promise.resolve({
      id: 'c1',
      tipo: c.tipo,
      dataHora: c.dataHora,
      descricao: c.descricao,
      local: null,
      processoId: c.processoId,
    });
  }
  listarCompromissos(): Promise<CompromissoRow[]> {
    return Promise.resolve([]);
  }
  resolveProcessoIdByCnj(): Promise<string | null> {
    return Promise.resolve(null);
  }
  upsertClienteByNome(_id: string, nome: string): Promise<string> {
    return Promise.resolve(`cli-${nome}`);
  }
  cadastrarProcesso(assinanteId: string, p: NovoProcesso): Promise<ProcessoRow> {
    this.criadosProcesso.push({ id: assinanteId, p });
    return Promise.resolve({
      id: 'p1',
      numeroCnj: p.numeroCnj,
      clienteNome: null,
      parteContraria: p.parteContraria,
      area: p.area,
      status: p.status,
    });
  }
  listarProcessos(assinanteId: string): Promise<ProcessoRow[]> {
    return Promise.resolve(this.processosPorTenant.get(assinanteId) ?? []);
  }
  consultarProcesso(assinanteId: string): Promise<ProcessoRow[]> {
    return Promise.resolve(this.processosPorTenant.get(assinanteId) ?? []);
  }
}

const clock = () => new Date('2026-06-29T12:00:00.000Z');
const logger = { error: () => {} };

function ctx(text: string, assinanteId = 'A'): MessageContext {
  return { assinanteId, intent: 'consulta_dados', message: makeMessage(text, '5511900000001') };
}

function build(responder: (p: LlmGenerateParams) => LlmGenerateResult) {
  const llm = new FakeLlm(responder);
  const store = new InMemoryStore();
  const pending = new InMemoryPending();
  const handler = new Cerebro1Handler({ llm, store, pending, clock, logger });
  return { handler, store, pending, llm };
}

describe('Cerebro1Handler — escrita com confirmação', () => {
  it('agendar → confirma antes de gravar; só grava após "sim"', async () => {
    const { handler, store, pending } = build((p) =>
      p.tools
        ? toolCall('criar_compromisso', {
            tipo: 'audiencia',
            data_hora: '2026-07-02T14:00:00-03:00',
            descricao: 'Instrução',
          })
        : textResult('x'),
    );

    const r1 = await handler.handle(ctx('agendar audiência dia 2/7 às 14h, instrução'));
    expect(r1.replyText).toContain('Confirmar');
    expect(store.criadosCompromisso).toHaveLength(0); // ainda não gravou
    expect((await pending.get('A'))?.fase).toBe('confirmando');

    const r2 = await handler.handle(ctx('sim'));
    expect(store.criadosCompromisso).toHaveLength(1);
    expect(store.criadosCompromisso[0]!.id).toBe('A'); // escopado pelo tenant da identidade
    expect(r2.replyText).toContain('Agendado');
    expect(await pending.get('A')).toBeNull();
  });

  it('"não" cancela sem gravar', async () => {
    const { handler, store, pending } = build((p) =>
      p.tools
        ? toolCall('cadastrar_processo', { cliente_nome: 'Maria' })
        : textResult('x'),
    );
    await handler.handle(ctx('cadastrar processo do cliente Maria'));
    const r = await handler.handle(ctx('não'));
    expect(store.criadosProcesso).toHaveLength(0);
    expect(r.replyText.toLowerCase()).toContain('cancel');
    expect(await pending.get('A')).toBeNull();
  });

  it('faltando dado → pergunta só o que falta e completa depois (slot-filling)', async () => {
    let phase = 0;
    const { handler, pending } = build((p) => {
      if (!p.tools) return textResult('x');
      phase++;
      return phase === 1
        ? toolCall('criar_compromisso', { tipo: 'audiencia', descricao: 'Instrução' }) // sem data
        : toolCall('criar_compromisso', { data_hora: '2026-07-02T14:00:00-03:00' });
    });

    const r1 = await handler.handle(ctx('marca uma audiência de instrução'));
    expect(r1.replyText.toLowerCase()).toContain('quando'); // pergunta a data
    expect((await pending.get('A'))?.fase).toBe('coletando');

    const r2 = await handler.handle(ctx('dia 2/7 às 14h'));
    expect(r2.replyText).toContain('Confirmar'); // completou → confirma
  });
});

describe('Cerebro1Handler — leitura com anonimização', () => {
  it('processos: payload ao LLM não vaza o nome; resposta reidentifica', async () => {
    const { handler, store, llm } = build((p) =>
      p.tools ? toolCall('listar_processos', {}) : textResult(p.messages[0]!.content),
    );
    store.processosPorTenant.set('A', [
      { id: 'p1', numeroCnj: '00012345620248260100', clienteNome: 'Maria Silva', parteContraria: 'Empresa X', area: null, status: 'ativo' },
    ]);

    const r = await handler.handle(ctx('meus processos'));

    // 2ª chamada (sem tools) = redação a partir dos dados anonimizados.
    const readCall = llm.calls.find((c) => !c.tools)!;
    expect(readCall.messages[0]!.content).not.toContain('Maria Silva');
    expect(readCall.messages[0]!.content).toContain('Cliente A');
    expect(r.replyText).toContain('Maria Silva'); // reidentificado na resposta final
  });
});

describe('Cerebro1Handler — resposta útil fora de escopo', () => {
  it('sem ação → devolve o texto útil do LLM (não "não entendi" seco)', async () => {
    const { handler } = build((p) =>
      p.tools ? textResult('Posso organizar processos, prazos e compromissos.') : textResult('x'),
    );
    const r = await handler.handle(ctx('qual o prazo de contestação no CPC?'));
    expect(r.replyText).toContain('organiz');
  });
});

describe('Cerebro1Handler — ISOLAMENTO entre usuários (obrigatório)', () => {
  it('confirmação de A não é executada por B; B não vê dados de A', async () => {
    const { handler, store, pending } = build((p) =>
      p.tools ? toolCall('cadastrar_processo', { cliente_nome: 'Maria' }) : textResult('x'),
    );

    // A inicia um cadastro e fica em "confirmando".
    await handler.handle(ctx('cadastrar processo do cliente Maria', 'A'));
    expect((await pending.get('A'))?.fase).toBe('confirmando');

    // B manda "sim": B NÃO tem pendência → não executa a ação de A.
    const rB = await handler.handle(ctx('sim', 'B'));
    expect(store.criadosProcesso).toHaveLength(0); // nada gravado por causa do "sim" de B
    expect((await pending.get('A'))?.fase).toBe('confirmando'); // pendência de A intacta
    expect(rB.replyText).not.toContain('cadastrado');

    // Dados: A tem um processo; B lista e não vê nada de A.
    store.processosPorTenant.set('A', [
      { id: 'p1', numeroCnj: '1', clienteNome: 'Maria', parteContraria: null, area: null, status: 'ativo' },
    ]);
    const { handler: h2 } = build((p) => (p.tools ? toolCall('listar_processos', {}) : textResult(p.messages[0]!.content)));
    // reusa o mesmo store para B:
    const handlerB = new Cerebro1Handler({
      llm: new FakeLlm((p) => (p.tools ? toolCall('listar_processos', {}) : textResult(p.messages[0]!.content))),
      store,
      pending,
      clock,
      logger,
    });
    const rList = await handlerB.handle(ctx('meus processos', 'B'));
    expect(rList.replyText).toContain('Não encontrei'); // B não vê o processo de A
    void h2;

    // E A, depois, confirma e grava só o SEU.
    const rA = await handler.handle(ctx('sim', 'A'));
    expect(store.criadosProcesso).toHaveLength(1);
    expect(store.criadosProcesso[0]!.id).toBe('A');
    expect(rA.replyText).toContain('cadastrado');
  });
});

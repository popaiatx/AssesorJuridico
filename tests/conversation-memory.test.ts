import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/application/orchestrator';
import {
  fontesRecentes,
  intentRecente,
  isWarm,
  trimTurnos,
  type RecentContext,
} from '../src/core/domain/conversation/memory';
import type { Intent } from '../src/core/domain/intents';
import type {
  HandlerRegistry,
  IntentHandler,
  MessageContext,
} from '../src/core/orchestration/handler';
import type {
  ConversationMemoryStore,
  ConversationTurn,
  StoredMemory,
} from '../src/core/ports/conversation-memory';
import type { ClassificationResult, IntentClassifier } from '../src/core/ports/intent-classifier';
import { InMemoryInteractionLog, makeMessage } from './helpers';

// --- Fakes ---

class FakeMemoryStore implements ConversationMemoryStore {
  data = new Map<string, { turnos: ConversationTurn[]; atualizadoEm: string }>();
  loads: string[] = [];
  saves: Array<{ id: string; turnos: ConversationTurn[] }> = [];
  clears: string[] = [];
  seed(id: string, turnos: ConversationTurn[], atualizadoEm: string): void {
    this.data.set(id, { turnos, atualizadoEm });
  }
  load(id: string): Promise<StoredMemory> {
    this.loads.push(id);
    const r = this.data.get(id);
    return Promise.resolve(r ? { turnos: r.turnos, atualizadoEm: r.atualizadoEm } : { turnos: [], atualizadoEm: null });
  }
  save(id: string, turnos: ConversationTurn[]): Promise<void> {
    this.saves.push({ id, turnos });
    this.data.set(id, { turnos, atualizadoEm: 'saved' });
    return Promise.resolve();
  }
  clear(id: string): Promise<void> {
    this.clears.push(id);
    this.data.delete(id);
    return Promise.resolve();
  }
}

class RecordingClassifier implements IntentClassifier {
  public lastContext?: RecentContext;
  constructor(private readonly result: ClassificationResult) {}
  classify(_t: string, ctx?: RecentContext): Promise<ClassificationResult> {
    this.lastContext = ctx;
    return Promise.resolve(this.result);
  }
}

function clear(intent: Intent): RecordingClassifier {
  return new RecordingClassifier({ intent, confidence: 1, candidates: [intent], ambiguous: false });
}

function capturingRegistry(
  intent: Intent,
  captured: { ctx?: MessageContext },
  fontes: string[],
): HandlerRegistry {
  const h: IntentHandler = {
    intent,
    handle: (ctx) => {
      captured.ctx = ctx;
      return Promise.resolve({ replyText: 'ok', cerebro: 'juridico_rag', fontesCitadas: fontes });
    },
  };
  return new Map([[intent, h]]);
}

const NOW = new Date('2026-06-30T12:00:00.000Z');
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const minsAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();

function buildOrch(store: FakeMemoryStore, classifier: RecordingClassifier, captured: { ctx?: MessageContext }, assinante = A) {
  return new Orchestrator({
    resolveAssinante: () => Promise.resolve(assinante),
    classifier,
    registry: capturingRegistry('duvida_juridica', captured, ['art. 335 do CPC']),
    interactionLog: new InMemoryInteractionLog(),
    memory: store,
    memoriaConfig: { enabled: true, turnos: 6, ttlMin: 30 },
    clock: () => NOW,
  });
}

describe('memória — política pura', () => {
  it('isWarm: dentro do TTL = quente; além = frio; null = frio', () => {
    expect(isWarm(minsAgo(5), NOW, 30)).toBe(true);
    expect(isWarm(minsAgo(60), NOW, 30)).toBe(false);
    expect(isWarm(null, NOW, 30)).toBe(false);
  });
  it('trimTurnos mantém só os últimos N', () => {
    const ts: ConversationTurn[] = [1, 2, 3, 4].map((n) => ({ papel: 'user', em: String(n) }));
    expect(trimTurnos(ts, 2).map((t) => t.em)).toEqual(['3', '4']);
  });
  it('fontesRecentes/intentRecente leem o mais novo primeiro', () => {
    const ts: ConversationTurn[] = [
      { papel: 'assistant', intent: 'duvida_juridica', fontes: ['art. 5º do CC'], em: '1' },
      { papel: 'assistant', intent: 'duvida_juridica', fontes: ['art. 335 do CPC'], em: '2' },
    ];
    expect(fontesRecentes(ts)).toEqual(['art. 335 do CPC', 'art. 5º do CC']);
    expect(intentRecente(ts)).toBe('duvida_juridica');
  });
});

describe('memória — no orquestrador', () => {
  it('grava o turno (usuário + assistente com as fontes) após responder', async () => {
    const store = new FakeMemoryStore();
    const captured: { ctx?: MessageContext } = {};
    const orch = buildOrch(store, clear('duvida_juridica'), captured);
    await orch.handleInboundMessage(makeMessage('qual o prazo de contestação no CPC?'));
    expect(store.saves).toHaveLength(1);
    const turnos = store.saves[0]!.turnos;
    expect(turnos.map((t) => t.papel)).toEqual(['user', 'assistant']);
    expect(turnos[1]!.fontes).toEqual(['art. 335 do CPC']);
    // privacidade: NENHUM texto livre do usuário é gravado
    expect(turnos.every((t) => t.texto === undefined)).toBe(true);
  });

  it('memória quente é passada como recentContext ao classificador e ao handler', async () => {
    const store = new FakeMemoryStore();
    store.seed(A, [{ papel: 'assistant', intent: 'duvida_juridica', fontes: ['art. 335 do CPC'], em: minsAgo(5) }], minsAgo(5));
    const captured: { ctx?: MessageContext } = {};
    const classifier = clear('duvida_juridica');
    const orch = buildOrch(store, classifier, captured);
    await orch.handleInboundMessage(makeMessage('e o prazo dela?'));
    expect(classifier.lastContext?.turnos[0]?.fontes).toEqual(['art. 335 do CPC']);
    expect(captured.ctx?.recentContext?.turnos[0]?.fontes).toEqual(['art. 335 do CPC']);
  });

  it('expiração: memória fria é limpa e NÃO vira contexto', async () => {
    const store = new FakeMemoryStore();
    store.seed(A, [{ papel: 'assistant', intent: 'duvida_juridica', fontes: ['art. 999 antigo'], em: minsAgo(120) }], minsAgo(120));
    const captured: { ctx?: MessageContext } = {};
    const orch = buildOrch(store, clear('duvida_juridica'), captured);
    await orch.handleInboundMessage(makeMessage('outra pergunta'));
    expect(store.clears).toContain(A); // esfriou → limpou
    expect(captured.ctx?.recentContext).toBeUndefined(); // não forçou assunto velho
  });

  it('isolamento: a memória do A nunca aparece para o B', async () => {
    const store = new FakeMemoryStore();
    store.seed(A, [{ papel: 'assistant', intent: 'duvida_juridica', fontes: ['art. 5º do CC'], em: minsAgo(2) }], minsAgo(2));
    const captured: { ctx?: MessageContext } = {};
    const orch = buildOrch(store, clear('duvida_juridica'), captured, B); // assinante B
    await orch.handleInboundMessage(makeMessage('qualquer coisa'));
    expect(captured.ctx?.recentContext).toBeUndefined(); // B não vê nada do A
    expect(store.saves.every((s) => s.id === B)).toBe(true); // só grava sob B
  });

  it('sem memoriaConfig → store nunca é tocado (regressão: comportamento atual)', async () => {
    const store = new FakeMemoryStore();
    const captured: { ctx?: MessageContext } = {};
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve(A),
      classifier: clear('duvida_juridica'),
      registry: capturingRegistry('duvida_juridica', captured, []),
      interactionLog: new InMemoryInteractionLog(),
      memory: store, // presente, mas sem memoriaConfig → inativo
    });
    await orch.handleInboundMessage(makeMessage('oi'));
    expect(store.loads).toHaveLength(0);
    expect(store.saves).toHaveLength(0);
    expect(captured.ctx?.recentContext).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { Cerebro2Handler } from '../src/application/cerebro2/cerebro2-handler';
import { Orchestrator } from '../src/application/orchestrator';
import { buildDefaultRegistry } from '../src/application/handlers/placeholder-handlers';
import type { MessageContext } from '../src/core/orchestration/handler';
import type { CorpusStore, CorpusTrecho } from '../src/core/ports/corpus';
import type { EmbeddingsPort } from '../src/core/ports/embeddings';
import type { LlmGenerateResult, LlmPort } from '../src/core/ports/llm';
import { FakeClassifier, InMemoryInteractionLog, makeMessage } from './helpers';

class FakeEmbeddings implements EmbeddingsPort {
  constructor(private readonly fail = false) {}
  embed(texts: string[]): Promise<number[][]> {
    if (this.fail) return Promise.reject(new Error('emb down'));
    return Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]));
  }
}
class FakeCorpus implements CorpusStore {
  constructor(private readonly rows: CorpusTrecho[]) {}
  search(): Promise<CorpusTrecho[]> {
    return Promise.resolve(this.rows);
  }
}
class FakeLlm implements LlmPort {
  constructor(private readonly outcome: LlmGenerateResult | Error) {}
  generate(): Promise<LlmGenerateResult> {
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome);
  }
}
function json(obj: unknown): LlmGenerateResult {
  return { text: JSON.stringify(obj), toolCalls: [], stopReason: 'end_turn' };
}

const trecho: CorpusTrecho = {
  citacao: 'art. 6º do CDC',
  texto: 'São direitos básicos do consumidor...',
  fonteUrl: 'http://planalto/cdc',
  similarity: 0.8,
};

const ctx: MessageContext = {
  assinanteId: 'A',
  intent: 'duvida_juridica',
  message: makeMessage('quais os direitos básicos do consumidor?'),
};

function build(rows: CorpusTrecho[], llm: LlmPort, embFail = false) {
  return new Cerebro2Handler({
    llm,
    embeddings: new FakeEmbeddings(embFail),
    corpus: new FakeCorpus(rows),
    minSimilarity: 0.3,
    logger: { error: () => {} },
  });
}

describe('Cerebro2Handler — RAG', () => {
  it('com fonte → afirma e cita; reporta cerebro e fontes', async () => {
    const llm = new FakeLlm(
      json({ orientacao: '', afirmacoes: [{ texto: 'Tem direitos básicos.', fonte: 'art. 6º do CDC' }], recusou: false }),
    );
    const r = await build([trecho], llm).handle(ctx);
    expect(r.replyText).toContain('art. 6º do CDC');
    expect(r.cerebro).toBe('juridico_rag');
    expect(r.fontesCitadas).toEqual(['art. 6º do CDC']);
  });

  it('ANTIALUCINAÇÃO: corpus vazio + citação fabricada pelo LLM → recusa, sem inventar', async () => {
    const llm = new FakeLlm(
      json({ orientacao: '', afirmacoes: [{ texto: 'O prazo é 15 dias.', fonte: 'art. 999 inexistente' }], recusou: false }),
    );
    const r = await build([], llm).handle(ctx);
    expect(r.replyText).not.toContain('art. 999');
    expect(r.replyText).not.toContain('15 dias');
    expect(r.replyText.toLowerCase()).toContain('não vou afirmar');
    expect(r.fontesCitadas).toEqual([]);
  });

  it('recusa-sem-fonte: corpus vazio + LLM recusa → transparente', async () => {
    const llm = new FakeLlm(json({ orientacao: '', afirmacoes: [], recusou: true }));
    const r = await build([], llm).handle(ctx);
    expect(r.replyText.toLowerCase()).toContain('não vou afirmar');
  });

  it('falha de embeddings → mensagem transitória (sem inventar)', async () => {
    const r = await build([trecho], new FakeLlm(json({})), true).handle(ctx);
    expect(r.replyText).toContain('acervo');
  });

  it('falha do LLM → recusa segura (não lança, não inventa)', async () => {
    const r = await build([trecho], new FakeLlm(new Error('llm down'))).handle(ctx);
    expect(r.replyText.toLowerCase()).toContain('não vou afirmar');
  });
});

describe('roteamento + log de fontes', () => {
  it('duvida_juridica → handler; orquestrador grava cerebro e fontes', async () => {
    const log = new InMemoryInteractionLog();
    const registry = buildDefaultRegistry({
      duvida_juridica: {
        intent: 'duvida_juridica',
        handle: () =>
          Promise.resolve({ replyText: 'r', cerebro: 'juridico_rag', fontesCitadas: ['art. 6º do CDC'] }),
      },
    });
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve('A'),
      classifier: new FakeClassifier({ intent: 'duvida_juridica', confidence: 1, candidates: ['duvida_juridica'], ambiguous: false }),
      registry,
      interactionLog: log,
    });
    await orch.handleInboundMessage(makeMessage('uma dúvida'));
    expect(log.entries[0]).toMatchObject({ cerebro: 'juridico_rag', fontesCitadas: ['art. 6º do CDC'] });
  });
});

import { describe, expect, it } from 'vitest';
import { KeywordIntentClassifier } from '../src/adapters/classifier/keyword-classifier';
import { LlmIntentClassifier } from '../src/adapters/classifier/llm-classifier';
import type { LlmGenerateResult, LlmPort } from '../src/core/ports/llm';

class FakeLlm implements LlmPort {
  constructor(private readonly outcome: LlmGenerateResult | Error) {}
  generate(): Promise<LlmGenerateResult> {
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome);
  }
}

function llmResult(text: string): LlmGenerateResult {
  return { text, toolCalls: [], stopReason: 'end_turn' };
}

const keyword = new KeywordIntentClassifier();

describe('LlmIntentClassifier', () => {
  it('usa a classificação do LLM (JSON estruturado)', async () => {
    const llm = new FakeLlm(llmResult('{"intent":"agendar","confidence":0.9}'));
    const r = await new LlmIntentClassifier(llm, keyword).classify('qualquer texto');
    expect(r.intent).toBe('agendar');
    expect(r.ambiguous).toBe(false);
  });

  it('confiança baixa → ambíguo', async () => {
    const llm = new FakeLlm(llmResult('{"intent":"financeiro","confidence":0.2}'));
    const r = await new LlmIntentClassifier(llm, keyword).classify('hmm');
    expect(r.intent).toBe('financeiro');
    expect(r.ambiguous).toBe(true);
  });

  it('erro do LLM → fallback para o classificador por palavras-chave', async () => {
    const llm = new FakeLlm(new Error('rede caiu'));
    const r = await new LlmIntentClassifier(llm, keyword).classify('quais meus processos ativos');
    expect(r.intent).toBe('consulta_dados'); // veio do fallback determinístico
  });

  it('JSON inválido do LLM → fallback', async () => {
    const llm = new FakeLlm(llmResult('não é json'));
    const r = await new LlmIntentClassifier(llm, keyword).classify('quero marcar uma audiencia');
    expect(r.intent).toBe('agendar'); // fallback
  });

  it('intenção desconhecida do LLM → fallback', async () => {
    const llm = new FakeLlm(llmResult('{"intent":"inexistente","confidence":0.9}'));
    const r = await new LlmIntentClassifier(llm, keyword).classify('me ajuda');
    expect(r.intent).toBe('ajuda'); // fallback
  });
});

import { describe, expect, it } from 'vitest';
import { KeywordIntentClassifier } from '../src/adapters/classifier/keyword-classifier';
import { LlmIntentClassifier } from '../src/adapters/classifier/llm-classifier';
import type { RecentContext } from '../src/core/domain/conversation/memory';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';

class FakeLlm implements LlmPort {
  public lastParams?: LlmGenerateParams;
  constructor(private readonly outcome: LlmGenerateResult | Error) {}
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastParams = params;
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

  it('com recentContext: injeta contexto MÍNIMO (intenção + citações, sem PII) no prompt', async () => {
    const llm = new FakeLlm(llmResult('{"intent":"duvida_juridica","confidence":0.9}'));
    const ctx: RecentContext = {
      turnos: [{ papel: 'assistant', intent: 'duvida_juridica', fontes: ['art. 335 do CPC'], em: 't' }],
    };
    const r = await new LlmIntentClassifier(llm, keyword).classify('e o prazo dela?', ctx);
    expect(r.intent).toBe('duvida_juridica');
    const sent = String(llm.lastParams?.messages[0]?.content);
    expect(sent).toContain('Contexto recente');
    expect(sent).toContain('art. 335 do CPC');
    expect(sent).toContain('Mensagem atual: e o prazo dela?');
  });

  it('sem recentContext: prompt é só a mensagem (regressão)', async () => {
    const llm = new FakeLlm(llmResult('{"intent":"agendar","confidence":0.9}'));
    await new LlmIntentClassifier(llm, keyword).classify('marcar audiência');
    expect(llm.lastParams?.messages[0]?.content).toBe('marcar audiência');
  });
});

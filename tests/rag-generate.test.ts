import { describe, expect, it } from 'vitest';
import { ragGenerate } from '../src/application/cerebro2/rag-generate';
import type { CorpusTrecho } from '../src/core/ports/corpus';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';

class FakeLlm implements LlmPort {
  lastParams?: LlmGenerateParams;
  constructor(private readonly text: string) {}
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastParams = params;
    return Promise.resolve({ text: this.text, toolCalls: [], stopReason: 'end_turn' });
  }
}

const trechos: CorpusTrecho[] = [
  { citacao: 'art. 335 do CPC', texto: 'prazo de 15 dias...', fonteUrl: null, similarity: 0.6, vigenciaStatus: 'vigente' },
];

describe('ragGenerate', () => {
  it('JSON válido → parseia orientacao/afirmacoes/recusou', async () => {
    const ok = JSON.stringify({
      orientacao: 'apoio',
      afirmacoes: [{ texto: 'O prazo é 15 dias.', fonte: 'art. 335 do CPC' }],
      recusou: false,
    });
    const out = await ragGenerate(new FakeLlm(ok), 'prazo de contestação?', trechos);
    expect(out.recusou).toBe(false);
    expect(out.afirmacoes).toEqual([{ texto: 'O prazo é 15 dias.', fonte: 'art. 335 do CPC' }]);
  });

  it('JSON TRUNCADO (estourou maxTokens) → degrada com segurança, NÃO lança', async () => {
    // Resposta cortada no meio de uma string → JSON.parse lançaria.
    const truncado =
      '{"orientacao":"texto longo que foi cortado no meio porque o modelo atingiu o limite de sa';
    const out = await ragGenerate(new FakeLlm(truncado), 'pergunta longa', trechos);
    expect(out).toEqual({ orientacao: '', afirmacoes: [], recusou: true });
  });

  it('usa maxTokens folgado (>= 1500) para reduzir truncamento', async () => {
    const llm = new FakeLlm(JSON.stringify({ orientacao: '', afirmacoes: [], recusou: true }));
    await ragGenerate(llm, 'q', trechos);
    expect((llm.lastParams?.maxTokens ?? 0)).toBeGreaterThanOrEqual(1500);
  });
});

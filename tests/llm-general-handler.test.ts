import { describe, expect, it } from 'vitest';
import { LlmGeneralHandler } from '../src/application/handlers/llm-general-handler';
import { buildDefaultRegistry } from '../src/application/handlers/placeholder-handlers';
import type { MessageContext } from '../src/core/orchestration/handler';
import type { LlmGenerateResult, LlmPort } from '../src/core/ports/llm';

class FakeLlm implements LlmPort {
  constructor(private readonly outcome: LlmGenerateResult | Error) {}
  generate(): Promise<LlmGenerateResult> {
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome);
  }
  embed(): Promise<number[][]> {
    return Promise.reject(new Error('n/a'));
  }
}

const ctx: MessageContext = {
  assinanteId: '11111111-1111-1111-1111-111111111111',
  intent: 'ajuda',
  message: { messageId: 'm', from: '55', text: 'oi, tudo bem?', timestamp: '2026-06-26T00:00:00Z' },
};

describe('LlmGeneralHandler', () => {
  it('devolve a resposta do LLM', async () => {
    const llm = new FakeLlm({ text: 'Olá! Como posso ajudar?', toolCalls: [], stopReason: 'end_turn' });
    const r = await new LlmGeneralHandler('ajuda', llm).handle(ctx);
    expect(r.replyText).toBe('Olá! Como posso ajudar?');
  });

  it('em erro do LLM, responde fallback sem expor o erro', async () => {
    const llm = new FakeLlm(new Error('500 interno'));
    const r = await new LlmGeneralHandler('ajuda', llm).handle(ctx);
    expect(r.replyText).not.toContain('500');
    expect(r.replyText.length).toBeGreaterThan(0);
  });
});

describe('registro com LLM em ajuda/outro mantém duvida_juridica como placeholder', () => {
  it('só os overrides mudam; jurídico segue em desenvolvimento', async () => {
    const llm = new FakeLlm({ text: 'resposta llm', toolCalls: [], stopReason: 'end_turn' });
    const registry = buildDefaultRegistry({
      ajuda: new LlmGeneralHandler('ajuda', llm),
      outro: new LlmGeneralHandler('outro', llm),
    });

    expect(registry.get('ajuda')).toBeInstanceOf(LlmGeneralHandler);
    const juridico = registry.get('duvida_juridica')!;
    expect(juridico).not.toBeInstanceOf(LlmGeneralHandler);
    const reply = await juridico.handle({ ...ctx, intent: 'duvida_juridica' });
    expect(reply.replyText.toLowerCase()).toContain('desenvolvimento');
  });
});

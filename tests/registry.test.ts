import { describe, expect, it } from 'vitest';
import { INTENTS } from '../src/core/domain/intents';
import { buildDefaultRegistry } from '../src/application/handlers/placeholder-handlers';

describe('registro de handlers', () => {
  const registry = buildDefaultRegistry();

  it('tem exatamente um handler por intenção (completude)', () => {
    expect(registry.size).toBe(INTENTS.length);
    for (const intent of INTENTS) {
      const handler = registry.get(intent);
      expect(handler).toBeDefined();
      expect(handler?.intent).toBe(intent);
    }
  });

  it('todo placeholder é honesto: resposta não vazia e marcada como em desenvolvimento', async () => {
    for (const intent of INTENTS) {
      const { replyText } = await registry.get(intent)!.handle({
        assinanteId: null,
        intent,
        message: { messageId: 'm', from: '+550', text: 'x', timestamp: '2026-06-26T00:00:00Z' },
      });
      expect(replyText.length).toBeGreaterThan(0);
      expect(replyText.toLowerCase()).toContain('desenvolvimento');
    }
  });
});

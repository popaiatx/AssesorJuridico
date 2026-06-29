import { describe, expect, it } from 'vitest';
import type { Intent } from '../src/core/domain/intents';
import { Orchestrator } from '../src/application/orchestrator';
import type { AccessDecision } from '../src/core/domain/access';
import type { SubscriptionGate } from '../src/core/ports/subscription-gate';
import { FakeClassifier, InMemoryInteractionLog, makeMessage, spyRegistry } from './helpers';

function gateThatReturns(decision: AccessDecision): SubscriptionGate {
  return { evaluate: () => Promise.resolve(decision) };
}

describe('Orchestrator — porteiro de acesso', () => {
  it('acesso bloqueado → desvia para pagamento, ignora classificador e handlers de negócio', async () => {
    const calls: Intent[] = [];
    const classifier = new FakeClassifier({
      intent: 'consulta_dados',
      confidence: 1,
      candidates: ['consulta_dados'],
      ambiguous: false,
    });
    let paymentCalled = 0;
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve('assinante-id'),
      classifier,
      registry: spyRegistry(calls),
      interactionLog: new InMemoryInteractionLog(),
      gate: gateThatReturns({ allowed: false, reason: 'trial_expirado' }),
      paymentRequiredHandler: {
        handle: () => {
          paymentCalled++;
          return Promise.resolve({ replyText: 'pague para continuar' });
        },
      },
    });

    const res = await orch.handleInboundMessage(makeMessage('quais meus processos'));

    expect(res.intent).toBe('assinatura');
    expect(res.replyText).toBe('pague para continuar');
    expect(paymentCalled).toBe(1);
    expect(classifier.calls).toBe(0); // não classifica quando bloqueado
    expect(calls).toEqual([]); // nenhum handler de negócio acionado
  });

  it('acesso liberado → segue o fluxo normal (classifica e roteia)', async () => {
    const calls: Intent[] = [];
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve('assinante-id'),
      classifier: new FakeClassifier({
        intent: 'consulta_dados',
        confidence: 1,
        candidates: ['consulta_dados'],
        ambiguous: false,
      }),
      registry: spyRegistry(calls),
      interactionLog: new InMemoryInteractionLog(),
      gate: gateThatReturns({ allowed: true, reason: 'trial_ativo' }),
      paymentRequiredHandler: { handle: () => Promise.resolve({ replyText: 'x' }) },
    });

    const res = await orch.handleInboundMessage(makeMessage('quais meus processos'));

    expect(res.intent).toBe('consulta_dados');
    expect(calls).toEqual(['consulta_dados']);
  });
});

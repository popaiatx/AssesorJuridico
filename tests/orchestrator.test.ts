import { describe, expect, it } from 'vitest';
import type { Intent } from '../src/core/domain/intents';
import { INTENT_LABEL } from '../src/core/domain/intents';
import { Orchestrator } from '../src/application/orchestrator';
import {
  FakeClassifier,
  InMemoryInteractionLog,
  makeMessage,
  spyRegistry,
} from './helpers';

function clear(intent: Intent) {
  return new FakeClassifier({ intent, confidence: 1, candidates: [intent], ambiguous: false });
}

describe('Orchestrator', () => {
  it('telefone desconhecido → onboarding, SEM consultar o classificador', async () => {
    const calls: Intent[] = [];
    const log = new InMemoryInteractionLog();
    const classifier = clear('consulta_dados'); // não deve ser usado
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve(null),
      classifier,
      registry: spyRegistry(calls),
      interactionLog: log,
    });

    const res = await orch.handleInboundMessage(makeMessage('quais meus processos'));

    expect(res.intent).toBe('onboarding');
    expect(res.ambiguous).toBe(false);
    expect(res.assinanteId).toBeNull();
    expect(classifier.calls).toBe(0); // onboarding não classifica
    expect(calls).toEqual(['onboarding']); // um único handler
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ assinanteId: null, intent: 'onboarding', cerebro: null });
  });

  it('intenção clara → roteia para UM único handler correto e registra com tenant', async () => {
    const calls: Intent[] = [];
    const log = new InMemoryInteractionLog();
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve('11111111-1111-1111-1111-111111111111'),
      classifier: clear('consulta_dados'),
      registry: spyRegistry(calls),
      interactionLog: log,
    });

    const res = await orch.handleInboundMessage(makeMessage('quais meus processos ativos'));

    expect(res.intent).toBe('consulta_dados');
    expect(res.replyText).toBe('handled:consulta_dados');
    expect(calls).toEqual(['consulta_dados']); // exatamente um (um-cérebro-por-mensagem)
    expect(log.entries[0]).toMatchObject({
      assinanteId: '11111111-1111-1111-1111-111111111111',
      intent: 'consulta_dados',
      cerebro: null,
    });
  });

  it('ambíguo → PERGUNTA em linguagem natural, sem acionar handler de negócio', async () => {
    const calls: Intent[] = [];
    const classifier = new FakeClassifier({
      intent: 'assinatura',
      confidence: 0.5,
      candidates: ['assinatura', 'ajuda'],
      ambiguous: true,
    });
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve('11111111-1111-1111-1111-111111111111'),
      classifier,
      registry: spyRegistry(calls),
      interactionLog: new InMemoryInteractionLog(),
    });

    const res = await orch.handleInboundMessage(makeMessage('preciso de ajuda com meu plano'));

    expect(res.ambiguous).toBe(true);
    expect(calls).toEqual([]); // nenhum handler de negócio acionado
    // Usa rótulos amigáveis, NUNCA os nomes internos das intenções.
    expect(res.replyText).toContain(INTENT_LABEL.assinatura);
    expect(res.replyText).toContain(INTENT_LABEL.ajuda);
    // Nenhum identificador interno (snake_case) vaza para o usuário.
    expect(res.replyText).not.toContain('_');
  });
});

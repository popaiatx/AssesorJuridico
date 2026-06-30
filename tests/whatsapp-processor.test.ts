import { describe, expect, it } from 'vitest';
import type { Intent } from '../src/core/domain/intents';
import { Orchestrator } from '../src/application/orchestrator';
import { WhatsappWebhookProcessor } from '../src/application/whatsapp-webhook-processor';
import type { InboundMessage } from '../src/core/ports/whatsapp';
import { FakeClassifier, InMemoryInteractionLog, spyRegistry } from './helpers';
import {
  fixedClock,
  FakeWhatsapp,
  InMemoryDedup,
  InMemoryWindow,
  silentLogger,
} from './whatsapp-helpers';

function textMsg(id: string, text = 'quais meus processos'): InboundMessage {
  return { messageId: id, from: '5511999990001', text, timestamp: '2026-06-26T12:00:00.000Z' };
}
function mediaMsg(id: string): InboundMessage {
  return {
    messageId: id,
    from: '5511999990001',
    text: '',
    timestamp: '2026-06-26T12:00:00.000Z',
    media: { type: 'document', mediaId: 'doc-1', filename: 'x.pdf' },
  };
}

function build(messages: InboundMessage[], sendBehavior: 'ok' | 'throw' = 'ok') {
  const calls: Intent[] = [];
  const orchestrator = new Orchestrator({
    resolveAssinante: () => Promise.resolve('11111111-1111-1111-1111-111111111111'),
    classifier: new FakeClassifier({
      intent: 'consulta_dados',
      confidence: 1,
      candidates: ['consulta_dados'],
      ambiguous: false,
    }),
    registry: spyRegistry(calls),
    interactionLog: new InMemoryInteractionLog(),
  });
  const whatsapp = new FakeWhatsapp(messages, sendBehavior);
  const dedup = new InMemoryDedup();
  const window = new InMemoryWindow();
  const processor = new WhatsappWebhookProcessor({
    whatsapp,
    orchestrator,
    dedup,
    window,
    clock: fixedClock('2026-06-26T12:00:00.000Z'),
    logger: silentLogger,
  });
  return { processor, whatsapp, dedup, window, handlerCalls: calls };
}

describe('WhatsappWebhookProcessor', () => {
  it('texto → orquestra e envia a resposta; marca como concluída', async () => {
    const { processor, whatsapp, dedup, window, handlerCalls } = build([textMsg('wamid.1')]);

    await processor.process(Buffer.from('{}'));

    expect(handlerCalls).toEqual(['consulta_dados']); // um cérebro
    expect(whatsapp.sent).toEqual([{ to: '5511999990001', text: 'handled:consulta_dados' }]);
    expect(dedup.doneCalls).toEqual(['wamid.1']);
    expect(window.last.get('5511999990001')).toBeInstanceOf(Date);
  });

  it('idempotência: mesma mensagem 2x → processa uma vez', async () => {
    const { processor, whatsapp, dedup, handlerCalls } = build([textMsg('wamid.dup')]);

    await processor.process(Buffer.from('{}'));
    await processor.process(Buffer.from('{}'));

    expect(handlerCalls).toHaveLength(1);
    expect(whatsapp.sent).toHaveLength(1);
    expect(dedup.claimCalls).toHaveLength(2); // tentou 2x
    expect(dedup.doneCalls).toEqual(['wamid.dup']); // concluiu 1x
  });

  it('mídia → orquestrador trata (placeholder honesto quando documentos não configurados)', async () => {
    const { processor, whatsapp, handlerCalls } = build([mediaMsg('wamid.media')]);

    await processor.process(Buffer.from('{}'));

    expect(handlerCalls).toEqual([]); // não roteia a um cérebro: o orquestrador responde a mídia
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]!.text).toContain('Recebi seu arquivo');
  });

  it('falha no envio → libera o claim (sem marcar done) e propaga (→ 500)', async () => {
    const { processor, dedup } = build([textMsg('wamid.fail')], 'throw');

    await expect(processor.process(Buffer.from('{}'))).rejects.toThrow();

    expect(dedup.releaseCalls).toEqual(['wamid.fail']);
    expect(dedup.doneCalls).toEqual([]);
    expect(dedup.done.has('wamid.fail')).toBe(false); // reentrega poderá reprocessar
  });
});

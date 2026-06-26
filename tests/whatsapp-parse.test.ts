import { describe, expect, it } from 'vitest';
import { parseInboundMessages } from '../src/adapters/whatsapp/parse';

function buf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

function payload(messages: unknown[]): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'E', changes: [{ value: { messaging_product: 'whatsapp', messages }, field: 'messages' }] }],
  };
}

describe('parseInboundMessages', () => {
  it('mensagem de texto', () => {
    const msgs = parseInboundMessages(
      buf(payload([{ from: '5511999990001', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'olá' } }])),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ messageId: 'wamid.1', from: '5511999990001', text: 'olá' });
    expect(msgs[0]!.media).toBeUndefined();
    expect(msgs[0]!.timestamp).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('imagem com caption → media image + texto = caption', () => {
    const msgs = parseInboundMessages(
      buf(payload([{ from: '55', id: 'wamid.2', timestamp: '1700000000', type: 'image', image: { id: 'media-1', caption: 'foto do contrato' } }])),
    );
    expect(msgs[0]!.media).toEqual({ type: 'image', mediaId: 'media-1' });
    expect(msgs[0]!.text).toBe('foto do contrato');
  });

  it('documento → media document com filename', () => {
    const msgs = parseInboundMessages(
      buf(payload([{ from: '55', id: 'wamid.3', timestamp: '1700000000', type: 'document', document: { id: 'doc-1', filename: 'peticao.pdf' } }])),
    );
    expect(msgs[0]!.media).toEqual({ type: 'document', mediaId: 'doc-1', filename: 'peticao.pdf' });
  });

  it('tipo não suportado → media unknown', () => {
    const msgs = parseInboundMessages(
      buf(payload([{ from: '55', id: 'wamid.4', timestamp: '1700000000', type: 'location', location: { latitude: 0 } }])),
    );
    expect(msgs[0]!.media?.type).toBe('unknown');
  });

  it('várias mensagens no mesmo payload', () => {
    const msgs = parseInboundMessages(
      buf(payload([
        { from: '55', id: 'a', timestamp: '1700000000', type: 'text', text: { body: 'um' } },
        { from: '55', id: 'b', timestamp: '1700000001', type: 'text', text: { body: 'dois' } },
      ])),
    );
    expect(msgs.map((m) => m.messageId)).toEqual(['a', 'b']);
  });

  it('payload de status (sem messages) → vazio', () => {
    const statusPayload = {
      entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'delivered' }] }, field: 'messages' }] }],
    };
    expect(parseInboundMessages(buf(statusPayload))).toEqual([]);
  });
});

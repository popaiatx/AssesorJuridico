import { describe, expect, it } from 'vitest';
import { CloudApiClient } from '../src/adapters/whatsapp/cloud-api-client';
import {
  WhatsappAdapter,
  WhatsappWindowClosedError,
} from '../src/adapters/whatsapp/whatsapp-adapter';
import { fakeConfig, fixedClock, InMemoryWindow, recordingHttpPost } from './whatsapp-helpers';

function buildAdapter(nowIso: string) {
  const http = recordingHttpPost(200);
  const window = new InMemoryWindow();
  const adapter = new WhatsappAdapter({
    config: fakeConfig,
    client: new CloudApiClient(fakeConfig, http.post),
    window,
    clock: fixedClock(nowIso),
  });
  return { adapter, window, http };
}

describe('janela de 24h em sendFreeFormMessage', () => {
  it('dentro da janela (8h) → envia', async () => {
    const { adapter, window, http } = buildAdapter('2026-06-26T20:00:00.000Z');
    await window.recordInbound('5511999990001', new Date('2026-06-26T12:00:00.000Z'));

    await adapter.sendFreeFormMessage('5511999990001', 'olá');

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]!.body).toContain('olá');
    expect(http.calls[0]!.headers.Authorization).toBe('Bearer token');
  });

  it('fora da janela (25h) → recusa e não envia', async () => {
    const { adapter, window, http } = buildAdapter('2026-06-26T20:00:00.000Z');
    await window.recordInbound('5511999990001', new Date('2026-06-25T19:00:00.000Z'));

    await expect(adapter.sendFreeFormMessage('5511999990001', 'oi')).rejects.toBeInstanceOf(
      WhatsappWindowClosedError,
    );
    expect(http.calls).toHaveLength(0);
  });

  it('contato sem entrada registrada → recusa', async () => {
    const { adapter, http } = buildAdapter('2026-06-26T20:00:00.000Z');
    await expect(adapter.sendFreeFormMessage('5500000000000', 'oi')).rejects.toBeInstanceOf(
      WhatsappWindowClosedError,
    );
    expect(http.calls).toHaveLength(0);
  });
});

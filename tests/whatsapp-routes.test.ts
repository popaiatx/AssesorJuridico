import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { CloudApiClient } from '../src/adapters/whatsapp/cloud-api-client';
import { WhatsappAdapter } from '../src/adapters/whatsapp/whatsapp-adapter';
import { expectedSignature } from '../src/adapters/whatsapp/signature';
import { whatsappRoutes, type WebhookProcessor } from '../src/infra/http/whatsapp-routes';
import { fakeConfig, fixedClock, InMemoryWindow, recordingHttpPost } from './whatsapp-helpers';

function buildApp(processor: WebhookProcessor) {
  const app = Fastify();
  const adapter = new WhatsappAdapter({
    config: fakeConfig,
    client: new CloudApiClient(fakeConfig, recordingHttpPost().post),
    window: new InMemoryWindow(),
    clock: fixedClock('2026-06-26T12:00:00.000Z'),
  });
  void app.register(
    whatsappRoutes({ verifyToken: fakeConfig.verifyToken, adapter, processor }),
  );
  return app;
}

const noopProcessor = (): { processor: WebhookProcessor; process: ReturnType<typeof vi.fn> } => {
  const process = vi.fn(() => Promise.resolve());
  return { processor: { process }, process };
};

describe('rotas do webhook do WhatsApp', () => {
  it('GET com verify_token correto → 200 e ecoa o challenge', async () => {
    const app = buildApp(noopProcessor().processor);
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=42',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('42');
    await app.close();
  });

  it('GET com verify_token errado → 403', async () => {
    const app = buildApp(noopProcessor().processor);
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42',
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST com assinatura inválida → 401 e NÃO processa', async () => {
    const { processor, process } = noopProcessor();
    const app = buildApp(processor);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=errada' },
      payload: '{"a":1}',
    });
    expect(res.statusCode).toBe(401);
    expect(process).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST com assinatura válida → 200 e processa', async () => {
    const { processor, process } = noopProcessor();
    const app = buildApp(processor);
    const body = '{"a":1}';
    const sig = expectedSignature(Buffer.from(body, 'utf8'), fakeConfig.appSecret);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(process).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

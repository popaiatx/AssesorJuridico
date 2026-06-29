import { describe, expect, it } from 'vitest';
import { AsaasAdapter } from '../src/adapters/payment/asaas-adapter';
import type { AsaasConfig } from '../src/adapters/payment/config';
import type { HttpRequest } from '../src/adapters/payment/http';

const cfg: AsaasConfig = {
  env: 'sandbox',
  apiKey: 'sk-asaas',
  webhookSecret: 'segredo-webhook',
  baseUrl: 'https://api-sandbox.asaas.com/v3',
};

/** Fake HTTP que responde por rota e grava as chamadas. */
function fakeHttp(routes: Record<string, unknown>) {
  const calls: Array<{ method: string; url: string; body?: string; headers: Record<string, string> }> = [];
  const http: HttpRequest = (method, url, init) => {
    calls.push({ method, url, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
    const key = `${method} ${url}`;
    const match = Object.keys(routes).find((k) => key.startsWith(k));
    const payload = match ? routes[match] : {};
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
  };
  return { http, calls };
}

const clock = () => new Date('2026-06-29T12:00:00.000Z');

describe('AsaasAdapter — requisições (sem rede)', () => {
  it('ensureCustomer monta POST /customers com header access_token', async () => {
    const { http, calls } = fakeHttp({ 'POST https://api-sandbox.asaas.com/v3/customers': { id: 'cus_1' } });
    const adapter = new AsaasAdapter(cfg, http, clock);
    const id = await adapter.ensureCustomer({ assinanteId: 'a1', nome: 'Maria', email: 'm@x.com' });
    expect(id).toBe('cus_1');
    expect(calls[0]!.headers.access_token).toBe('sk-asaas');
    const body = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'Maria', email: 'm@x.com', externalReference: 'a1' });
  });

  it('createSubscription cria assinatura e retorna o invoiceUrl da 1a cobrança', async () => {
    const { http, calls } = fakeHttp({
      'POST https://api-sandbox.asaas.com/v3/subscriptions': { id: 'sub_1' },
      'GET https://api-sandbox.asaas.com/v3/subscriptions/sub_1/payments': {
        data: [{ id: 'pay_1', invoiceUrl: 'https://asaas/checkout/pay_1' }],
      },
    });
    const adapter = new AsaasAdapter(cfg, http, clock);
    const r = await adapter.createSubscription({ assinanteId: 'a1', customerId: 'cus_1' });

    expect(r).toEqual({
      subscriptionRef: 'sub_1',
      paymentUrl: 'https://asaas/checkout/pay_1',
      proximoVencimento: '2026-06-29',
    });
    const subBody = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect(subBody).toMatchObject({
      customer: 'cus_1',
      billingType: 'UNDEFINED',
      cycle: 'MONTHLY',
      externalReference: 'a1',
      nextDueDate: '2026-06-29',
    });
  });

  it('getPaymentStatus consulta GET /payments/{id}', async () => {
    const { http } = fakeHttp({ 'GET https://api-sandbox.asaas.com/v3/payments/pay_1': { status: 'CONFIRMED' } });
    const adapter = new AsaasAdapter(cfg, http, clock);
    expect(await adapter.getPaymentStatus('pay_1')).toBe('CONFIRMED');
  });
});

describe('AsaasAdapter — webhook', () => {
  const adapter = new AsaasAdapter(cfg);

  it('verifyWebhook aceita header correto e rejeita errado/ausente', async () => {
    const body = Buffer.from('{}');
    expect(await adapter.verifyWebhook(body, { 'asaas-access-token': 'segredo-webhook' })).toBe(true);
    expect(await adapter.verifyWebhook(body, { 'asaas-access-token': 'errado' })).toBe(false);
    expect(await adapter.verifyWebhook(body, {})).toBe(false);
  });

  it('parseWebhookEvent extrai evento, externalReference e chargeId', () => {
    const raw = Buffer.from(
      JSON.stringify({
        id: 'evt_99',
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_1', externalReference: 'a1', status: 'CONFIRMED' },
      }),
    );
    expect(adapter.parseWebhookEvent(raw)).toEqual({
      gatewayEventId: 'evt_99',
      tipo: 'PAYMENT_CONFIRMED',
      assinanteRef: 'a1',
      chargeId: 'pay_1',
    });
  });

  it('parseWebhookEvent usa fallback de id quando ausente', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_2' } }));
    const e = adapter.parseWebhookEvent(raw);
    expect(e.gatewayEventId).toBe('PAYMENT_OVERDUE:pay_2');
    expect(e.assinanteRef).toBeNull();
  });
});

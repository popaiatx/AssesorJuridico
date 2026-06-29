import { describe, expect, it } from 'vitest';
import { AsaasPaymentHandler } from '../src/application/handlers/asaas-payment-handler';
import type { MessageContext } from '../src/core/orchestration/handler';
import type { PaymentPort, PaymentWebhookEvent } from '../src/core/ports/payment';
import type { PaymentSubscriptionRow, SaveCobrancaInput } from '../src/core/ports/payment-store';
import { makeMessage } from './helpers';

class FakePayment implements PaymentPort {
  ensureCalls = 0;
  createCalls = 0;
  ensureCustomer(): Promise<string> {
    this.ensureCalls++;
    return Promise.resolve('cus_new');
  }
  createSubscription(): Promise<{ subscriptionRef: string; paymentUrl: string; proximoVencimento: string | null }> {
    this.createCalls++;
    return Promise.resolve({ subscriptionRef: 'sub_1', paymentUrl: 'http://pay/novo', proximoVencimento: '2026-06-29' });
  }
  getPaymentStatus(): Promise<string> {
    return Promise.resolve('CONFIRMED');
  }
  verifyWebhook(): Promise<boolean> {
    return Promise.resolve(true);
  }
  parseWebhookEvent(): PaymentWebhookEvent {
    return { gatewayEventId: '', tipo: '', assinanteRef: null, chargeId: null };
  }
}

const ctx: MessageContext = {
  assinanteId: 'a1',
  intent: 'assinatura',
  message: makeMessage('oi'),
};

function build(row: PaymentSubscriptionRow | null) {
  const payment = new FakePayment();
  const saved: Array<{ id: string; f: SaveCobrancaInput }> = [];
  const handler = new AsaasPaymentHandler({
    payment,
    getSubscription: () => Promise.resolve(row),
    saveCobranca: (id, f) => {
      saved.push({ id, f });
      return Promise.resolve();
    },
  });
  return { handler, payment, saved };
}

const baseRow: PaymentSubscriptionRow = {
  status: 'trial',
  cobrancaUrl: null,
  gatewayCustomerId: null,
  gatewayRef: null,
  nome: 'Maria',
  email: 'm@x.com',
};

describe('AsaasPaymentHandler', () => {
  it('idempotente: cobrança já aberta → reenvia o mesmo link, sem criar outra', async () => {
    const { handler, payment, saved } = build({ ...baseRow, cobrancaUrl: 'http://pay/existente' });
    const r = await handler.handle(ctx);
    expect(r.replyText).toContain('http://pay/existente');
    expect(payment.createCalls).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('sem cobrança e sem cliente → cria cliente + assinatura, salva e envia link', async () => {
    const { handler, payment, saved } = build(baseRow);
    const r = await handler.handle(ctx);
    expect(payment.ensureCalls).toBe(1);
    expect(payment.createCalls).toBe(1);
    expect(saved[0]!.f).toMatchObject({ status: 'aguardando_pagamento', cobrancaUrl: 'http://pay/novo' });
    expect(r.replyText).toContain('http://pay/novo');
  });

  it('cliente já existe → não recria cliente', async () => {
    const { handler, payment } = build({ ...baseRow, gatewayCustomerId: 'cus_existente' });
    await handler.handle(ctx);
    expect(payment.ensureCalls).toBe(0);
    expect(payment.createCalls).toBe(1);
  });
});

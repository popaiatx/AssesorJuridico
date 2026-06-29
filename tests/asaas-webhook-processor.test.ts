import { describe, expect, it } from 'vitest';
import { AsaasWebhookProcessor } from '../src/application/asaas-webhook-processor';
import type { PaymentPort, PaymentWebhookEvent } from '../src/core/ports/payment';
import type { ApplyAsaasEventInput } from '../src/core/ports/payment-store';

class FakePayment implements PaymentPort {
  statusToReturn = 'CONFIRMED';
  constructor(private readonly event: PaymentWebhookEvent) {}
  ensureCustomer(): Promise<string> {
    return Promise.reject(new Error('n/a'));
  }
  createSubscription(): Promise<never> {
    return Promise.reject(new Error('n/a'));
  }
  getPaymentStatus(): Promise<string> {
    return Promise.resolve(this.statusToReturn);
  }
  verifyWebhook(): Promise<boolean> {
    return Promise.resolve(true);
  }
  parseWebhookEvent(): PaymentWebhookEvent {
    return this.event;
  }
}

const silentLogger = { info: () => {}, warn: () => {} };

function build(event: PaymentWebhookEvent, gatewayStatus = 'CONFIRMED', applyReturns = true) {
  const payment = new FakePayment(event);
  payment.statusToReturn = gatewayStatus;
  const applied: ApplyAsaasEventInput[] = [];
  const processor = new AsaasWebhookProcessor({
    payment,
    applyEvent: (i) => {
      applied.push(i);
      return Promise.resolve(applyReturns);
    },
    logger: silentLogger,
  });
  return { processor, applied };
}

function ev(tipo: string, over: Partial<PaymentWebhookEvent> = {}): PaymentWebhookEvent {
  return { gatewayEventId: 'evt_1', tipo, assinanteRef: 'a1', chargeId: 'pay_1', ...over };
}

describe('AsaasWebhookProcessor — mapeamento de eventos', () => {
  it('PAYMENT_CONFIRMED + confirmado no gateway → ativa', async () => {
    const { processor, applied } = build(ev('PAYMENT_CONFIRMED'), 'CONFIRMED');
    await processor.process(Buffer.from('{}'));
    expect(applied[0]?.novoStatus).toBe('ativa');
  });

  it('PAYMENT_RECEIVED + RECEIVED no gateway → ativa', async () => {
    const { processor, applied } = build(ev('PAYMENT_RECEIVED'), 'RECEIVED');
    await processor.process(Buffer.from('{}'));
    expect(applied[0]?.novoStatus).toBe('ativa');
  });

  it('CONFIRMED mas gateway NÃO confirma → não ativa (no-op)', async () => {
    const { processor, applied } = build(ev('PAYMENT_CONFIRMED'), 'PENDING');
    await processor.process(Buffer.from('{}'));
    expect(applied).toHaveLength(0);
  });

  it('PAYMENT_OVERDUE → inadimplente (sem confirmar no gateway)', async () => {
    const { processor, applied } = build(ev('PAYMENT_OVERDUE'));
    await processor.process(Buffer.from('{}'));
    expect(applied[0]?.novoStatus).toBe('inadimplente');
  });

  it('PAYMENT_REFUNDED → aguardando_pagamento (bloqueia)', async () => {
    const { processor, applied } = build(ev('PAYMENT_REFUNDED'));
    await processor.process(Buffer.from('{}'));
    expect(applied[0]?.novoStatus).toBe('aguardando_pagamento');
  });

  it('evento desconhecido → ignora sem aplicar (nunca ativa)', async () => {
    const { processor, applied } = build(ev('SUBSCRIPTION_UPDATED'));
    await processor.process(Buffer.from('{}'));
    expect(applied).toHaveLength(0);
  });

  it('sem externalReference → ignora', async () => {
    const { processor, applied } = build(ev('PAYMENT_CONFIRMED', { assinanteRef: null }));
    await processor.process(Buffer.from('{}'));
    expect(applied).toHaveLength(0);
  });

  it('idempotência delegada: applyEvent=false não quebra o processamento', async () => {
    const { processor, applied } = build(ev('PAYMENT_OVERDUE'), 'CONFIRMED', false);
    await expect(processor.process(Buffer.from('{}'))).resolves.toBeUndefined();
    expect(applied).toHaveLength(1);
  });
});

/**
 * Processa o webhook do Asaas. PROCESSA ANTES DO ACK (mesmo princípio do webhook
 * do WhatsApp): conclui e só então a rota responde 200; falha transitória lança →
 * a rota responde erro e o Asaas reentrega.
 *
 * Idempotente (dedupe por id do evento na função SECURITY DEFINER). Defensivo a
 * estados/eventos inesperados. NUNCA confia no payload: confirma o status da
 * cobrança no Asaas antes de ATIVAR.
 */
import type { PaymentPort } from '../core/ports/payment.js';
import type { ApplyAsaasEvent } from '../core/ports/payment-store.js';

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** Mapeamento evento → status. `undefined` = evento não tratado (ignora com segurança). */
const EVENT_TO_STATUS: Record<string, string> = {
  PAYMENT_CONFIRMED: 'ativa',
  PAYMENT_RECEIVED: 'ativa',
  PAYMENT_OVERDUE: 'inadimplente',
  PAYMENT_REFUNDED: 'aguardando_pagamento',
  PAYMENT_DELETED: 'aguardando_pagamento',
};

/** Status do Asaas que confirmam pagamento (liberam ativação). */
const STATUS_PAGO = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

export interface AsaasWebhookProcessorDeps {
  payment: PaymentPort;
  applyEvent: ApplyAsaasEvent;
  logger: Logger;
}

export class AsaasWebhookProcessor {
  constructor(private readonly deps: AsaasWebhookProcessorDeps) {}

  async process(rawBody: Buffer): Promise<void> {
    const e = this.deps.payment.parseWebhookEvent(rawBody);

    if (!e.assinanteRef) {
      this.deps.logger.warn({ tipo: e.tipo }, 'webhook Asaas sem externalReference — ignorado');
      return;
    }

    const novoStatus = EVENT_TO_STATUS[e.tipo];
    if (novoStatus === undefined) {
      // SUBSCRIPTION_* ou desconhecido → ignora com segurança (NUNCA ativa).
      this.deps.logger.info({ tipo: e.tipo }, 'evento Asaas não tratado — ignorado');
      return;
    }

    // Ativação exige confirmação no gateway (não confiar no payload).
    if (novoStatus === 'ativa') {
      if (!e.chargeId) {
        this.deps.logger.warn({ tipo: e.tipo }, 'ativação sem chargeId — ignorada');
        return;
      }
      const status = await this.deps.payment.getPaymentStatus(e.chargeId);
      if (!STATUS_PAGO.has(status)) {
        this.deps.logger.warn(
          { chargeId: e.chargeId, status },
          'pagamento não confirmado no Asaas — não ativa',
        );
        return;
      }
    }

    const applied = await this.deps.applyEvent({
      gatewayEventId: e.gatewayEventId,
      assinanteId: e.assinanteRef,
      tipo: e.tipo,
      novoStatus,
      proximoVencimento: null,
      payload: { tipo: e.tipo },
    });

    if (!applied) {
      this.deps.logger.info({ gatewayEventId: e.gatewayEventId }, 'evento Asaas duplicado — no-op');
    }
  }
}

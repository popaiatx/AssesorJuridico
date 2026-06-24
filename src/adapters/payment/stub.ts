/**
 * Adapter de PAGAMENTO — STUB (PENDENTE).
 *
 * Implementa o contrato `PaymentPort`, mas NÃO funciona: cada método lança
 * NotImplementedError. Nada de mock que finja funcionar. O adapter real
 * (default Asaas: Pix Automático + cartão) será implementado na fase de
 * pagamento, com idempotência de webhook.
 */
import { NotImplementedError } from '../../core/errors.js';
import type {
  CreateSubscriptionInput,
  PaymentPort,
  PaymentWebhookEvent,
  SubscriptionRef,
} from '../../core/ports/payment.js';

const PENDENTE = 'Adapter de pagamento ainda não implementado (PENDENTE).';

export class StubPaymentAdapter implements PaymentPort {
  createSubscription(_input: CreateSubscriptionInput): Promise<SubscriptionRef> {
    throw new NotImplementedError(PENDENTE);
  }
  getSubscription(_gatewayRef: string): Promise<SubscriptionRef> {
    throw new NotImplementedError(PENDENTE);
  }
  cancelSubscription(_gatewayRef: string): Promise<void> {
    throw new NotImplementedError(PENDENTE);
  }
  verifyWebhook(_rawBody: Buffer, _headers: Record<string, string>): Promise<boolean> {
    throw new NotImplementedError(PENDENTE);
  }
  parseWebhookEvent(_rawBody: Buffer): PaymentWebhookEvent {
    throw new NotImplementedError(PENDENTE);
  }
}

/**
 * Port de PAGAMENTO (driven). O domínio não conhece o gateway (default Asaas):
 * fala só por esta interface. Webhooks devem ser idempotentes — o
 * `gatewayEventId` é a chave para processar cada evento uma única vez.
 *
 * Apenas assinaturas; sem implementação nesta fase (ver adapters/payment).
 */
import type { PagamentoMetodo } from '../domain/entities.js';

export interface CreateSubscriptionInput {
  assinanteId: string;
  metodo: PagamentoMetodo;
  plano: string;
}

export interface SubscriptionRef {
  gatewayRef: string;
  status: string;
  proximoVencimento: string | null;
}

/** Evento já normalizado a partir do webhook do gateway. */
export interface PaymentWebhookEvent {
  gatewayEventId: string; // idempotência
  tipo: string;
  assinanteRef: string | null;
  payload: unknown;
}

export interface PaymentPort {
  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRef>;
  getSubscription(gatewayRef: string): Promise<SubscriptionRef>;
  cancelSubscription(gatewayRef: string): Promise<void>;
  /** Valida a autenticidade do webhook (assinatura/HMAC) antes de confiar nele. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<boolean>;
  parseWebhookEvent(rawBody: Buffer): PaymentWebhookEvent;
}

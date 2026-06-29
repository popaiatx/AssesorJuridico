/**
 * Port de PAGAMENTO (driven). O domínio não conhece o gateway (Asaas): fala só
 * por esta interface. Webhooks são idempotentes — `gatewayEventId` é a chave
 * para processar cada evento uma única vez. Nunca confiar no payload: confirmar
 * o status no gateway antes de ativar.
 */

export interface EnsureCustomerInput {
  assinanteId: string;
  nome: string;
  email: string | null;
}

export interface CreateSubscriptionInput {
  assinanteId: string;
  customerId: string;
}

export interface SubscriptionResult {
  /** Referência da assinatura no gateway. */
  subscriptionRef: string;
  /** Link de pagamento (checkout) a enviar ao usuário. */
  paymentUrl: string;
  /** Próximo vencimento (YYYY-MM-DD), se conhecido. */
  proximoVencimento: string | null;
}

/** Evento já normalizado a partir do webhook do gateway. */
export interface PaymentWebhookEvent {
  gatewayEventId: string; // idempotência
  tipo: string; // ex.: PAYMENT_CONFIRMED, PAYMENT_OVERDUE, ...
  assinanteRef: string | null; // externalReference = assinante_id
  chargeId: string | null; // id da cobrança (para confirmar status no gateway)
}

export interface PaymentPort {
  /** Garante o cliente no gateway e retorna o customerId. */
  ensureCustomer(input: EnsureCustomerInput): Promise<string>;
  /** Cria a assinatura recorrente (Pix/cartão) e retorna o link de pagamento. */
  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult>;
  /** Confirma o status de uma cobrança no gateway (fonte da verdade). */
  getPaymentStatus(chargeId: string): Promise<string>;
  /** Valida a autenticidade do webhook (header `asaas-access-token`). */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<boolean>;
  parseWebhookEvent(rawBody: Buffer): PaymentWebhookEvent;
}

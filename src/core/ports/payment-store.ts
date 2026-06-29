/**
 * Tipos/portas do armazenamento de pagamento. Mantém a camada de aplicação
 * dependente só do core (a infra implementa estas assinaturas).
 */
export interface PaymentSubscriptionRow {
  status: string;
  cobrancaUrl: string | null;
  gatewayCustomerId: string | null;
  gatewayRef: string | null;
  nome: string;
  email: string | null;
}

export interface SaveCobrancaInput {
  status: string;
  cobrancaUrl: string;
  gatewayRef: string;
  gatewayCustomerId: string;
}

export interface ApplyAsaasEventInput {
  gatewayEventId: string;
  assinanteId: string;
  tipo: string;
  novoStatus: string | null;
  proximoVencimento: string | null;
  payload: unknown;
}

/** Lê a assinatura (+ nome/e-mail) do assinante para montar a cobrança. */
export type GetSubscription = (assinanteId: string) => Promise<PaymentSubscriptionRow | null>;
/** Salva a cobrança aberta e o estado. */
export type SaveCobranca = (assinanteId: string, fields: SaveCobrancaInput) => Promise<void>;
/** Aplica um evento do webhook (idempotente). `true` se aplicado agora. */
export type ApplyAsaasEvent = (input: ApplyAsaasEventInput) => Promise<boolean>;

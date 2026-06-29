/**
 * Acesso ao banco para o fluxo de pagamento.
 *
 *  - Caminho do assinante (handler de pagamento): lê/grava a assinatura via
 *    `withTenant` (RLS, sem service_role).
 *  - Caminho do webhook (Asaas nos chama, sem tenant): aplica o evento via a
 *    função SECURITY DEFINER `app.apply_asaas_event` (idempotente).
 */
import { pool } from './pool.js';
import { withTenant } from './tenant.js';

export interface PaymentSubscriptionRow {
  status: string;
  cobrancaUrl: string | null;
  gatewayCustomerId: string | null;
  gatewayRef: string | null;
  nome: string;
  email: string | null;
}

/** Lê a assinatura + nome/e-mail do assinante (tenant) para montar a cobrança. */
export async function getSubscriptionForPayment(
  assinanteId: string,
): Promise<PaymentSubscriptionRow | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<
      {
        status: string;
        cobranca_url: string | null;
        gateway_customer_id: string | null;
        gateway_ref: string | null;
        nome: string;
        email: string | null;
      }[]
    >`
      select a.status, a.cobranca_url, a.gateway_customer_id, a.gateway_ref, s.nome, s.email
      from assinaturas a
      join assinantes s on s.id = a.assinante_id
      where a.assinante_id = ${assinanteId}
      order by a.criado_em desc
      limit 1
    `;
    const r = rows[0];
    if (!r) return null;
    return {
      status: r.status,
      cobrancaUrl: r.cobranca_url,
      gatewayCustomerId: r.gateway_customer_id,
      gatewayRef: r.gateway_ref,
      nome: r.nome,
      email: r.email,
    };
  });
}

export interface SaveCobrancaInput {
  status: string;
  cobrancaUrl: string;
  gatewayRef: string;
  gatewayCustomerId: string;
}

/** Salva a cobrança aberta e o estado (tenant). */
export async function saveCobranca(assinanteId: string, fields: SaveCobrancaInput): Promise<void> {
  await withTenant(assinanteId, async (tx) => {
    await tx`
      update assinaturas set
        status = ${fields.status}::assinatura_status,
        cobranca_url = ${fields.cobrancaUrl},
        gateway_ref = ${fields.gatewayRef},
        gateway_customer_id = ${fields.gatewayCustomerId},
        atualizado_em = now()
      where assinante_id = ${assinanteId}
    `;
  });
}

export interface ApplyAsaasEventInput {
  gatewayEventId: string;
  assinanteId: string;
  tipo: string;
  novoStatus: string | null;
  proximoVencimento: string | null;
  payload: unknown;
}

/** Aplica o evento do webhook (idempotente). `true` se foi aplicado agora. */
export async function applyAsaasEvent(input: ApplyAsaasEventInput): Promise<boolean> {
  const rows = await pool<{ applied: boolean }[]>`
    select app.apply_asaas_event(
      ${input.gatewayEventId}, ${input.assinanteId}, ${input.tipo},
      ${input.novoStatus}::assinatura_status, ${input.proximoVencimento}::date,
      ${JSON.stringify(input.payload)}::jsonb
    ) as applied
  `;
  return rows[0]?.applied ?? false;
}

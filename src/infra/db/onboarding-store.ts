/**
 * Acesso ao banco do onboarding: estado persistente (retomada entre mensagens) e
 * auditoria pré-tenant. Chama as funções SECURITY DEFINER da migração 0014 via o
 * pool (as tabelas são travadas; sem service_role no caminho da mensagem).
 */
import { pool } from './pool.js';

export interface OnboardingEstadoRow {
  etapa: string;
  dados: Record<string, unknown>;
}

/** Estado atual do onboarding para o telefone, ou null se não houver. */
export async function getOnboardingEstado(phone: string): Promise<OnboardingEstadoRow | null> {
  const rows = await pool<{ estado: OnboardingEstadoRow | null }[]>`
    select app.get_onboarding_estado(${phone}) as estado
  `;
  return rows[0]?.estado ?? null;
}

export async function upsertOnboardingEstado(
  phone: string,
  etapa: string,
  dados: Record<string, unknown>,
): Promise<void> {
  await pool`
    select app.upsert_onboarding_estado(${phone}, ${etapa}, ${JSON.stringify(dados)}::jsonb)
  `;
}

export async function deleteOnboardingEstado(phone: string): Promise<void> {
  await pool`select app.delete_onboarding_estado(${phone})`;
}

/** Auditoria pré-tenant: telefone já vem em HASH; só etapa/evento em claro. */
export async function logOnboardingEvento(
  phoneHash: string,
  etapa: string,
  evento: string,
): Promise<void> {
  await pool`select app.log_onboarding_evento(${phoneHash}, ${etapa}, ${evento})`;
}

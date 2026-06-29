/**
 * Caminho PRÉ-TENANT (Refinamento R4).
 *
 * Antes de existir contexto de tenant, o backend precisa:
 *   (a) resolver telefone → assinante_id (login);
 *   (b) criar um assinante novo (onboarding).
 *
 * Isso NÃO pode virar pretexto para espalhar service_role pelo app. Este é o
 * ÚNICO ponto autorizado a fazer essas operações pré-tenant, e ele usa um
 * caminho controlado e mínimo:
 *
 *  - Resolução: a função SQL `app.resolve_assinante_by_phone(phone)` é
 *    SECURITY DEFINER e retorna SÓ o id (ver migração 0003). Chamamos via o
 *    pool comum (sem tenant); ela não expõe nenhuma outra coluna.
 *  - Criação: ponto único e isolado, documentado abaixo. PENDENTE até a Fase 1
 *    de onboarding; não implementado aqui para não fingir funcionar.
 */
import { pool } from './pool.js';

const PHONE_RE = /^\+?[0-9]{8,15}$/;

/**
 * Resolve o `assinante_id` a partir do telefone (identidade do WhatsApp).
 * Retorna `null` se nenhum assinante corresponder. Não vaza outros dados.
 */
export async function resolveAssinanteByPhone(phone: string): Promise<string | null> {
  if (!PHONE_RE.test(phone)) {
    throw new Error('resolveAssinanteByPhone: telefone em formato inválido.');
  }
  const rows = await pool<{ id: string | null }[]>`
    select app.resolve_assinante_by_phone(${phone}) as id
  `;
  return rows[0]?.id ?? null;
}

export interface CreateAssinanteOnboardingInput {
  telefone: string;
  nome: string;
  oabNumero: string;
  oabSeccional: string;
  documento: string;
  email: string | null;
  consentVersao: string;
  canal: string;
}

/**
 * Cria o assinante no onboarding — PONTO ÚNICO de criação. Insere o assinante em
 * TRIAL e grava o consentimento de IA atomicamente, via a função SECURITY DEFINER
 * `app.create_assinante_onboarding` (migração 0014). Roda no caminho da mensagem,
 * por isso NÃO usa service_role (consistente com `resolveAssinanteByPhone`).
 * Retorna o `assinante_id`.
 */
export async function createAssinanteOnboarding(
  input: CreateAssinanteOnboardingInput,
): Promise<string> {
  if (!PHONE_RE.test(input.telefone)) {
    throw new Error('createAssinanteOnboarding: telefone em formato inválido.');
  }
  const rows = await pool<{ id: string }[]>`
    select app.create_assinante_onboarding(
      ${input.telefone}, ${input.nome}, ${input.oabNumero}, ${input.oabSeccional},
      ${input.documento}, ${input.email ?? ''}, ${input.consentVersao}, ${input.canal}
    ) as id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('createAssinanteOnboarding: criação não retornou id.');
  }
  return id;
}

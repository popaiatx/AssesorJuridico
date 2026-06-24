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
import { NotImplementedError } from '../../core/errors.js';

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

/**
 * Cria o assinante no onboarding. PONTO ÚNICO de criação (não duplicar em
 * outro lugar). PENDENTE: o fluxo de onboarding é uma funcionalidade da Fase 1
 * que será implementada num passo próprio. Quando for implementado, deve usar
 * um caminho privilegiado controlado (SECURITY DEFINER dedicado ou o cliente
 * admin isolado), nunca espalhando service_role pelo domínio.
 */
export async function createAssinanteOnboarding(_input: unknown): Promise<never> {
  throw new NotImplementedError(
    'createAssinanteOnboarding: onboarding ainda não implementado (Fase 1, passo futuro).',
  );
}

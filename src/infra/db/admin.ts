/**
 * Cliente ADMINISTRATIVO (service_role) — ISOLADO.
 *
 * ⚠️  A chave service_role IGNORA O RLS. Um bug aqui vaza dados entre assinantes.
 *     Por isso este módulo:
 *      - é o ÚNICO ponto do código que instancia o cliente service_role;
 *      - destina-se SÓ a back-office, jobs administrativos e operações que,
 *        por natureza, precedem o contexto de tenant (ver `resolveAssinanteByPhone`);
 *      - NUNCA deve ser chamado no caminho normal de um assinante (use `withTenant`).
 *
 * Ver CLAUDE.md ("NUNCA usar service_role em operação de um assinante") e a
 * skill banco-supabase.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let cached: SupabaseClient | null = null;

/**
 * Retorna o cliente service_role. Lança se a chave não estiver configurada,
 * deixando explícito que esta é uma operação privilegiada (não silencia erro).
 */
export function getAdminClient(): SupabaseClient {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY ausente: operação administrativa indisponível. ' +
        'Configure no ambiente apenas onde back-office/migrações exigirem.',
    );
  }
  if (!cached) {
    cached = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

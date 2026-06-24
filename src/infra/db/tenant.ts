/**
 * Cliente de banco do CAMINHO DO ASSINANTE (tenant).
 *
 * Isolamento multi-tenant (CLAUDE.md / skill banco-supabase):
 *  - NÃO usa service_role. Conecta via pooler (Supavisor, modo transaction) com
 *    uma role SEM BYPASSRLS, de modo que o RLS do Postgres ATUE de fato.
 *  - O contexto de tenant é setado por transação com `set_config(..., is_local=true)`
 *    (equivalente a SET LOCAL). As políticas de RLS leem `app.current_assinante_id()`.
 *
 * Refinamento R2: SET LOCAL e as queries DEVEM rodar na mesma transação/conexão.
 * Como o pooler está em modo transaction, isso só é garantido dentro de uma
 * transação — por isso TODO acesso a dado de tenant passa por `withTenant(...)`.
 * Fora de `withTenant`, sem contexto setado, o RLS falha fechado (zero linhas)
 * — ver migração 0002 e o refinamento R1.
 */
import type postgres from 'postgres';
import { pool } from './pool.js';

/** Handle de SQL com escopo de transação entregue a `withTenant`. */
export type TenantSql = postgres.TransactionSql<Record<string, unknown>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Executa `fn` dentro de uma transação com o contexto de tenant setado.
 * O RLS restringe todas as linhas ao `assinante_id` informado.
 *
 * @param assinanteId UUID do assinante autenticado (resolvido da identidade,
 *                    NUNCA de valor vindo na mensagem).
 */
export async function withTenant<T>(
  assinanteId: string,
  fn: (tx: TenantSql) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(assinanteId)) {
    throw new Error('withTenant: assinanteId inválido (esperado UUID).');
  }
  return pool.begin(async (tx) => {
    // is_local = true → vale só nesta transação (SET LOCAL).
    await tx`select set_config('app.current_assinante_id', ${assinanteId}, true)`;
    // Rebaixa o privilégio para uma role SEM BYPASSRLS, garantindo que o RLS
    // ATUE de fato (a role da conexão — postgres — tem BYPASSRLS no Supabase e
    // ignoraria as políticas). 'authenticated' é NOLOGIN e sem bypass.
    await tx`set local role authenticated`;
    return fn(tx as TenantSql);
  }) as Promise<T>;
}

/** Checagem de conectividade (readiness). Não toca tabela de tenant. */
export async function pingDatabase(): Promise<void> {
  await pool`select 1`;
}

/** Encerra o pool (shutdown gracioso). */
export async function closeDatabase(): Promise<void> {
  await pool.end({ timeout: 5 });
}

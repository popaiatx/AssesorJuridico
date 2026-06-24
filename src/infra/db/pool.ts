/**
 * Pool de conexões interno (postgres / porsager) via pooler do Supabase
 * (Supavisor, modo transaction).
 *
 * ⚠️  NÃO use este pool diretamente para ler/gravar dado de tenant.
 *     Para dado de assinante, use `withTenant(...)` (tenant.ts), que abre a
 *     transação e seta o contexto de RLS. Este módulo é interno ao diretório
 *     `infra/db` e existe só para ser compartilhado pelos clientes de db.
 *
 * A role da DATABASE_URL deve ser SEM BYPASSRLS (ver README), senão o RLS
 * não vale.
 */
import postgres from 'postgres';
import { config } from '../config/index.js';

export const pool = postgres(config.DATABASE_URL, {
  // Pooler em modo transaction não suporta prepared statements de sessão.
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connection: { application_name: 'assistente-juridico' },
});

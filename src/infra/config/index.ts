/**
 * Configuração central — carrega e VALIDA as variáveis de ambiente no boot.
 * Falha rápido (fail-fast): se faltar um segredo obrigatório, o processo não sobe.
 *
 * Regras (CLAUDE.md / skill seguranca-dados-sigilo):
 *  - Segredos vêm SÓ do ambiente / secret manager; nunca do código.
 *  - A service_role IGNORA o RLS: fica isolada e só é exigida para back-office.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Servidor
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Supabase (projeto)
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),

  // service_role — isolada (back-office/migrações). Opcional para subir o app;
  // exigida apenas quando o cliente admin for efetivamente usado.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Banco — caminho da aplicação (pooler Supavisor, modo transaction).
  DATABASE_URL: z.string().url(),

  // --- Adapters externos (etapas futuras) — OPCIONAIS aqui ---
  // Só exigidas quando o adapter correspondente for ativado (cada adapter
  // valida a própria config). Nomes canônicos: ver .env.example.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  ASAAS_API_KEY: z.string().optional(),
  ASAAS_WEBHOOK_SECRET: z.string().optional(),
  COURTS_API_KEY: z.string().optional(),
  COURTS_WEBHOOK_SECRET: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).optional(),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    // Não logamos valores, apenas quais chaves falharam.
    throw new Error(`Configuração inválida. Corrija o ambiente:\n${issues}`);
  }
  return parsed.data;
}

export const config: Config = loadConfig();

export const isProduction = config.NODE_ENV === 'production';

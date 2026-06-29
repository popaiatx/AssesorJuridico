/**
 * Config do adapter Asaas. Mesmo padrão dos demais: `requireAsaasConfig()` valida
 * só quando ativado; o app sobe sem Asaas (pagamento inativo até ter chaves).
 * URLs base OFICIAIS da API v3 (sandbox/produção) selecionadas por ASAAS_ENV.
 */
import { config } from '../../infra/config/index.js';

export type AsaasEnv = 'sandbox' | 'production';

const BASE_URL: Record<AsaasEnv, string> = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

export interface AsaasConfig {
  env: AsaasEnv;
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
}

export function getAsaasConfig(): AsaasConfig | null {
  const env: AsaasEnv = config.ASAAS_ENV ?? 'sandbox';
  const { ASAAS_API_KEY, ASAAS_WEBHOOK_SECRET } = config;
  if (!ASAAS_API_KEY || !ASAAS_WEBHOOK_SECRET) return null;
  return { env, apiKey: ASAAS_API_KEY, webhookSecret: ASAAS_WEBHOOK_SECRET, baseUrl: BASE_URL[env] };
}

export function requireAsaasConfig(): AsaasConfig {
  const cfg = getAsaasConfig();
  if (!cfg) {
    throw new Error(
      'Asaas não configurado: defina ASAAS_API_KEY e ASAAS_WEBHOOK_SECRET ' +
        '(e ASAAS_ENV=sandbox|production) no .env.example.',
    );
  }
  return cfg;
}

/**
 * Config do adapter de LLM. Mesmo padrão do WhatsApp: `requireLlmConfig()` valida
 * só quando o LLM é ativado, então o app sobe sem LLM (usando o classificador por
 * palavras-chave como fallback). `.env.example` continua a fonte única.
 */
import { config } from '../../infra/config/index.js';

export type LlmProvider = 'anthropic' | 'openai';

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

/** Retorna a config validada ou `null` se o LLM não estiver configurado. */
export function getLlmConfig(): LlmConfig | null {
  const { LLM_PROVIDER, LLM_MODEL, LLM_API_KEY } = config;
  if (!LLM_PROVIDER || !LLM_MODEL || !LLM_API_KEY) {
    return null;
  }
  return { provider: LLM_PROVIDER, model: LLM_MODEL, apiKey: LLM_API_KEY };
}

/** Igual ao anterior, mas lança quando ativado sem config — uso na composição. */
export function requireLlmConfig(): LlmConfig {
  const cfg = getLlmConfig();
  if (!cfg) {
    throw new Error(
      'LLM não configurado: defina LLM_PROVIDER (anthropic|openai), LLM_MODEL e ' +
        'LLM_API_KEY (.env.example).',
    );
  }
  return cfg;
}

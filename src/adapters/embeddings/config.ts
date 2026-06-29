/**
 * Config dos embeddings (RAG). Variáveis próprias, no padrão dos demais adapters:
 * o app sobe sem embeddings (e aí o Cérebro 2 fica inativo → placeholder).
 */
import { config } from '../../infra/config/index.js';

export type EmbeddingsProvider = 'openai';

export interface EmbeddingsConfig {
  provider: EmbeddingsProvider;
  model: string;
  apiKey: string;
}

export function getEmbeddingsConfig(): EmbeddingsConfig | null {
  const { EMBEDDINGS_PROVIDER, EMBEDDINGS_MODEL, EMBEDDINGS_API_KEY } = config;
  if (!EMBEDDINGS_PROVIDER || !EMBEDDINGS_MODEL || !EMBEDDINGS_API_KEY) return null;
  return { provider: EMBEDDINGS_PROVIDER, model: EMBEDDINGS_MODEL, apiKey: EMBEDDINGS_API_KEY };
}

export function requireEmbeddingsConfig(): EmbeddingsConfig {
  const cfg = getEmbeddingsConfig();
  if (!cfg) {
    throw new Error(
      'Embeddings não configurados: defina EMBEDDINGS_PROVIDER (openai), ' +
        'EMBEDDINGS_MODEL e EMBEDDINGS_API_KEY (.env.example).',
    );
  }
  return cfg;
}

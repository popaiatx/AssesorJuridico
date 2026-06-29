/**
 * Seleção do adapter de embeddings por config (provider-agnostic).
 */
import type { EmbeddingsPort } from '../../core/ports/embeddings.js';
import type { HttpPost } from '../llm/http.js';
import type { EmbeddingsConfig } from './config.js';
import { OpenAiEmbeddingsAdapter } from './openai-embeddings.js';

export function createEmbeddingsAdapter(
  cfg: EmbeddingsConfig,
  httpPost?: HttpPost,
): EmbeddingsPort {
  switch (cfg.provider) {
    case 'openai':
      return new OpenAiEmbeddingsAdapter(cfg, httpPost);
  }
}

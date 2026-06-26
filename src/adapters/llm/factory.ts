/**
 * Seleção do adapter de LLM por config. Trocar de provedor é mudar `LLM_PROVIDER`
 * — o domínio só conhece o `LlmPort`.
 */
import type { LlmPort } from '../../core/ports/llm.js';
import { AnthropicLlmAdapter } from './anthropic-adapter.js';
import { OpenAiLlmAdapter } from './openai-adapter.js';
import type { LlmConfig } from './config.js';
import { fetchHttpPost, type HttpPost } from './http.js';

export function createLlmAdapter(cfg: LlmConfig, httpPost: HttpPost = fetchHttpPost): LlmPort {
  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicLlmAdapter(cfg, httpPost);
    case 'openai':
      return new OpenAiLlmAdapter(cfg, httpPost);
  }
}

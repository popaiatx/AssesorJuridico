/**
 * Adapter de embeddings — OpenAI (`/v1/embeddings`), raw HTTP injetável.
 * Recomendado: `text-embedding-3-small` (1536 dims) — barato e bom p/ recuperação.
 */
import type { EmbeddingsPort } from '../../core/ports/embeddings.js';
import type { EmbeddingsConfig } from './config.js';
import { fetchHttpPost, type HttpPost } from '../llm/http.js';

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

interface OpenAiEmbeddingsResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

export class OpenAiEmbeddingsAdapter implements EmbeddingsPort {
  constructor(
    private readonly config: EmbeddingsConfig,
    private readonly httpPost: HttpPost = fetchHttpPost,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.httpPost(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: this.config.model, input: texts }),
    });
    const raw = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`OpenAI embeddings respondeu ${res.status}: ${raw.slice(0, 300)}`);
    }
    const parsed = JSON.parse(raw) as OpenAiEmbeddingsResponse;
    const data = [...(parsed.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return data.map((d) => d.embedding ?? []);
  }
}

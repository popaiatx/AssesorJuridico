/**
 * Adapter de embeddings — OpenAI (`/v1/embeddings`), raw HTTP injetável.
 * Recomendado: `text-embedding-3-small` (1536 dims) — barato e bom p/ recuperação.
 *
 * Resiliência: erros TRANSITÓRIOS (HTTP 429/5xx e falhas de rede) têm retry com
 * backoff exponencial — um hiccup do servidor não pode derrubar uma norma inteira
 * na ingestão (ex.: a CLT faz dezenas de chamadas). Erros definitivos (4xx que não
 * 429, ex.: 400/401) NÃO são repetidos.
 */
import type { EmbeddingsPort } from '../../core/ports/embeddings.js';
import type { EmbeddingsConfig } from './config.js';
import { fetchHttpPost, type HttpPost } from '../llm/http.js';

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

interface OpenAiEmbeddingsResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

export interface OpenAiEmbeddingsOptions {
  /** Tentativas extras após a primeira, em erro transitório (default 3). */
  maxRetries?: number;
  /** Espera entre tentativas (injetável; default backoff exponencial real). */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class OpenAiEmbeddingsAdapter implements EmbeddingsPort {
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly config: EmbeddingsConfig,
    private readonly httpPost: HttpPost = fetchHttpPost,
    options: OpenAiEmbeddingsOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? realSleep;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body = JSON.stringify({ model: this.config.model, input: texts });
    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'content-type': 'application/json',
    };

    let attempt = 0;
    for (;;) {
      let status: number;
      let raw: string;
      try {
        const res = await this.httpPost(ENDPOINT, { headers, body });
        status = res.status;
        raw = await res.text();
      } catch (err) {
        // Falha de rede (ex.: ECONNRESET): transitória → retry.
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          attempt += 1;
          continue;
        }
        throw err;
      }

      if (status >= 200 && status < 300) {
        const parsed = JSON.parse(raw) as OpenAiEmbeddingsResponse;
        const data = [...(parsed.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        return data.map((d) => d.embedding ?? []);
      }

      // 429 (rate limit) e 5xx são transitórios; o resto é definitivo.
      const transitorio = status === 429 || status >= 500;
      if (transitorio && attempt < this.maxRetries) {
        await this.sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }
      throw new Error(`OpenAI embeddings respondeu ${status}: ${raw.slice(0, 300)}`);
    }
  }
}

/** Backoff exponencial: 0.5s, 1s, 2s, ... */
function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

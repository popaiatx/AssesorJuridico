import { describe, expect, it } from 'vitest';
import { OpenAiEmbeddingsAdapter } from '../src/adapters/embeddings/openai-embeddings';
import { createEmbeddingsAdapter } from '../src/adapters/embeddings/factory';
import { getEmbeddingsConfig, type EmbeddingsConfig } from '../src/adapters/embeddings/config';
import type { HttpPost } from '../src/adapters/llm/http';

const cfg: EmbeddingsConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-emb' };

function recorder(body: unknown, status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const post: HttpPost = (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) });
  };
  return { post, calls };
}

describe('OpenAiEmbeddingsAdapter', () => {
  it('monta POST /v1/embeddings e devolve vetores na ordem do índice', async () => {
    const { post, calls } = recorder({
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    });
    const adapter = new OpenAiEmbeddingsAdapter(cfg, post);
    const out = await adapter.embed(['a', 'b']);

    expect(calls[0]!.url).toBe('https://api.openai.com/v1/embeddings');
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk-emb');
    const sent = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: 'text-embedding-3-small', input: ['a', 'b'] });
    expect(out).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]); // reordenado por index
  });

  it('lista vazia → não chama a API', async () => {
    const { post, calls } = recorder({});
    const adapter = new OpenAiEmbeddingsAdapter(cfg, post);
    expect(await adapter.embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('factory seleciona OpenAI; getEmbeddingsConfig null sem env', () => {
    expect(createEmbeddingsAdapter(cfg)).toBeInstanceOf(OpenAiEmbeddingsAdapter);
    expect(getEmbeddingsConfig()).toBeNull(); // vitest não define EMBEDDINGS_*
  });
});

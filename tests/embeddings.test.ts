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

  it('erro 500 transitório → retry e sucesso na 2ª tentativa', async () => {
    let n = 0;
    const post: HttpPost = () => {
      n += 1;
      if (n === 1) return Promise.resolve({ status: 500, text: () => Promise.resolve('boom') });
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] })),
      });
    };
    const adapter = new OpenAiEmbeddingsAdapter(cfg, post, { sleep: () => Promise.resolve() });
    const out = await adapter.embed(['a']);
    expect(out).toEqual([[1, 2]]);
    expect(n).toBe(2); // 1 falha + 1 sucesso
  });

  it('500 persistente → esgota retries e lança', async () => {
    let n = 0;
    const post: HttpPost = () => {
      n += 1;
      return Promise.resolve({ status: 500, text: () => Promise.resolve('still boom') });
    };
    const adapter = new OpenAiEmbeddingsAdapter(cfg, post, {
      maxRetries: 2,
      sleep: () => Promise.resolve(),
    });
    await expect(adapter.embed(['a'])).rejects.toThrow(/respondeu 500/);
    expect(n).toBe(3); // 1 + 2 retries
  });

  it('erro 400 definitivo → NÃO faz retry', async () => {
    let n = 0;
    const post: HttpPost = () => {
      n += 1;
      return Promise.resolve({ status: 400, text: () => Promise.resolve('bad request') });
    };
    const adapter = new OpenAiEmbeddingsAdapter(cfg, post, { sleep: () => Promise.resolve() });
    await expect(adapter.embed(['a'])).rejects.toThrow(/respondeu 400/);
    expect(n).toBe(1); // sem retry
  });

  it('factory seleciona OpenAI; getEmbeddingsConfig reflete o ambiente', () => {
    expect(createEmbeddingsAdapter(cfg)).toBeInstanceOf(OpenAiEmbeddingsAdapter);
    // Independe do ambiente: se as EMBEDDINGS_* estiverem setadas (.env), devolve a
    // config; senão, null. (Não assume um .env específico nem expõe segredo.)
    const temEnv = Boolean(
      process.env.EMBEDDINGS_PROVIDER &&
        process.env.EMBEDDINGS_MODEL &&
        process.env.EMBEDDINGS_API_KEY,
    );
    const got = getEmbeddingsConfig();
    if (temEnv) {
      expect(got?.provider).toBe('openai');
      expect(got?.model).toBeTruthy();
    } else {
      expect(got).toBeNull();
    }
  });
});

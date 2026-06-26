import { describe, expect, it } from 'vitest';
import { AnthropicLlmAdapter } from '../src/adapters/llm/anthropic-adapter';
import { OpenAiLlmAdapter } from '../src/adapters/llm/openai-adapter';
import { createLlmAdapter } from '../src/adapters/llm/factory';
import { getLlmConfig, requireLlmConfig, type LlmConfig } from '../src/adapters/llm/config';
import type { HttpPost } from '../src/adapters/llm/http';

function recorder(responseBody: string, status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const post: HttpPost = (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return Promise.resolve({ status, text: () => Promise.resolve(responseBody) });
  };
  return { post, calls };
}

const anthropicCfg: LlmConfig = { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-ant' };
const openaiCfg: LlmConfig = { provider: 'openai', model: 'gpt-x', apiKey: 'sk-oai' };

describe('AnthropicLlmAdapter', () => {
  it('monta a requisição correta e faz parse (sem rede)', async () => {
    const body = JSON.stringify({
      content: [
        { type: 'text', text: 'olá' },
        { type: 'tool_use', id: 't1', name: 'foo', input: { a: 1 } },
      ],
      stop_reason: 'end_turn',
    });
    const http = recorder(body);
    const adapter = new AnthropicLlmAdapter(anthropicCfg, http.post);

    const result = await adapter.generate({
      system: 'S',
      messages: [{ role: 'user', content: 'oi' }],
      maxTokens: 50,
      responseFormat: { type: 'json_schema', name: 'r', schema: { type: 'object' } },
    });

    expect(http.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(http.calls[0]!.headers['x-api-key']).toBe('sk-ant');
    expect(http.calls[0]!.headers['anthropic-version']).toBe('2023-06-01');
    const sent = JSON.parse(http.calls[0]!.body) as Record<string, unknown>;
    expect(sent.model).toBe('claude-haiku-4-5');
    expect(sent.max_tokens).toBe(50);
    expect(sent.system).toBe('S');
    expect(sent).not.toHaveProperty('temperature'); // removido nos modelos novos
    expect(sent.output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });

    expect(result.text).toBe('olá');
    expect(result.toolCalls).toEqual([{ id: 't1', name: 'foo', input: { a: 1 } }]);
    expect(result.stopReason).toBe('end_turn');
  });

  it('propaga erro em status não-2xx', async () => {
    const http = recorder('{"error":"bad"}', 400);
    const adapter = new AnthropicLlmAdapter(anthropicCfg, http.post);
    await expect(adapter.generate({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /Anthropic respondeu 400/,
    );
  });
});

describe('OpenAiLlmAdapter', () => {
  it('monta a requisição correta e faz parse (sem rede)', async () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: 'oi',
            tool_calls: [{ id: 'c1', function: { name: 'foo', arguments: '{"a":1}' } }],
          },
          finish_reason: 'stop',
        },
      ],
    });
    const http = recorder(body);
    const adapter = new OpenAiLlmAdapter(openaiCfg, http.post);

    const result = await adapter.generate({
      system: 'S',
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(http.calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(http.calls[0]!.headers.Authorization).toBe('Bearer sk-oai');
    const sent = JSON.parse(http.calls[0]!.body) as { messages: Array<{ role: string }> };
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'S' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'oi' });

    expect(result.text).toBe('oi');
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'foo', input: { a: 1 } }]);
    expect(result.stopReason).toBe('stop');
  });
});

describe('createLlmAdapter / config', () => {
  it('seleciona o adapter pelo provider', () => {
    expect(createLlmAdapter(anthropicCfg)).toBeInstanceOf(AnthropicLlmAdapter);
    expect(createLlmAdapter(openaiCfg)).toBeInstanceOf(OpenAiLlmAdapter);
  });

  it('sem LLM configurado: getLlmConfig null e requireLlmConfig lança', () => {
    // Ambiente de teste não define LLM_* (ver vitest.config).
    expect(getLlmConfig()).toBeNull();
    expect(() => requireLlmConfig()).toThrow(/LLM não configurado/);
  });
});

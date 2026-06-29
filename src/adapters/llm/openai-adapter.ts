/**
 * Adapter de LLM — OpenAI, via Chat Completions API em raw HTTP.
 * `system` vira a primeira mensagem; saída estruturada via `response_format`.
 */
import type {
  LlmGenerateParams,
  LlmGenerateResult,
  LlmMessage,
  LlmPort,
  LlmToolCall,
  LlmToolChoice,
} from '../../core/ports/llm.js';
import type { LlmConfig } from './config.js';
import { fetchHttpPost, type HttpPost } from './http.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MAX_TOKENS = 1024;

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: string;
  }>;
}

function mapMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
  return { role: m.role, content: m.content };
}

function mapToolChoice(choice: LlmToolChoice): unknown {
  if (choice === 'auto') return 'auto';
  if (choice === 'required') return 'required';
  return { type: 'function', function: { name: choice.name } };
}

function safeParse(args: string | undefined): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

export class OpenAiLlmAdapter implements LlmPort {
  constructor(
    private readonly config: LlmConfig,
    private readonly httpPost: HttpPost = fetchHttpPost,
  ) {}

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    const messages: Array<Record<string, unknown>> = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    for (const m of params.messages) messages.push(mapMessage(m));

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
    };
    if (params.tools) {
      body.tools = params.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }
    if (params.toolChoice) body.tool_choice = mapToolChoice(params.toolChoice);
    if (params.responseFormat) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: params.responseFormat.name,
          schema: params.responseFormat.schema,
          strict: true,
        },
      };
    }

    const res = await this.httpPost(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`OpenAI respondeu ${res.status}: ${raw.slice(0, 300)}`);
    }

    const parsed = JSON.parse(raw) as OpenAiResponse;
    const choice = parsed.choices?.[0];
    const toolCalls: LlmToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id ?? '',
      name: tc.function?.name ?? '',
      input: safeParse(tc.function?.arguments),
    }));
    return {
      text: choice?.message?.content ?? '',
      toolCalls,
      stopReason: choice?.finish_reason ?? 'stop',
    };
  }
}

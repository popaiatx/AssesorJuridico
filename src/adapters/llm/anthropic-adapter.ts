/**
 * Adapter de LLM — Anthropic (Claude), via Messages API em raw HTTP.
 * Não envia `temperature` (removido nos modelos novos → 400). `system` no topo;
 * saída estruturada via `output_config.format`.
 */
import { NotImplementedError } from '../../core/errors.js';
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

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface AnthropicResponse {
  content?: AnthropicBlock[];
  stop_reason?: string;
}

function mapMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    // Resultado de ferramenta entra como bloco tool_result numa mensagem de user.
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
    };
  }
  return { role: m.role, content: m.content };
}

function mapToolChoice(choice: LlmToolChoice): Record<string, unknown> {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.name };
}

export class AnthropicLlmAdapter implements LlmPort {
  constructor(
    private readonly config: LlmConfig,
    private readonly httpPost: HttpPost = fetchHttpPost,
  ) {}

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: params.messages.map(mapMessage),
    };
    if (params.system) body.system = params.system;
    if (params.tools) {
      body.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }
    if (params.toolChoice) body.tool_choice = mapToolChoice(params.toolChoice);
    if (params.responseFormat) {
      body.output_config = {
        format: { type: 'json_schema', schema: params.responseFormat.schema },
      };
    }

    const res = await this.httpPost(ENDPOINT, {
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Anthropic respondeu ${res.status}: ${raw.slice(0, 300)}`);
    }

    const parsed = JSON.parse(raw) as AnthropicResponse;
    let text = '';
    const toolCalls: LlmToolCall[] = [];
    for (const block of parsed.content ?? []) {
      if (block.type === 'text' && block.text) {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id ?? '', name: block.name ?? '', input: block.input });
      }
    }
    return { text, toolCalls, stopReason: parsed.stop_reason ?? 'end_turn' };
  }

  embed(_texts: string[]): Promise<number[][]> {
    // Anthropic não tem API de embeddings nativa; PENDENTE (fase RAG).
    throw new NotImplementedError('Embeddings Anthropic não implementado (PENDENTE).');
  }
}

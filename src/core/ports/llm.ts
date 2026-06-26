/**
 * Port de LLM (driven), PROVIDER-AGNOSTIC. Nenhum detalhe de provedor (Anthropic,
 * OpenAI, …) vaza para o domínio — trocar de provedor/modelo é mudar config.
 *
 * Suporta tool use / function calling e saída estruturada (JSON Schema), para os
 * próximos passos (decidir agendar, salvar documento, etc.). Neste passo nenhuma
 * ferramenta de escrita é ligada ainda — a interface só fica pronta.
 *
 * Regras (CLAUDE.md / skills): contexto mínimo ao LLM; anonimizar dado de cliente
 * antes do envio quando aplicável (ponto marcado para fases futuras). Provedor
 * com política de não-treinamento + DPA.
 */

export type LlmRole = 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** Para `role: 'tool'`: id da chamada de ferramenta que este resultado responde. */
  toolCallId?: string;
}

/** Definição de uma ferramenta (function calling). `inputSchema` é JSON Schema. */
export interface LlmToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type LlmToolChoice = 'auto' | 'required' | { name: string };

/** Saída estruturada: força a resposta a obedecer um JSON Schema. */
export interface LlmResponseFormat {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmGenerateParams {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  tools?: LlmToolDef[];
  toolChoice?: LlmToolChoice;
  responseFormat?: LlmResponseFormat;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmGenerateResult {
  /** Texto da resposta (vazio quando o modelo só pediu ferramentas). */
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: string;
}

export interface LlmPort {
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
  /** Embeddings para o RAG (Cérebro 2). PENDENTE nesta fase. */
  embed(texts: string[]): Promise<number[][]>;
}

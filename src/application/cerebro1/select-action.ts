/**
 * Seleção de ação por tool-use. CONTEXTO MÍNIMO ao LLM: só a mensagem do usuário,
 * o menu de ações e a data/hora atual (para resolver datas relativas). NENHUMA
 * linha do banco nesta chamada. Se nada casar, o LLM responde em texto útil.
 */
import { ACTIONS, ACTIONS_BY_NAME } from '../../core/domain/cerebro1-actions.js';
import type { LlmPort, LlmToolDef } from '../../core/ports/llm.js';

export type ActionSelection =
  | { kind: 'acao'; acao: string; input: Record<string, unknown> }
  | { kind: 'texto'; text: string };

const TOOLS: LlmToolDef[] = ACTIONS.map((a) => ({
  name: a.name,
  description: a.description,
  inputSchema: a.inputSchema,
}));

const BASE_SYSTEM = [
  'Você é a estagiárIA, uma assistente jurídica no WhatsApp que organiza os dados do escritório do próprio usuário.',
  'Escolha UMA ferramenta para a intenção e extraia os parâmetros.',
  'Se a mensagem NÃO corresponder a nenhuma ação (ex.: dúvida jurídica sobre a lei, conversa solta),',
  'NÃO use ferramenta: responda em texto, breve e útil — explique que você organiza compromissos,',
  'prazos e processos; se for dúvida jurídica, avise que respostas jurídicas virão com a fonte citada',
  '(em desenvolvimento). Nunca invente dados.',
].join(' ');

export interface SelectOptions {
  forced?: { acao: string; knownParams: Record<string, unknown> };
}

export async function selectAction(
  llm: LlmPort,
  message: string,
  now: Date,
  opts: SelectOptions = {},
): Promise<ActionSelection> {
  let system = `${BASE_SYSTEM}\nData e hora atuais: ${now.toISOString()} (America/Sao_Paulo). Devolva data_hora em ISO 8601 com fuso.`;
  if (opts.forced) {
    system +=
      `\nVocê está completando a ação "${opts.forced.acao}". Já temos: ` +
      `${JSON.stringify(opts.forced.knownParams)}. Extraia da mensagem os campos que faltam.`;
  }

  const result = await llm.generate({
    system,
    messages: [{ role: 'user', content: message }],
    tools: TOOLS,
    toolChoice: opts.forced ? { name: opts.forced.acao } : 'auto',
    maxTokens: 400,
  });

  const call = result.toolCalls[0];
  if (call && ACTIONS_BY_NAME[call.name]) {
    const input = (call.input ?? {}) as Record<string, unknown>;
    return { kind: 'acao', acao: call.name, input };
  }

  const text =
    result.text.trim() ||
    'Posso te ajudar a organizar processos, prazos e compromissos. O que você precisa?';
  return { kind: 'texto', text };
}

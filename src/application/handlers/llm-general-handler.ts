/**
 * Handler de AJUDA / CONVERSA GERAL via LLM (primeiro ciclo real WhatsApp →
 * orquestrador → LLM → resposta).
 *
 * Ligado SÓ a `ajuda` e `outro`. `duvida_juridica` continua placeholder: dar
 * conteúdo jurídico sem fonte violaria a regra de zero-alucinação/recusa-sem-fonte
 * (skill rag-juridico-confiavel). O system prompt reforça isso.
 *
 * Contexto mínimo ao LLM: vai só o texto da mensagem; nenhum dado de assinante.
 * (Ponto de anonimização a tratar quando dados de assinante entrarem em prompts.)
 */
import type { Intent } from '../../core/domain/intents.js';
import type { HandlerResult, IntentHandler, MessageContext } from '../../core/orchestration/handler.js';
import type { LlmPort } from '../../core/ports/llm.js';

const SYSTEM_PROMPT = [
  'Você é um assessor jurídico que ajuda advogados pelo WhatsApp, em português do Brasil.',
  'Seja breve, claro e cordial. Você pode explicar o que o assistente faz e conversar de forma geral.',
  'NUNCA dê conteúdo jurídico (lei, artigo, súmula, jurisprudência) sem fonte. Se perguntarem',
  'sobre direito, explique que respostas jurídicas com citação da fonte ainda estão em',
  'desenvolvimento e virão sempre com a lei ou o precedente citados. Não invente nada.',
  'Isto não é aconselhamento jurídico.',
  'Em desenvolvimento (avise quando pedirem): processos, prazos/agenda, financeiro, documentos,',
  'andamento processual e assinatura.',
].join(' ');

const FALLBACK_REPLY =
  'Tive um problema para responder agora. Posso ajudar com seus processos, prazos, ' +
  'financeiro, documentos e dúvidas jurídicas (com fonte) — tudo em desenvolvimento. 🚧';

export class LlmGeneralHandler implements IntentHandler {
  constructor(
    public readonly intent: Intent,
    private readonly llm: LlmPort,
  ) {}

  async handle(ctx: MessageContext): Promise<HandlerResult> {
    try {
      const result = await this.llm.generate({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: ctx.message.text }],
        maxTokens: 300,
      });
      const text = result.text.trim();
      return { replyText: text.length > 0 ? text : FALLBACK_REPLY };
    } catch {
      // Nunca expor erro interno ao usuário.
      return { replyText: FALLBACK_REPLY };
    }
  }
}

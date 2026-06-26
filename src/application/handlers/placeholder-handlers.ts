/**
 * Handlers PLACEHOLDER honestos (Fase 1, passo 2).
 *
 * Os cérebros e o onboarding ainda não existem. Cada handler devolve uma
 * resposta clara de "em desenvolvimento" — NUNCA um resultado falso. A lógica de
 * classificação, roteamento e registro (um handler por intenção) é real.
 */
import type { Intent } from '../../core/domain/intents.js';
import { INTENTS } from '../../core/domain/intents.js';
import type {
  HandlerRegistry,
  IntentHandler,
} from '../../core/orchestration/handler.js';

const PLACEHOLDER_REPLIES: Record<Intent, string> = {
  onboarding:
    '👋 Olá! Eu sou seu assessor jurídico no WhatsApp. O cadastro de novos ' +
    'usuários ainda está em desenvolvimento — em breve você poderá se cadastrar por aqui. 🚧',
  consulta_dados:
    '🚧 A consulta aos seus processos e clientes ainda está em desenvolvimento. ' +
    'Em breve você poderá perguntar, por exemplo, "quais são meus processos ativos?".',
  duvida_juridica:
    '🚧 As respostas a dúvidas jurídicas ainda estão em desenvolvimento. Quando ' +
    'ficarem prontas, toda resposta virá com a fonte citada (lei ou precedente).',
  consulta_andamento:
    '🚧 A consulta de andamento processual ainda está em desenvolvimento. Em ' +
    'breve poderei buscar as movimentações dos seus processos.',
  agendar:
    '🚧 O agendamento de audiências, reuniões e prazos ainda está em ' +
    'desenvolvimento. Em breve você poderá marcar compromissos por aqui.',
  financeiro:
    '🚧 O registro de custos e honorários ainda está em desenvolvimento. Em ' +
    'breve você poderá lançar e acompanhar valores por processo.',
  documento:
    '🚧 O envio e a busca de documentos ainda estão em desenvolvimento. Em ' +
    'breve você poderá anexar arquivos aos seus processos.',
  assinatura:
    '🚧 A gestão da sua assinatura e plano ainda está em desenvolvimento. Em ' +
    'breve você poderá consultar e alterar seu plano por aqui.',
  ajuda:
    'Eu vou te ajudar com: seus processos e clientes, dúvidas jurídicas com ' +
    'fonte, andamento processual, agenda e prazos, honorários e custos, ' +
    'documentos e sua assinatura. Tudo isso ainda está em desenvolvimento. 🚧',
  outro:
    '🤔 Ainda não entendi o que você precisa. Posso ajudar com seus processos, ' +
    'dúvidas jurídicas, andamento, agenda e prazos, financeiro, documentos e ' +
    'assinatura. (O assistente ainda está em desenvolvimento.)',
};

function makePlaceholder(intent: Intent): IntentHandler {
  const replyText = PLACEHOLDER_REPLIES[intent];
  return {
    intent,
    handle: () => Promise.resolve({ replyText }),
  };
}

/**
 * Registro com EXATAMENTE um handler por intenção (completude testada).
 * `overrides` substitui handlers específicos (ex.: ajuda/outro via LLM) mantendo
 * placeholders honestos no restante.
 */
export function buildDefaultRegistry(
  overrides: Partial<Record<Intent, IntentHandler>> = {},
): HandlerRegistry {
  const registry = new Map<Intent, IntentHandler>();
  for (const intent of INTENTS) {
    registry.set(intent, overrides[intent] ?? makePlaceholder(intent));
  }
  return registry;
}

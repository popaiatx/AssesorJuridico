/**
 * Contrato de um handler de intenção. O registro mapeia cada `Intent` para
 * EXATAMENTE um handler; o orquestrador chama um só (um-cérebro-por-mensagem).
 */
import type { RecentContext } from '../domain/conversation/memory.js';
import type { Cerebro, Intent } from '../domain/intents.js';
import type { InboundMessage } from '../ports/whatsapp.js';

export interface MessageContext {
  /** Assinante autenticado; null no caminho pré-tenant (onboarding). */
  assinanteId: string | null;
  intent: Intent;
  message: InboundMessage;
  /**
   * Memória de conversa recente (cauda curta, só intenção + citações públicas) para
   * interpretar a mensagem. NUNCA é fonte de afirmação jurídica. Ausente = sem memória.
   */
  recentContext?: RecentContext;
}

export interface HandlerResult {
  /** Texto a enviar ao usuário (o envio em si é responsabilidade do canal). */
  replyText: string;
  /** Cérebro que efetivamente respondeu (para auditoria). */
  cerebro?: Cerebro;
  /** Fontes citadas (RAG) — gravadas no log de interação. */
  fontesCitadas?: string[];
  /**
   * Ids (UUID) dos documentos listados nesta resposta, em ordem (Passo 12C). O
   * orquestrador os guarda na memória para resolver "resume o segundo" depois.
   */
  documentosListados?: string[];
}

export interface IntentHandler {
  readonly intent: Intent;
  handle(ctx: MessageContext): Promise<HandlerResult>;
}

export type HandlerRegistry = ReadonlyMap<Intent, IntentHandler>;

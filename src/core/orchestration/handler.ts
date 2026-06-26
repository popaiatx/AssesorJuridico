/**
 * Contrato de um handler de intenção. O registro mapeia cada `Intent` para
 * EXATAMENTE um handler; o orquestrador chama um só (um-cérebro-por-mensagem).
 */
import type { Intent } from '../domain/intents.js';
import type { InboundMessage } from '../ports/whatsapp.js';

export interface MessageContext {
  /** Assinante autenticado; null no caminho pré-tenant (onboarding). */
  assinanteId: string | null;
  intent: Intent;
  message: InboundMessage;
}

export interface HandlerResult {
  /** Texto a enviar ao usuário (o envio em si é responsabilidade do canal). */
  replyText: string;
}

export interface IntentHandler {
  readonly intent: Intent;
  handle(ctx: MessageContext): Promise<HandlerResult>;
}

export type HandlerRegistry = ReadonlyMap<Intent, IntentHandler>;

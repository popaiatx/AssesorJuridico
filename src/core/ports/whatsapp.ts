/**
 * Port de WHATSAPP (driven). Canal de entrada/saída do produto.
 *
 * Regras (CLAUDE.md / skill whatsapp-orquestracao):
 *  - Conversa livre só dentro da janela de 24h após o usuário escrever.
 *  - Mensagem proativa só por TEMPLATE aprovado.
 *  - O telefone é a identidade do assinante.
 *
 * Apenas assinaturas; sem implementação nesta fase (ver adapters/whatsapp).
 */

export interface InboundMessage {
  messageId: string;
  from: string; // telefone (identidade)
  text: string;
  timestamp: string; // ISO
}

export interface TemplateMessage {
  to: string;
  templateName: string;
  variables: Record<string, string>;
}

export interface WhatsappPort {
  /** Texto livre — SÓ válido dentro da janela de 24h. */
  sendFreeFormMessage(to: string, text: string): Promise<void>;
  /** Proativa — SÓ por template aprovado. */
  sendTemplate(message: TemplateMessage): Promise<void>;
  /** Verificação do webhook (handshake/assinatura) antes de confiar no payload. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<boolean>;
  /** Um payload pode conter várias mensagens. */
  parseInboundMessages(rawBody: Buffer): InboundMessage[];
}

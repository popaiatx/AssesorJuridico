/**
 * Adapter REAL do WhatsApp (implementa `WhatsappPort`).
 *
 *  - verifyWebhook: valida a assinatura HMAC do corpo cru.
 *  - parseInboundMessages: delega ao parser da Cloud API.
 *  - sendFreeFormMessage: texto livre — SÓ dentro da janela de 24h (senão recusa,
 *    forçando template).
 *  - sendTemplate: proativa por template aprovado.
 */
import type { TemplateMessage, WhatsappPort } from '../../core/ports/whatsapp.js';
import type { InboundMessage } from '../../core/ports/whatsapp.js';
import type { Clock, WindowStore } from './abstractions.js';
import type { CloudApiClient } from './cloud-api-client.js';
import type { WhatsappConfig } from './config.js';
import { parseInboundMessages } from './parse.js';
import { verifySignature } from './signature.js';
import { getTemplate } from './templates.js';

const WINDOW_HOURS = 24;

/** Lançado ao tentar texto livre fora da janela de 24h (use template). */
export class WhatsappWindowClosedError extends Error {
  constructor(to: string) {
    super(`Janela de 24h fechada para ${to}: texto livre não permitido (use template).`);
    this.name = 'WhatsappWindowClosedError';
  }
}

export class WhatsappAdapter implements WhatsappPort {
  constructor(
    private readonly deps: {
      config: WhatsappConfig;
      client: CloudApiClient;
      window: WindowStore;
      clock: Clock;
    },
  ) {}

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<boolean> {
    return Promise.resolve(verifySignature(rawBody, headers, this.deps.config.appSecret));
  }

  parseInboundMessages(rawBody: Buffer): InboundMessage[] {
    return parseInboundMessages(rawBody);
  }

  async sendFreeFormMessage(to: string, text: string): Promise<void> {
    if (!(await this.isWindowOpen(to))) {
      throw new WhatsappWindowClosedError(to);
    }
    await this.deps.client.sendText(to, text);
  }

  async sendTemplate(message: TemplateMessage): Promise<void> {
    const template = getTemplate(message.templateName);
    if (!template) {
      throw new Error(`Template desconhecido: ${message.templateName}`);
    }
    await this.deps.client.sendTemplate(message.to, template, message.variables);
  }

  private async isWindowOpen(to: string): Promise<boolean> {
    const last = await this.deps.window.lastInbound(to);
    if (!last) return false;
    const elapsedMs = this.deps.clock().getTime() - last.getTime();
    return elapsedMs <= WINDOW_HOURS * 60 * 60 * 1000;
  }
}

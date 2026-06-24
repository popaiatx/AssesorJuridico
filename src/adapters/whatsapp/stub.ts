/**
 * Adapter de WHATSAPP — STUB (PENDENTE).
 *
 * Implementa `WhatsappPort`, mas NÃO funciona: cada método lança
 * NotImplementedError. O adapter real (Cloud API / BSP), com janela de 24h e
 * templates aprovados, será implementado na fase do canal.
 */
import { NotImplementedError } from '../../core/errors.js';
import type {
  InboundMessage,
  TemplateMessage,
  WhatsappPort,
} from '../../core/ports/whatsapp.js';

const PENDENTE = 'Adapter de WhatsApp ainda não implementado (PENDENTE).';

export class StubWhatsappAdapter implements WhatsappPort {
  sendFreeFormMessage(_to: string, _text: string): Promise<void> {
    throw new NotImplementedError(PENDENTE);
  }
  sendTemplate(_message: TemplateMessage): Promise<void> {
    throw new NotImplementedError(PENDENTE);
  }
  verifyWebhook(_rawBody: Buffer, _headers: Record<string, string>): Promise<boolean> {
    throw new NotImplementedError(PENDENTE);
  }
  parseInboundMessages(_rawBody: Buffer): InboundMessage[] {
    throw new NotImplementedError(PENDENTE);
  }
}

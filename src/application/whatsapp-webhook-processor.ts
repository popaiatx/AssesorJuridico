/**
 * Processa o payload do webhook do WhatsApp. PROCESSA ANTES DO ACK: o
 * processamento conclui e só então o webhook responde 200; em falha transitória
 * lança → a rota responde 500 e a Meta reentrega.
 *
 * Idempotência com lease (ordem crítica): o claim só vira "done" APÓS o
 * processamento (envio incluído) ter sucesso; em falha, o claim é liberado, para
 * a reentrega reprocessar. Crash no meio é coberto pela expiração do lease.
 */
import type { Orchestrator } from './orchestrator.js';
import type { InboundMessage, WhatsappPort } from '../core/ports/whatsapp.js';
import type { Clock, MessageDeduplicator, WindowStore } from '../adapters/whatsapp/abstractions.js';

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

const MEDIA_REPLY =
  '📎 Recebi seu arquivo, mas o processamento de documentos ainda está em ' +
  'desenvolvimento. Em breve poderei vinculá-lo ao seu processo. 🚧';

export interface WhatsappWebhookProcessorDeps {
  whatsapp: WhatsappPort;
  orchestrator: Orchestrator;
  dedup: MessageDeduplicator;
  window: WindowStore;
  clock: Clock;
  logger: Logger;
}

export class WhatsappWebhookProcessor {
  constructor(private readonly deps: WhatsappWebhookProcessorDeps) {}

  /** Processa todas as mensagens do payload. Lança se alguma falhar (→ 500). */
  async process(rawBody: Buffer): Promise<void> {
    const messages = this.deps.whatsapp.parseInboundMessages(rawBody);
    let failed = false;
    for (const msg of messages) {
      try {
        await this.processOne(msg);
      } catch (err) {
        failed = true;
        this.deps.logger.error({ err, messageId: msg.messageId }, 'falha ao processar mensagem');
      }
    }
    if (failed) {
      // Pelo menos uma falhou e teve o claim liberado → 500 para a Meta reentregar.
      throw new Error('Falha ao processar uma ou mais mensagens do webhook.');
    }
  }

  private async processOne(msg: InboundMessage): Promise<void> {
    if (!msg.messageId || !msg.from) {
      this.deps.logger.warn({ messageId: msg.messageId }, 'mensagem sem id/remetente — ignorada');
      return;
    }

    const claimed = await this.deps.dedup.claim(msg.messageId);
    if (!claimed) {
      // Duplicada (já concluída) ou em processamento por outro worker.
      this.deps.logger.info({ messageId: msg.messageId }, 'mensagem duplicada — ignorada');
      return;
    }

    try {
      // Usuário escreveu agora → abre/atualiza a janela de 24h.
      await this.deps.window.recordInbound(msg.from, this.deps.clock());

      if (msg.media) {
        // Mídia: placeholder honesto, sem passar pelo orquestrador (download/Storage PENDENTE).
        await this.deps.whatsapp.sendFreeFormMessage(msg.from, MEDIA_REPLY);
      } else {
        const result = await this.deps.orchestrator.handleInboundMessage(msg);
        await this.deps.whatsapp.sendFreeFormMessage(msg.from, result.replyText);
      }

      // Sucesso → confirma o claim (não será reprocessada).
      await this.deps.dedup.markDone(msg.messageId);
    } catch (err) {
      // Falha transitória → libera o claim para a reentrega reprocessar.
      await this.deps.dedup.release(msg.messageId);
      throw err;
    }
  }
}

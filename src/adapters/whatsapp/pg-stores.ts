/**
 * Implementações reais (Postgres) das abstrações de idempotência e janela,
 * ligando em `infra/db/whatsapp-store` (funções SECURITY DEFINER, sem service_role).
 */
import {
  claimWhatsappMessage,
  markWhatsappMessageDone,
  releaseWhatsappMessage,
  touchWhatsappWindow,
  whatsappWindowLast,
} from '../../infra/db/whatsapp-store.js';
import type { MessageDeduplicator, WindowStore } from './abstractions.js';

/**
 * Lease do claim (segundos): tempo após o qual um claim 'processing' órfão
 * (worker que caiu) pode ser reassumido. Folgado sobre o processamento leve.
 */
const LEASE_SECONDS = 120;

export class PgMessageDeduplicator implements MessageDeduplicator {
  claim(messageId: string): Promise<boolean> {
    return claimWhatsappMessage(messageId, LEASE_SECONDS);
  }
  markDone(messageId: string): Promise<void> {
    return markWhatsappMessageDone(messageId);
  }
  release(messageId: string): Promise<void> {
    return releaseWhatsappMessage(messageId);
  }
}

export class PgWindowStore implements WindowStore {
  recordInbound(phone: string, at: Date): Promise<void> {
    return touchWhatsappWindow(phone, at.toISOString());
  }
  async lastInbound(phone: string): Promise<Date | null> {
    const iso = await whatsappWindowLast(phone);
    return iso ? new Date(iso) : null;
  }
}

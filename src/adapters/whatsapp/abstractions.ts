/**
 * Abstrações injetáveis usadas pelo adapter e pelo processor do WhatsApp.
 * Permitem testar a lógica (janela de 24h, idempotência, roteamento) sem banco
 * e sem rede. As implementações reais ligam em `infra/db/whatsapp-store`.
 */

/** Relógio injetável (testável). */
export type Clock = () => Date;

/** Idempotência com lease (ver migração 0013). */
export interface MessageDeduplicator {
  /** true = processar agora; false = pular (duplicada ou em curso). */
  claim(messageId: string): Promise<boolean>;
  /** Confirma o processamento (só após sucesso). */
  markDone(messageId: string): Promise<void>;
  /** Libera o claim em falha transitória (Meta reentrega e reprocessamos). */
  release(messageId: string): Promise<void>;
}

/** Janela de 24h por contato. */
export interface WindowStore {
  recordInbound(phone: string, at: Date): Promise<void>;
  lastInbound(phone: string): Promise<Date | null>;
}

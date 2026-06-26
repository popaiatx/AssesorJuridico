/**
 * Acesso ao banco para idempotência do webhook e janela de 24h do WhatsApp.
 *
 * Chama as funções SECURITY DEFINER da migração 0013 via o pool (mesma
 * abordagem de `identity.resolveAssinanteByPhone`). As tabelas em si são
 * travadas (RLS sem políticas) — todo acesso passa por estas funções. Não usa
 * service_role.
 */
import { pool } from './pool.js';

/** Reivindica a mensagem. `true` = processar agora; `false` = pular (duplicada/em curso). */
export async function claimWhatsappMessage(
  messageId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const rows = await pool<{ claimed: boolean }[]>`
    select app.try_claim_whatsapp_message(${messageId}, ${leaseSeconds}) as claimed
  `;
  return rows[0]?.claimed ?? false;
}

/** Marca a mensagem como concluída (após sucesso do processamento). */
export async function markWhatsappMessageDone(messageId: string): Promise<void> {
  await pool`select app.mark_whatsapp_message_done(${messageId})`;
}

/** Libera o claim em falha transitória (a Meta reentrega e reprocessamos). */
export async function releaseWhatsappMessage(messageId: string): Promise<void> {
  await pool`select app.release_whatsapp_message(${messageId})`;
}

/** Registra a última mensagem do contato (janela de 24h). */
export async function touchWhatsappWindow(phone: string, atISO: string): Promise<void> {
  await pool`select app.touch_whatsapp_window(${phone}, ${atISO}::timestamptz)`;
}

/** Última entrada do contato em ISO, ou null se nunca escreveu. */
export async function whatsappWindowLast(phone: string): Promise<string | null> {
  const rows = await pool<{ last: string | null }[]>`
    select app.whatsapp_window_last(${phone}) as last
  `;
  return rows[0]?.last ?? null;
}

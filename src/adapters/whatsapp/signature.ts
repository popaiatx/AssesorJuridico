/**
 * Verificação da assinatura do webhook (X-Hub-Signature-256).
 *
 * A Meta envia `sha256=<hmac>` onde o HMAC-SHA256 é calculado sobre o corpo CRU
 * com o App Secret. Calculamos sobre os mesmos bytes e comparamos em tempo
 * constante (timingSafeEqual). Assinatura inválida/ausente → rejeitar.
 * É o que impede chamadas forjadas ao webhook.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = 'x-hub-signature-256';

export function expectedSignature(rawBody: Buffer, appSecret: string): string {
  const hmac = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return `sha256=${hmac}`;
}

/** True se a assinatura do header confere com o corpo cru. */
export function verifySignature(
  rawBody: Buffer,
  headers: Record<string, string | undefined>,
  appSecret: string,
): boolean {
  const received = headers[HEADER];
  if (!received) return false;

  const expected = expectedSignature(rawBody, appSecret);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  // timingSafeEqual exige mesmo tamanho; tamanhos diferentes => inválido.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

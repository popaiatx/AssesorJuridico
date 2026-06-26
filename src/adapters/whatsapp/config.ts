/**
 * Config do adapter do WhatsApp. Padrão "cada adapter valida a própria config":
 * `requireWhatsappConfig()` lança se faltar alguma variável WHATSAPP_*. Assim o
 * app sobe mesmo sem WhatsApp configurado (o webhook só é registrado quando há
 * config). `.env.example` continua sendo a fonte única das variáveis.
 */
import { config } from '../../infra/config/index.js';

export interface WhatsappConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
}

/** Retorna a config validada ou `null` se o WhatsApp não estiver configurado. */
export function getWhatsappConfig(): WhatsappConfig | null {
  const { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET } =
    config;
  if (
    !WHATSAPP_PHONE_NUMBER_ID ||
    !WHATSAPP_ACCESS_TOKEN ||
    !WHATSAPP_VERIFY_TOKEN ||
    !WHATSAPP_APP_SECRET
  ) {
    return null;
  }
  return {
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    accessToken: WHATSAPP_ACCESS_TOKEN,
    verifyToken: WHATSAPP_VERIFY_TOKEN,
    appSecret: WHATSAPP_APP_SECRET,
  };
}

/** Igual ao anterior, mas lança quando ativado sem config — uso na composição. */
export function requireWhatsappConfig(): WhatsappConfig {
  const cfg = getWhatsappConfig();
  if (!cfg) {
    throw new Error(
      'WhatsApp não configurado: defina WHATSAPP_PHONE_NUMBER_ID, ' +
        'WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN e WHATSAPP_APP_SECRET (.env.example).',
    );
  }
  return cfg;
}

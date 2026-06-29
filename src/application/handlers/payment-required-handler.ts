/**
 * Handler do fluxo de PAGAMENTO quando o acesso está bloqueado (trial vencido /
 * inadimplente). Passo 6A: PLACEHOLDER HONESTO — avisa que o teste terminou e que
 * a cobrança chega em breve. SEM link falso, sem fingir cobrança.
 *
 * No 6B este handler passa a gerar/reenviar o link real do Asaas (idempotente).
 */
import type { HandlerResult, MessageContext } from '../../core/orchestration/handler.js';

const REPLY =
  '🔒 Seu período de teste de 3 dias chegou ao fim — obrigado por experimentar! ' +
  'Para continuar usando, em breve você poderá assinar aqui mesmo (cartão, Pix ou ' +
  'Pix Automático). Estou finalizando essa parte e te aviso assim que estiver no ar. 🚧';

export class PaymentRequiredHandler {
  handle(_ctx: MessageContext): Promise<HandlerResult> {
    return Promise.resolve({ replyText: REPLY });
  }
}

/**
 * Sender de lembrete sobre o WhatsApp: mensagem PROATIVA → vai por TEMPLATE
 * aprovado (`lembrete_generico`, parâmetro `mensagem`). Implementa a porta
 * `LembreteSender`. O envio real depende da aprovação do template na Meta (PENDENTE).
 */
import type { LembreteSender } from '../../core/ports/reminders.js';
import type { WhatsappPort } from '../../core/ports/whatsapp.js';

export function whatsappLembreteSender(whatsapp: WhatsappPort): LembreteSender {
  return {
    enviar: (telefone, mensagem) =>
      whatsapp.sendTemplate({
        to: telefone,
        templateName: 'lembrete_generico',
        variables: { mensagem },
      }),
  };
}

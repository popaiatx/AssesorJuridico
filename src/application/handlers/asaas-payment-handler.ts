/**
 * Handler de PAGAMENTO real (Asaas), acionado pelo porteiro quando o acesso está
 * bloqueado. IDEMPOTENTE: se já há cobrança aberta (`cobranca_url`), reusa e
 * reenvia o MESMO link; senão cria a assinatura no Asaas, salva a cobrança,
 * transita para `aguardando_pagamento` e envia o link. Nunca duplica cobrança.
 */
import type { BlockedHandler } from '../orchestrator.js';
import type { HandlerResult, MessageContext } from '../../core/orchestration/handler.js';
import type { PaymentPort } from '../../core/ports/payment.js';
import type { GetSubscription, SaveCobranca } from '../../core/ports/payment-store.js';

export interface AsaasPaymentHandlerDeps {
  payment: PaymentPort;
  getSubscription: GetSubscription;
  saveCobranca: SaveCobranca;
}

const SEM_CONTA =
  '🔒 Para continuar, preciso ativar sua conta. Mande "oi" para começar o cadastro.';

function linkMessage(url: string): string {
  return (
    '🔒 Seu período de teste terminou. Para continuar usando o assistente, é só ' +
    `concluir o pagamento (cartão ou Pix) por aqui:\n${url}\n\n` +
    'Assim que o pagamento for confirmado, eu libero seu acesso automaticamente. 🙂'
  );
}

export class AsaasPaymentHandler implements BlockedHandler {
  constructor(private readonly deps: AsaasPaymentHandlerDeps) {}

  async handle(ctx: MessageContext): Promise<HandlerResult> {
    const assinanteId = ctx.assinanteId;
    if (!assinanteId) return { replyText: SEM_CONTA };

    const sub = await this.deps.getSubscription(assinanteId);
    if (!sub) return { replyText: SEM_CONTA };

    // Idempotência: cobrança já aberta → reenvia o mesmo link (não cria outra).
    if (sub.cobrancaUrl) {
      return { replyText: linkMessage(sub.cobrancaUrl) };
    }

    const customerId =
      sub.gatewayCustomerId ??
      (await this.deps.payment.ensureCustomer({
        assinanteId,
        nome: sub.nome,
        email: sub.email,
      }));

    const result = await this.deps.payment.createSubscription({ assinanteId, customerId });

    await this.deps.saveCobranca(assinanteId, {
      status: 'aguardando_pagamento',
      cobrancaUrl: result.paymentUrl,
      gatewayRef: result.subscriptionRef,
      gatewayCustomerId: customerId,
    });

    return { replyText: linkMessage(result.paymentUrl) };
  }
}

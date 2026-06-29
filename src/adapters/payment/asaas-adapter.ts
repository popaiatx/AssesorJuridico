/**
 * Adapter de PAGAMENTO — Asaas (API v3), raw HTTP com cliente injetável.
 * Header de API `access_token`; webhook autenticado pelo header `asaas-access-token`.
 * Nunca armazena dado de cartão (tokenização é do Asaas, no checkout).
 */
import { timingSafeEqual } from 'node:crypto';
import type {
  CreateSubscriptionInput,
  EnsureCustomerInput,
  PaymentPort,
  PaymentWebhookEvent,
  SubscriptionResult,
} from '../../core/ports/payment.js';
import type { AsaasConfig } from './config.js';
import { fetchHttpRequest, type HttpRequest } from './http.js';

/** Valor mensal da assinatura (sandbox). Ajustável no lançamento. */
const VALOR_MENSAL = 49.9;

const WEBHOOK_HEADER = 'asaas-access-token';

interface AsaasCustomer {
  id?: string;
}
interface AsaasSubscription {
  id?: string;
}
interface AsaasPayment {
  id?: string;
  status?: string;
  invoiceUrl?: string;
  externalReference?: string | null;
}
interface AsaasWebhookBody {
  id?: string;
  event?: string;
  payment?: AsaasPayment;
  subscription?: { id?: string; externalReference?: string | null };
}

export class AsaasAdapter implements PaymentPort {
  constructor(
    private readonly config: AsaasConfig,
    private readonly http: HttpRequest = fetchHttpRequest,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private headers(): Record<string, string> {
    return { access_token: this.config.apiKey, 'content-type': 'application/json' };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.http(method, `${this.config.baseUrl}${path}`, {
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Asaas ${method} ${path} respondeu ${res.status}: ${raw.slice(0, 300)}`);
    }
    return JSON.parse(raw) as T;
  }

  async ensureCustomer(input: EnsureCustomerInput): Promise<string> {
    const customer = await this.call<AsaasCustomer>('POST', '/customers', {
      name: input.nome,
      email: input.email ?? undefined,
      externalReference: input.assinanteId,
    });
    if (!customer.id) throw new Error('Asaas: criação de cliente sem id.');
    return customer.id;
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult> {
    const nextDueDate = this.clock().toISOString().slice(0, 10); // YYYY-MM-DD
    const sub = await this.call<AsaasSubscription>('POST', '/subscriptions', {
      customer: input.customerId,
      // UNDEFINED → o checkout do Asaas oferece Pix e cartão (payer escolhe).
      billingType: 'UNDEFINED',
      value: VALOR_MENSAL,
      nextDueDate,
      cycle: 'MONTHLY',
      description: 'Assinatura Assessor Jurídico',
      externalReference: input.assinanteId,
    });
    if (!sub.id) throw new Error('Asaas: criação de assinatura sem id.');

    // Link de pagamento = invoiceUrl da primeira cobrança da assinatura.
    const payments = await this.call<{ data?: AsaasPayment[] }>(
      'GET',
      `/subscriptions/${sub.id}/payments?limit=1`,
    );
    const paymentUrl = payments.data?.[0]?.invoiceUrl;
    if (!paymentUrl) throw new Error('Asaas: assinatura sem link de pagamento.');

    return { subscriptionRef: sub.id, paymentUrl, proximoVencimento: nextDueDate };
  }

  async getPaymentStatus(chargeId: string): Promise<string> {
    const payment = await this.call<AsaasPayment>('GET', `/payments/${chargeId}`);
    return payment.status ?? 'UNKNOWN';
  }

  verifyWebhook(_rawBody: Buffer, headers: Record<string, string>): Promise<boolean> {
    const received = headers[WEBHOOK_HEADER];
    if (!received) return Promise.resolve(false);
    const a = Buffer.from(received);
    const b = Buffer.from(this.config.webhookSecret);
    if (a.length !== b.length) return Promise.resolve(false);
    return Promise.resolve(timingSafeEqual(a, b));
  }

  parseWebhookEvent(rawBody: Buffer): PaymentWebhookEvent {
    const body = JSON.parse(rawBody.toString('utf8') || '{}') as AsaasWebhookBody;
    const tipo = body.event ?? 'UNKNOWN';
    const chargeId = body.payment?.id ?? null;
    const assinanteRef =
      body.payment?.externalReference ?? body.subscription?.externalReference ?? null;
    // id do evento p/ idempotência; fallback estável quando ausente.
    const gatewayEventId = body.id ?? `${tipo}:${chargeId ?? body.subscription?.id ?? ''}`;
    return { gatewayEventId, tipo, assinanteRef, chargeId };
  }
}

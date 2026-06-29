/**
 * Rota do webhook do Asaas (plugin Fastify encapsulado), mesmo cuidado do webhook
 * do WhatsApp: autenticidade pelo header `asaas-access-token`, PROCESSA antes do
 * ack (200 sucesso / 500 reentrega). Parser de Buffer cru encapsulado no plugin.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { PaymentPort } from '../../core/ports/payment.js';

export interface AsaasWebhookProcessor {
  process(rawBody: Buffer): Promise<void>;
}

export interface AsaasRoutesDeps {
  adapter: Pick<PaymentPort, 'verifyWebhook'>;
  processor: AsaasWebhookProcessor;
}

interface WithRawBody {
  rawBody?: Buffer;
}

export function asaasRoutes(deps: AsaasRoutesDeps): FastifyPluginAsync {
  return async (app) => {
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as FastifyRequest & WithRawBody).rawBody = body as Buffer;
      done(null, body);
    });

    app.post('/webhooks/asaas', async (req, reply) => {
      const rawBody = (req as FastifyRequest & WithRawBody).rawBody ?? Buffer.alloc(0);
      const headers = req.headers as Record<string, string>;

      const valid = await deps.adapter.verifyWebhook(rawBody, headers);
      if (!valid) {
        return reply.code(401).send('invalid token');
      }

      try {
        await deps.processor.process(rawBody); // processa ANTES do ack
        return reply.code(200).send('ok');
      } catch (err) {
        req.log.error({ err }, 'falha ao processar webhook do Asaas');
        return reply.code(500).send('processing error');
      }
    });
  };
}

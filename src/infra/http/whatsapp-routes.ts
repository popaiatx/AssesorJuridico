/**
 * Rotas do webhook do WhatsApp (plugin Fastify encapsulado).
 *
 *  - GET: handshake de verificação (hub.challenge / verify token).
 *  - POST: verifica a assinatura HMAC do corpo CRU, PROCESSA, e só então responde
 *    (200 sucesso / 500 falha → Meta reentrega).
 *
 * O content-type parser que preserva o Buffer cru é registrado AQUI (escopo do
 * plugin), sem afetar outras rotas (ex.: /health).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WhatsappPort } from '../../core/ports/whatsapp.js';

/** Mínimo que a rota precisa do processor (facilita teste/abstração). */
export interface WebhookProcessor {
  process(rawBody: Buffer): Promise<void>;
}

export interface WhatsappRoutesDeps {
  verifyToken: string;
  adapter: Pick<WhatsappPort, 'verifyWebhook'>;
  processor: WebhookProcessor;
}

interface WithRawBody {
  rawBody?: Buffer;
}

export function whatsappRoutes(deps: WhatsappRoutesDeps): FastifyPluginAsync {
  return async (app) => {
    // Mantém o Buffer cru para o cálculo do HMAC (encapsulado neste plugin).
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (req, body, done) => {
        (req as FastifyRequest & WithRawBody).rawBody = body as Buffer;
        done(null, body);
      },
    );

    // GET — verificação do webhook.
    app.get('/webhooks/whatsapp', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === deps.verifyToken) {
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      }
      return reply.code(403).send('forbidden');
    });

    // POST — recebe mensagens.
    app.post('/webhooks/whatsapp', async (req, reply) => {
      const rawBody = (req as FastifyRequest & WithRawBody).rawBody ?? Buffer.alloc(0);
      const headers = req.headers as Record<string, string>;

      const valid = await deps.adapter.verifyWebhook(rawBody, headers);
      if (!valid) {
        // Assinatura inválida/ausente → rejeita (não processa).
        return reply.code(401).send('invalid signature');
      }

      try {
        await deps.processor.process(rawBody); // processa ANTES do ack
        return reply.code(200).send('ok');
      } catch (err) {
        // Falha transitória: não confirma → 500 para a Meta reentregar.
        req.log.error({ err }, 'falha ao processar webhook do WhatsApp');
        return reply.code(500).send('processing error');
      }
    });
  };
}

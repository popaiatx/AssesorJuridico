/**
 * Servidor HTTP (Fastify). Nesta fase expõe apenas o health check, para o
 * projeto subir e rodar. Webhooks (WhatsApp, pagamento, tribunais) e demais
 * rotas virão nas próximas fases, cada uma num passo próprio.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { pingDatabase } from '../db/tenant.js';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
  });

  // Liveness: o processo está de pé. Não depende de serviços externos.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness: pronto para tráfego — confere conectividade com o banco.
  app.get('/health/ready', async (_req, reply) => {
    try {
      await pingDatabase();
      return { status: 'ready', db: 'up' };
    } catch (err) {
      _req.log.error({ err }, 'readiness: banco indisponível');
      return reply.status(503).send({ status: 'unavailable', db: 'down' });
    }
  });

  return app;
}

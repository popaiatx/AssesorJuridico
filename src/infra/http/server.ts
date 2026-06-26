/**
 * Servidor HTTP (Fastify) e composição (composition root).
 *
 * Monta o orquestrador (classificador + registro + log) e, se o WhatsApp estiver
 * configurado, o adapter real + processor + rotas do webhook. Sem config de
 * WhatsApp, o app sobe normalmente e o webhook fica desabilitado (convenção A).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { pingDatabase } from '../db/tenant.js';
import { resolveAssinanteByPhone } from '../db/identity.js';
import { Orchestrator } from '../../application/orchestrator.js';
import { buildDefaultRegistry } from '../../application/handlers/placeholder-handlers.js';
import { KeywordIntentClassifier } from '../../adapters/classifier/keyword-classifier.js';
import { SupabaseInteractionLog } from '../../adapters/interaction-log/supabase-interaction-log.js';
import { getWhatsappConfig } from '../../adapters/whatsapp/config.js';
import { CloudApiClient } from '../../adapters/whatsapp/cloud-api-client.js';
import { WhatsappAdapter } from '../../adapters/whatsapp/whatsapp-adapter.js';
import { PgMessageDeduplicator, PgWindowStore } from '../../adapters/whatsapp/pg-stores.js';
import { WhatsappWebhookProcessor } from '../../application/whatsapp-webhook-processor.js';
import { whatsappRoutes } from './whatsapp-routes.js';

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

  registerWhatsapp(app);

  return app;
}

/** Compõe o orquestrador e, se configurado, o webhook do WhatsApp. */
function registerWhatsapp(app: FastifyInstance): void {
  const orchestrator = new Orchestrator({
    resolveAssinante: resolveAssinanteByPhone,
    classifier: new KeywordIntentClassifier(),
    registry: buildDefaultRegistry(),
    interactionLog: new SupabaseInteractionLog(app.log),
  });

  const wcfg = getWhatsappConfig();
  if (!wcfg) {
    app.log.warn('WhatsApp não configurado — webhook desabilitado (defina WHATSAPP_* no .env)');
    return;
  }

  const clock = () => new Date();
  const window = new PgWindowStore();
  const adapter = new WhatsappAdapter({
    config: wcfg,
    client: new CloudApiClient(wcfg),
    window,
    clock,
  });
  const processor = new WhatsappWebhookProcessor({
    whatsapp: adapter,
    orchestrator,
    dedup: new PgMessageDeduplicator(),
    window,
    clock,
    logger: app.log,
  });

  void app.register(whatsappRoutes({ verifyToken: wcfg.verifyToken, adapter, processor }));
  app.log.info('WhatsApp webhook habilitado em /webhooks/whatsapp');
}

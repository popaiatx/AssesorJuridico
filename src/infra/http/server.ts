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
import { resolveAssinanteByPhone, createAssinanteOnboarding } from '../db/identity.js';
import { Orchestrator } from '../../application/orchestrator.js';
import { buildDefaultRegistry } from '../../application/handlers/placeholder-handlers.js';
import { LlmGeneralHandler } from '../../application/handlers/llm-general-handler.js';
import { OnboardingHandler } from '../../application/handlers/onboarding-handler.js';
import { KeywordIntentClassifier } from '../../adapters/classifier/keyword-classifier.js';
import { LlmIntentClassifier } from '../../adapters/classifier/llm-classifier.js';
import { SupabaseInteractionLog } from '../../adapters/interaction-log/supabase-interaction-log.js';
import { SupabaseOnboardingStore } from '../../adapters/onboarding/supabase-onboarding-store.js';
import { SupabasePreTenantAudit } from '../../adapters/pre-tenant-audit/supabase-pre-tenant-audit.js';
import { SupabaseSubscriptionGate } from '../../adapters/subscription/supabase-subscription-gate.js';
import { PaymentRequiredHandler } from '../../application/handlers/payment-required-handler.js';
import { AsaasPaymentHandler } from '../../application/handlers/asaas-payment-handler.js';
import { AsaasWebhookProcessor } from '../../application/asaas-webhook-processor.js';
import { AsaasAdapter } from '../../adapters/payment/asaas-adapter.js';
import { getAsaasConfig } from '../../adapters/payment/config.js';
import { asaasRoutes } from './asaas-routes.js';
import {
  applyAsaasEvent,
  getSubscriptionForPayment,
  saveCobranca,
} from '../db/payment-store.js';
import type { BlockedHandler } from '../../application/orchestrator.js';
import type { IntentClassifier } from '../../core/ports/intent-classifier.js';
import type { HandlerRegistry, IntentHandler } from '../../core/orchestration/handler.js';
import type { Intent } from '../../core/domain/intents.js';
import { getLlmConfig } from '../../adapters/llm/config.js';
import { createLlmAdapter } from '../../adapters/llm/factory.js';
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
  const keyword = new KeywordIntentClassifier();
  const llmCfg = getLlmConfig();

  // Onboarding real é a porta de entrada de número novo (sempre ligado).
  const onboardingHandler = new OnboardingHandler({
    store: new SupabaseOnboardingStore(),
    audit: new SupabasePreTenantAudit(),
    createAssinante: createAssinanteOnboarding,
  });
  const overrides: Partial<Record<Intent, IntentHandler>> = { onboarding: onboardingHandler };

  let classifier: IntentClassifier = keyword;

  if (llmCfg) {
    const llm = createLlmAdapter(llmCfg);
    // LLM classifica (com fallback determinístico) e responde ajuda/conversa geral.
    classifier = new LlmIntentClassifier(llm, keyword);
    overrides.ajuda = new LlmGeneralHandler('ajuda', llm);
    overrides.outro = new LlmGeneralHandler('outro', llm);
    app.log.info(`LLM habilitado (${llmCfg.provider}/${llmCfg.model})`);
  } else {
    app.log.warn('LLM não configurado — usando classificador por palavras-chave');
  }

  const registry: HandlerRegistry = buildDefaultRegistry(overrides);

  // Pagamento: com Asaas configurado, gera/reenvia link real e registra o webhook;
  // sem Asaas, o bloqueio responde o placeholder honesto (app sobe sem pagamento).
  const asaasCfg = getAsaasConfig();
  let paymentRequiredHandler: BlockedHandler;
  if (asaasCfg) {
    const payment = new AsaasAdapter(asaasCfg);
    paymentRequiredHandler = new AsaasPaymentHandler({
      payment,
      getSubscription: getSubscriptionForPayment,
      saveCobranca,
    });
    const processor = new AsaasWebhookProcessor({
      payment,
      applyEvent: applyAsaasEvent,
      logger: app.log,
    });
    void app.register(asaasRoutes({ adapter: payment, processor }));
    app.log.info(`Asaas habilitado (${asaasCfg.env}) — webhook em /webhooks/asaas`);
  } else {
    paymentRequiredHandler = new PaymentRequiredHandler();
    app.log.warn('Asaas não configurado — bloqueio pós-trial usa placeholder honesto');
  }

  const orchestrator = new Orchestrator({
    resolveAssinante: resolveAssinanteByPhone,
    classifier,
    registry,
    interactionLog: new SupabaseInteractionLog(app.log),
    // Porteiro: bloqueia tudo após o trial (fail-closed) e desvia para pagamento.
    gate: new SupabaseSubscriptionGate(),
    paymentRequiredHandler,
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

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
import { Cerebro1Handler } from '../../application/cerebro1/cerebro1-handler.js';
import {
  supabaseCerebro1Store,
  supabasePendingStore,
} from '../../adapters/cerebro1/supabase-cerebro1-store.js';
import { FichaProcessoService } from '../../application/cerebro1/ficha-processo.js';
import { supabaseFichaStore } from '../../adapters/cerebro1/supabase-ficha-store.js';
import { supabaseFinanceiroStore } from '../../adapters/cerebro1/supabase-financeiro-store.js';
import { Cerebro2Handler } from '../../application/cerebro2/cerebro2-handler.js';
import { supabaseCorpusStore } from '../../adapters/corpus/supabase-corpus-store.js';
import { conversationMemoryStore } from '../db/conversation-memory-store.js';
import { normalizeText } from '../../core/domain/validators.js';
import type { InboundMessage } from '../../core/ports/whatsapp.js';
import { supabaseStorage } from '../../adapters/storage/supabase-storage.js';
import { WhatsappMediaDownloader } from '../../adapters/whatsapp/whatsapp-media-downloader.js';
import { DocumentoService } from '../../application/documentos/documento-service.js';
import { DocumentHandler } from '../../application/documentos/document-handler.js';
import { BuscarDocumentos } from '../../application/documentos/buscar-documentos.js';
import { ResumirDocumento } from '../../application/documentos/resumir-documento.js';
import { DocumentSearchHandler } from '../../application/documentos/document-search-handler.js';
import { resolveProcessoIdByCnj } from '../db/cerebro1-store.js';
import {
  buscarDocumentosExato,
  buscarDocumentosSemantico,
  contarDocumentosSemTexto,
  documentoPendenteDecisao,
  getDocumentoById,
  gravarConteudoDocumento,
  inserirDocumento,
  removerDocumento,
  setResumoDocumento,
} from '../db/documentos-store.js';
import { getEmbeddingsConfig } from '../../adapters/embeddings/config.js';
import { getOcrConfig } from '../../adapters/ocr/config.js';
import { createOcrAdapter } from '../../adapters/ocr/factory.js';
import { createEmbeddingsAdapter } from '../../adapters/embeddings/factory.js';
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
  let documentDecision: ((id: string, text: string) => Promise<string | null>) | undefined;
  let incomingDocument: ((id: string, message: InboundMessage) => Promise<string>) | undefined;

  if (llmCfg) {
    const llm = createLlmAdapter(llmCfg);
    // LLM classifica (com fallback determinístico) e responde ajuda/conversa geral.
    classifier = new LlmIntentClassifier(llm, keyword);
    overrides.ajuda = new LlmGeneralHandler('ajuda', llm);
    overrides.outro = new LlmGeneralHandler('outro', llm);
    // Cérebro 1 (dados do escritório) atende consulta_dados e agendar.
    const cerebro1 = new Cerebro1Handler({
      llm,
      store: supabaseCerebro1Store,
      pending: supabasePendingStore,
      clock: () => new Date(),
      logger: app.log,
      // Ficha do processo (Passo 15): agregação escopada por tenant, sem LLM.
      ficha: new FichaProcessoService({ store: supabaseFichaStore, clock: () => new Date() }),
      // Financeiro/honorários (Passo 16): parcelas escopadas por tenant.
      financeiro: supabaseFinanceiroStore,
    });
    overrides.consulta_dados = cerebro1;
    overrides.agendar = cerebro1;
    app.log.info(`LLM habilitado (${llmCfg.provider}/${llmCfg.model}) — Cérebro 1 ativo`);

    // Cérebro 2 (RAG jurídico) atende duvida_juridica — só com embeddings configurados.
    // O mesmo adapter alimenta a busca semântica de documentos (12B).
    const embCfg = getEmbeddingsConfig();
    const embeddings = embCfg ? createEmbeddingsAdapter(embCfg) : null;
    if (embCfg && embeddings) {
      overrides.duvida_juridica = new Cerebro2Handler({
        llm,
        embeddings,
        corpus: supabaseCorpusStore,
        minSimilarity: config.RAG_MIN_SIMILARITY,
        topK: config.RAG_TOP_K,
        logger: app.log,
      });
      app.log.info(`Embeddings habilitados (${embCfg.provider}/${embCfg.model}) — Cérebro 2 ativo`);
    } else {
      app.log.warn('Embeddings não configurados — Cérebro 2 (RAG) inativo (placeholder)');
    }

    // Documentos (Passo 12A): ler/resumir/guardar com chaves. Precisa do Storage
    // (service_role) p/ o ARQUIVO; "de quem é" continua 100% via tabela/RLS.
    if (config.SUPABASE_SERVICE_ROLE_KEY) {
      const docStore = {
        inserir: inserirDocumento,
        gravarConteudo: gravarConteudoDocumento,
        getById: getDocumentoById,
        pendenteDecisao: documentoPendenteDecisao,
        remover: removerDocumento,
      };
      // OCR local (Passo 13): 2ª tentativa p/ escaneado/imagem. Só se OCR_ENABLED.
      const ocrCfg = getOcrConfig();
      const ocr = ocrCfg ? createOcrAdapter(ocrCfg) : null;
      const docService = new DocumentoService({
        storage: supabaseStorage,
        store: docStore,
        llm,
        ...(embeddings ? { embeddings } : {}),
        ...(ocr && ocrCfg
          ? { ocr, ocrMinConfianca: ocrCfg.minConfianca, ocrMaxPaginas: ocrCfg.maxPaginas }
          : {}),
        maxBytes: config.DOCUMENTOS_MAX_MB * 1024 * 1024,
        resolveProcessoId: resolveProcessoIdByCnj,
        logger: app.log,
      });
      const docHandler = new DocumentHandler({ service: docService, store: docStore });
      documentDecision = (id, text) => docHandler.handleDecision(id, normalizeText(text));
      incomingDocument = async (id, message) => {
        const wcfg = getWhatsappConfig();
        const mediaId = message.media?.mediaId;
        if (!wcfg || !mediaId) {
          return '📎 Recebi seu arquivo, mas o canal de mídia ainda não está pronto. 🚧';
        }
        const midia = await new WhatsappMediaDownloader(wcfg).download(mediaId);
        return docHandler.handleIncoming(id, {
          bytes: midia.bytes,
          filename: message.media?.filename ?? midia.filename ?? 'arquivo',
          contentType: midia.contentType,
          legenda: message.text || null,
        });
      };
      app.log.info('Documentos (12A) ativos — leitura/resumo/guarda');

      // Busca de documentos (12B): intent `documento` por texto. Funciona só com
      // a busca exata; com embeddings, soma a semântica. Escopo por tenant na query.
      const buscaDocs = new BuscarDocumentos({
        store: {
          buscarExato: buscarDocumentosExato,
          buscarSemantico: buscarDocumentosSemantico,
          contarSemTexto: contarDocumentosSemTexto,
        },
        ...(embeddings ? { embeddings } : {}),
        topN: config.DOCUMENTOS_BUSCA_TOPN,
        minSimilarity: config.DOCUMENTOS_BUSCA_MIN_SIM,
        logger: app.log,
      });
      // Resumo de documento guardado (12C): resumo salvo (instantâneo) ou novo
      // relendo o Storage; posse re-verificada por tenant (getById) antes de reler.
      const resumoDocs = new ResumirDocumento({
        store: { getById: getDocumentoById, setResumo: setResumoDocumento },
        storage: supabaseStorage,
        llm,
        ...(ocr && ocrCfg
          ? { ocr, ocrMinConfianca: ocrCfg.minConfianca, ocrMaxPaginas: ocrCfg.maxPaginas }
          : {}),
        logger: app.log,
      });
      overrides.documento = new DocumentSearchHandler({
        busca: buscaDocs,
        resumo: resumoDocs,
        storage: supabaseStorage,
        urlTtlSec: config.DOCUMENTOS_URL_TTL_SEC,
      });
      app.log.info(
        `Documentos: busca (12B) ${embeddings ? 'exata + semântica' : 'só exata'} + resumo (12C)` +
          ` + OCR (13) ${ocr ? `ativo (${ocrCfg?.idioma})` : 'desligado'}`,
      );
    } else {
      app.log.warn('SUPABASE_SERVICE_ROLE_KEY ausente — documentos (12A) inativos (placeholder)');
    }
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
    // Documentos (Passo 12A): mídia recebida + resposta 1/2/3 (após o porteiro).
    ...(documentDecision ? { documentDecision } : {}),
    ...(incomingDocument ? { incomingDocument } : {}),
    // Memória de conversa (Passo 9): só interpreta a mensagem; nunca é fonte.
    memory: conversationMemoryStore,
    memoriaConfig: {
      enabled: config.CONVERSA_MEMORIA_ENABLED,
      turnos: config.CONVERSA_MEMORIA_TURNOS,
      ttlMin: config.CONVERSA_MEMORIA_TTL_MIN,
    },
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

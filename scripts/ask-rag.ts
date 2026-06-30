/**
 * Validação local do Cérebro 2 (RAG jurídico) SEM o WhatsApp.
 *
 * Modo simples: uma pergunta isolada (sem memória).
 *   npm run ask:rag -- "qual o prazo de contestação no CPC?"
 *
 * Modo conversa (testa a MEMÓRIA do Passo 9 — continuidade e mudança de assunto):
 * várias perguntas em sequência, compartilhando memória (em memória, sem banco),
 * pelo MESMO orquestrador/handler de produção.
 *   npm run ask:rag -- --conversa "qual o prazo de contestação no CPC?" "e o artigo seguinte?"
 *
 * Ambos rodam o pipeline real (embed → recuperar → gerar → validar citação →
 * recusar). A memória só INTERPRETA a pergunta; nunca é fonte. Requer SUPABASE_*,
 * DATABASE_URL, EMBEDDINGS_* e LLM_*. Rode a partir da raiz do projeto.
 */
import { requireEnv } from './_preflight.js';
import type { Intent } from '../src/core/domain/intents.js';
import type { HandlerRegistry, IntentHandler } from '../src/core/orchestration/handler.js';
import type {
  ConversationMemoryStore,
  ConversationTurn,
  StoredMemory,
} from '../src/core/ports/conversation-memory.js';
import type { ClassificationResult, IntentClassifier } from '../src/core/ports/intent-classifier.js';
import type { InteractionLogPort } from '../src/core/ports/interaction-log.js';

const argv = process.argv.slice(2);
const conversaMode = argv[0] === '--conversa';
const perguntas = conversaMode ? argv.slice(1) : [argv.join(' ').trim()].filter(Boolean);
if (perguntas.length === 0) {
  console.error('Uso: npm run ask:rag -- "pergunta"   |   --conversa "p1" "p2" ...');
  process.exit(1);
}

requireEnv(
  [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'DATABASE_URL',
    'EMBEDDINGS_PROVIDER',
    'EMBEDDINGS_MODEL',
    'EMBEDDINGS_API_KEY',
    'LLM_PROVIDER',
    'LLM_MODEL',
    'LLM_API_KEY',
  ],
  'a validação do RAG pela CLI (npm run ask:rag)',
);

const { supabaseCorpusStore } = await import('../src/adapters/corpus/supabase-corpus-store.js');
const { requireEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { requireLlmConfig } = await import('../src/adapters/llm/config.js');
const { createLlmAdapter } = await import('../src/adapters/llm/factory.js');
const { Cerebro2Handler } = await import('../src/application/cerebro2/cerebro2-handler.js');
const { Orchestrator } = await import('../src/application/orchestrator.js');
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const logger = {
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[erro]', msg ?? '', obj);
  },
};

const handler = new Cerebro2Handler({
  llm: createLlmAdapter(requireLlmConfig()),
  embeddings: createEmbeddingsAdapter(requireEmbeddingsConfig()),
  corpus: supabaseCorpusStore,
  minSimilarity: config.RAG_MIN_SIMILARITY,
  topK: config.RAG_TOP_K,
  logger,
});

function printResposta(pergunta: string, replyText: string): void {
  console.log(`\n❓ ${pergunta}`);
  console.log('─'.repeat(60));
  console.log(replyText);
  console.log('─'.repeat(60));
}

try {
  if (!conversaMode) {
    const result = await handler.handle({
      assinanteId: null,
      intent: 'duvida_juridica',
      message: { messageId: 'cli', from: 'cli', text: perguntas[0]!, timestamp: new Date().toISOString() },
    });
    printResposta(perguntas[0]!, result.replyText);
    const fontes = result.fontesCitadas ?? [];
    console.log(`\nCérebro: ${result.cerebro ?? '(nenhum)'}`);
    console.log(
      fontes.length > 0
        ? `Fontes citadas (validadas): ${fontes.join(' | ')}`
        : 'Fontes citadas (validadas): nenhuma (orientação geral ou recusa).',
    );
  } else {
    // Memória em memória (sem banco), exercitando o orquestrador real.
    const mem = new Map<string, { turnos: ConversationTurn[]; atualizadoEm: string }>();
    const memory: ConversationMemoryStore = {
      load: (id) =>
        Promise.resolve<StoredMemory>(mem.get(id) ?? { turnos: [], atualizadoEm: null }),
      save: (id, turnos) => {
        mem.set(id, { turnos, atualizadoEm: new Date().toISOString() });
        return Promise.resolve();
      },
      clear: (id) => {
        mem.delete(id);
        return Promise.resolve();
      },
    };
    // No modo conversa forçamos duvida_juridica (foco no RAG + memória).
    const classifier: IntentClassifier = {
      classify: (): Promise<ClassificationResult> =>
        Promise.resolve({
          intent: 'duvida_juridica',
          confidence: 1,
          candidates: ['duvida_juridica'],
          ambiguous: false,
        }),
    };
    const registry: HandlerRegistry = new Map<Intent, IntentHandler>([['duvida_juridica', handler]]);
    const interactionLog: InteractionLogPort = { record: () => Promise.resolve() };

    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve('cli-user'),
      classifier,
      registry,
      interactionLog,
      memory,
      memoriaConfig: {
        enabled: true,
        turnos: config.CONVERSA_MEMORIA_TURNOS,
        ttlMin: config.CONVERSA_MEMORIA_TTL_MIN,
      },
    });

    console.log('=== modo conversa (memória ativa entre as mensagens) ===');
    for (const p of perguntas) {
      const res = await orch.handleInboundMessage({
        messageId: 'cli',
        from: 'cli',
        text: p,
        timestamp: new Date().toISOString(),
      });
      printResposta(p, res.replyText);
    }
  }
} catch (err) {
  console.error('Falha na consulta ao RAG:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

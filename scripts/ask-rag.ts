/**
 * Validação local do Cérebro 2 (RAG jurídico) SEM o WhatsApp.
 *
 * Recebe uma pergunta em texto e roda EXATAMENTE o mesmo pipeline do handler de
 * produção (`Cerebro2Handler`): embed → recuperar no corpus → gerar (só do
 * recuperado) → validar citação → recusar. Não é uma cópia paralela do pipeline —
 * instancia o próprio handler com as mesmas dependências do servidor.
 *
 * USA LLM (redige) + embeddings (recupera) + banco. Requer SUPABASE_*, DATABASE_URL,
 * EMBEDDINGS_* e LLM_*. Uso (a partir da raiz do projeto):
 *   npm run ask:rag -- "qual o prazo de contestação no CPC?"
 */
import { requireEnv } from './_preflight.js';

const pergunta = process.argv.slice(2).join(' ').trim();
if (!pergunta) {
  console.error('Uso: npm run ask:rag -- "sua pergunta jurídica"');
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
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const logger = {
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[erro]', msg ?? '', obj);
  },
};

try {
  const handler = new Cerebro2Handler({
    llm: createLlmAdapter(requireLlmConfig()),
    embeddings: createEmbeddingsAdapter(requireEmbeddingsConfig()),
    corpus: supabaseCorpusStore,
    minSimilarity: config.RAG_MIN_SIMILARITY,
    logger,
  });

  const result = await handler.handle({
    assinanteId: null, // corpus é público; o handler não usa tenant aqui
    intent: 'duvida_juridica',
    message: { messageId: 'cli', from: 'cli', text: pergunta, timestamp: new Date().toISOString() },
  });

  console.log(`\nPergunta: ${pergunta}\n`);
  console.log('─'.repeat(60));
  console.log(result.replyText);
  console.log('─'.repeat(60));
  const fontes = result.fontesCitadas ?? [];
  console.log(`\nCérebro: ${result.cerebro ?? '(nenhum)'}`);
  console.log(
    fontes.length > 0
      ? `Fontes citadas (validadas): ${fontes.join(' | ')}`
      : 'Fontes citadas (validadas): nenhuma (orientação geral ou recusa).',
  );
} catch (err) {
  console.error('Falha na consulta ao RAG:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

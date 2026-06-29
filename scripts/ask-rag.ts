/**
 * Validação local do Cérebro 2 (RAG jurídico) SEM o WhatsApp.
 *
 * Recebe uma pergunta em texto e roda EXATAMENTE o mesmo pipeline do handler de
 * produção (`Cerebro2Handler`): embed → recuperar no corpus → gerar (só do
 * recuperado) → validar citação → recusar. Não é uma cópia paralela do pipeline
 * — instancia o próprio handler com as mesmas dependências do servidor.
 *
 * Requer LLM_*, EMBEDDINGS_* e DATABASE_URL no ambiente. Uso:
 *   npm run ask:rag -- "qual o prazo de contestação no CPC?"
 */
import { supabaseCorpusStore } from '../src/adapters/corpus/supabase-corpus-store.js';
import { requireEmbeddingsConfig } from '../src/adapters/embeddings/config.js';
import { createEmbeddingsAdapter } from '../src/adapters/embeddings/factory.js';
import { requireLlmConfig } from '../src/adapters/llm/config.js';
import { createLlmAdapter } from '../src/adapters/llm/factory.js';
import { Cerebro2Handler } from '../src/application/cerebro2/cerebro2-handler.js';
import { config } from '../src/infra/config/index.js';
import { closeDatabase } from '../src/infra/db/tenant.js';

const logger = {
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[erro]', msg ?? '', obj);
  },
};

async function main(): Promise<void> {
  const pergunta = process.argv.slice(2).join(' ').trim();
  if (!pergunta) {
    console.error('Uso: npm run ask:rag -- "sua pergunta jurídica"');
    process.exit(1);
    return;
  }

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
    message: {
      messageId: 'cli',
      from: 'cli',
      text: pergunta,
      timestamp: new Date().toISOString(),
    },
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
}

main()
  .catch((err) => {
    console.error('Falha na consulta ao RAG:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => {});
  });

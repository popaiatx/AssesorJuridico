/**
 * Ingestão inicial do corpus jurídico (back-office, passo de OPS).
 *
 * É o MESMO motor da sincronização (`syncCorpus`), aqui com `force` (reconstrói:
 * re-chunk + re-embed de todas as normas do manifesto, mesmo sem mudança). Idempotente
 * por identificador. Para a manutenção contínua (incremental), use `npm run sync:corpus`.
 *
 * NÃO usa LLM (só embeddings + banco). Requer SUPABASE_*, DATABASE_URL e EMBEDDINGS_*.
 * Uso (a partir da raiz do projeto):
 *   npm run ingest:corpus
 */
import { requireEnv } from './_preflight.js';

requireEnv(
  [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'DATABASE_URL',
    'EMBEDDINGS_PROVIDER',
    'EMBEDDINGS_MODEL',
    'EMBEDDINGS_API_KEY',
  ],
  'a ingestão do corpus (npm run ingest:corpus)',
);

// Imports dinâmicos APÓS o preflight: assim a mensagem clara aparece antes de o
// `config` (fail-fast) ser carregado pelas dependências.
const { supabaseCorpusSyncStore } = await import('../src/adapters/corpus/supabase-corpus-sync-store.js');
const { requireEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { PlanaltoLegislacaoSource } = await import('../src/adapters/source/legislacao/planalto-source.js');
const { syncCorpus } = await import('../src/application/cerebro2/sync-corpus.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const logger = {
  info(obj: Record<string, unknown>, msg?: string): void {
    console.log('[ingest]', msg ?? '', JSON.stringify(obj));
  },
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[ingest][erro]', msg ?? '', JSON.stringify(obj));
  },
};

try {
  const source = new PlanaltoLegislacaoSource();
  const embeddings = createEmbeddingsAdapter(requireEmbeddingsConfig());
  const result = await syncCorpus(
    { source, embeddings, store: supabaseCorpusSyncStore, logger },
    { force: true },
  );
  console.log(
    `\nIngestão (${result.status}): verificadas=${result.normasVerificadas} ` +
      `atualizadas=${result.normasAtualizadas} revogadas=${result.normasRevogadas} ` +
      `avisos/erros=${result.erros.length}`,
  );
  for (const e of result.erros) console.log(`  • ${e.identificador}: ${e.erro}`);
} catch (err) {
  console.error('Falha na ingestão:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

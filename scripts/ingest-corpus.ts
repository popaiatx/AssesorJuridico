/**
 * Ingestão inicial do corpus jurídico (back-office, passo de OPS).
 *
 * É o MESMO motor da sincronização (`syncCorpus`), aqui com `force` (reconstrói:
 * re-chunk + re-embed de todas as normas do manifesto, mesmo sem mudança). Idempotente
 * por identificador. Para a manutenção contínua (incremental), use `npm run sync:corpus`.
 *
 * Requer EMBEDDINGS_* e DATABASE_URL. Uso:
 *   npm run ingest:corpus
 */
import { supabaseCorpusSyncStore } from '../src/adapters/corpus/supabase-corpus-sync-store.js';
import { requireEmbeddingsConfig } from '../src/adapters/embeddings/config.js';
import { createEmbeddingsAdapter } from '../src/adapters/embeddings/factory.js';
import { PlanaltoLegislacaoSource } from '../src/adapters/source/legislacao/planalto-source.js';
import { syncCorpus } from '../src/application/cerebro2/sync-corpus.js';
import { closeDatabase } from '../src/infra/db/tenant.js';

const logger = {
  info(obj: Record<string, unknown>, msg?: string): void {
    console.log('[ingest]', msg ?? '', JSON.stringify(obj));
  },
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[ingest][erro]', msg ?? '', JSON.stringify(obj));
  },
};

async function main(): Promise<void> {
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
}

main()
  .catch((err) => {
    console.error('Falha na ingestão:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => {});
  });

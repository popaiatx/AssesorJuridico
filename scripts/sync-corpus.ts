/**
 * Sincronização do corpus jurídico (back-office, passo de OPS / Railway Cron).
 *
 * Mantém o corpus local fresco a partir da fonte oficial (Planalto), detectando
 * normas novas/alteradas/revogadas e re-embedando só o que mudou. É o MESMO motor
 * da ingestão (`syncCorpus`); aqui sem `force` (sync incremental). Serializado por
 * advisory lock (não roda concorrente). Back-office: escreve via pool, sem
 * service_role; o caminho de mensagem do assinante não é afetado.
 *
 * Requer EMBEDDINGS_* e DATABASE_URL. Uso:
 *   npm run sync:corpus                          # todas as normas do manifesto
 *   npm run sync:corpus -- --norma "Lei nº 8.078/1990"   # só uma
 *   npm run sync:corpus -- --force               # re-embeda tudo (reconstrução)
 *
 * Railway: configure um Cron Job SEMANAL com o comando `npm run sync:corpus`,
 * como serviço/processo SEPARADO do web server.
 */
import { supabaseCorpusSyncStore } from '../src/adapters/corpus/supabase-corpus-sync-store.js';
import { requireEmbeddingsConfig } from '../src/adapters/embeddings/config.js';
import { createEmbeddingsAdapter } from '../src/adapters/embeddings/factory.js';
import { PlanaltoLegislacaoSource } from '../src/adapters/source/legislacao/planalto-source.js';
import { syncCorpus, type SyncCorpusOptions } from '../src/application/cerebro2/sync-corpus.js';
import { withSyncLock } from '../src/infra/db/corpus-store.js';
import { closeDatabase } from '../src/infra/db/tenant.js';

const logger = {
  info(obj: Record<string, unknown>, msg?: string): void {
    console.log('[sync]', msg ?? '', JSON.stringify(obj));
  },
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[sync][erro]', msg ?? '', JSON.stringify(obj));
  },
};

function parseArgs(argv: string[]): SyncCorpusOptions {
  const opts: SyncCorpusOptions = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') opts.force = true;
    else if (argv[i] === '--norma') opts.identificador = argv[++i];
  }
  return opts;
}

async function main(): Promise<void> {
  if (process.env.CORPUS_SYNC_ENABLED === 'false') {
    console.log('CORPUS_SYNC_ENABLED=false — sync desativado; nada a fazer.');
    return;
  }

  const opts = parseArgs(process.argv.slice(2));
  const source = new PlanaltoLegislacaoSource();
  const embeddings = createEmbeddingsAdapter(requireEmbeddingsConfig());

  const result = await withSyncLock(() =>
    syncCorpus({ source, embeddings, store: supabaseCorpusSyncStore, logger }, opts),
  );

  if (result === null) {
    console.log('Outra sincronização já está em andamento — nada a fazer.');
    return;
  }

  console.log(
    `\nSync (${result.status}): verificadas=${result.normasVerificadas} ` +
      `atualizadas=${result.normasAtualizadas} revogadas=${result.normasRevogadas} ` +
      `avisos/erros=${result.erros.length}`,
  );
  for (const e of result.erros) console.log(`  • ${e.identificador}: ${e.erro}`);
}

main()
  .catch((err) => {
    console.error('Falha na sincronização:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => {});
  });

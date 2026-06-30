/**
 * Sincronização do corpus jurídico (back-office, passo de OPS / Railway Cron).
 *
 * Mantém o corpus local fresco a partir da fonte oficial (Planalto), detectando
 * normas novas/alteradas/revogadas e re-embedando só o que mudou. É o MESMO motor
 * da ingestão (`syncCorpus`); aqui sem `force` (sync incremental). Serializado por
 * advisory lock (não roda concorrente). Back-office: escreve via pool, sem
 * service_role; o caminho de mensagem do assinante não é afetado.
 *
 * NÃO usa LLM (só embeddings + banco). Requer SUPABASE_*, DATABASE_URL e EMBEDDINGS_*.
 * Uso (a partir da raiz do projeto):
 *   npm run sync:corpus                                  # todas as normas do manifesto
 *   npm run sync:corpus -- --norma "Lei nº 8.078/1990"   # só uma
 *   npm run sync:corpus -- --force                       # re-embeda tudo (reconstrução)
 *
 * Railway: configure um Cron Job SEMANAL com `npm run sync:corpus`, como serviço/
 * processo SEPARADO do web server.
 */
import { requireEnv } from './_preflight.js';

if (process.env.CORPUS_SYNC_ENABLED === 'false') {
  console.log('CORPUS_SYNC_ENABLED=false — sync desativado; nada a fazer.');
  process.exit(0);
}

requireEnv(
  [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'DATABASE_URL',
    'EMBEDDINGS_PROVIDER',
    'EMBEDDINGS_MODEL',
    'EMBEDDINGS_API_KEY',
  ],
  'a sincronização do corpus (npm run sync:corpus)',
);

const { supabaseCorpusSyncStore } = await import('../src/adapters/corpus/supabase-corpus-sync-store.js');
const { requireEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { PlanaltoLegislacaoSource } = await import('../src/adapters/source/legislacao/planalto-source.js');
const { syncCorpus } = await import('../src/application/cerebro2/sync-corpus.js');
const { withSyncLock } = await import('../src/infra/db/corpus-store.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const logger = {
  info(obj: Record<string, unknown>, msg?: string): void {
    console.log('[sync]', msg ?? '', JSON.stringify(obj));
  },
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[sync][erro]', msg ?? '', JSON.stringify(obj));
  },
};

function parseArgs(argv: string[]): { force?: boolean; identificador?: string } {
  const opts: { force?: boolean; identificador?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') opts.force = true;
    else if (argv[i] === '--norma') opts.identificador = argv[++i];
  }
  return opts;
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const source = new PlanaltoLegislacaoSource();
  const embeddings = createEmbeddingsAdapter(requireEmbeddingsConfig());

  const result = await withSyncLock(() =>
    syncCorpus({ source, embeddings, store: supabaseCorpusSyncStore, logger }, opts),
  );

  if (result === null) {
    console.log('Outra sincronização já está em andamento — nada a fazer.');
  } else {
    console.log(
      `\nSync (${result.status}): verificadas=${result.normasVerificadas} ` +
        `atualizadas=${result.normasAtualizadas} revogadas=${result.normasRevogadas} ` +
        `avisos/erros=${result.erros.length}`,
    );
    for (const e of result.erros) console.log(`  • ${e.identificador}: ${e.erro}`);
  }
} catch (err) {
  console.error('Falha na sincronização:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

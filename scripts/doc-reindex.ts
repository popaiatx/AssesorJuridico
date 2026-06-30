/**
 * BACKFILL de embeddings de documentos (Passo 12B) — gera o vetor semântico dos
 * documentos que já tinham texto (extracao_status='ok', busca_texto preenchido)
 * mas ainda não têm embedding. Idempotente: roda quantas vezes quiser; só toca
 * em quem está com embedding NULL. Documento escaneado (sem_texto) é ignorado.
 *
 * É BACK-OFFICE: usa o pool direto (não o caminho de mensagem de um assinante).
 * NÃO recebe assinante_id de fora — varre o acervo inteiro pelo critério acima e
 * grava o embedding do PRÓPRIO documento; nada cruza tenants (cada vetor vem do
 * busca_texto daquele documento). Requer EMBEDDINGS_* e DATABASE_URL. Uso (raiz):
 *   npm run doc:reindex            # processa em lotes até esvaziar
 *   npm run doc:reindex -- --lote 50
 */
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const lote = Math.max(1, Math.min(200, Number(flag('--lote') ?? 25)));

requireEnv(
  ['DATABASE_URL', 'EMBEDDINGS_PROVIDER', 'EMBEDDINGS_MODEL', 'EMBEDDINGS_API_KEY'],
  'o backfill de embeddings de documentos (npm run doc:reindex)',
);

const { requireEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { listarDocumentosSemEmbedding, setDocumentoEmbedding } = await import(
  '../src/infra/db/documentos-store.js'
);
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const embeddings = createEmbeddingsAdapter(requireEmbeddingsConfig());

let total = 0;
let falhas = 0;
try {
  for (;;) {
    const pendentes = await listarDocumentosSemEmbedding(lote);
    if (pendentes.length === 0) break;
    console.log(`Processando lote de ${pendentes.length}...`);
    for (const doc of pendentes) {
      try {
        const [vetor] = await embeddings.embed([doc.buscaTexto]);
        if (!vetor) throw new Error('embedding vazio');
        await setDocumentoEmbedding(doc.id, vetor);
        total++;
      } catch (err) {
        falhas++;
        console.error(`  [falha] doc ${doc.id}:`, err instanceof Error ? err.message : err);
      }
    }
    // Se o lote inteiro falhou (ex.: API fora), para para não girar em vão.
    if (total === 0 && falhas >= pendentes.length) {
      console.error('Lote inteiro falhou — abortando para evitar loop.');
      process.exitCode = 1;
      break;
    }
  }
  console.log(`\nConcluído: ${total} embedding(s) gravados${falhas ? `, ${falhas} falha(s)` : ''}.`);
} catch (err) {
  console.error('Falha no backfill:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

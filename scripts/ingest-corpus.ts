/**
 * Ingestão do corpus jurídico (back-office, passo de OPS).
 *
 * Para cada norma do manifesto: baixa o texto oficial → chunkLegislacao (por
 * artigo) → embed (em lotes) → grava em corpus_normas/corpus_trechos. Idempotente
 * por identificador (reingestão substitui os trechos). Source-agnostic.
 *
 * Requer EMBEDDINGS_* e DATABASE_URL no ambiente. Uso:
 *   npm run ingest:corpus
 */
import { requireEmbeddingsConfig } from '../src/adapters/embeddings/config.js';
import { createEmbeddingsAdapter } from '../src/adapters/embeddings/factory.js';
import { chunkLegislacao } from '../src/core/domain/cerebro2/chunk-legislacao.js';
import { deleteTrechos, insertTrecho, upsertNorma } from '../src/infra/db/corpus-store.js';
import { closeDatabase } from '../src/infra/db/tenant.js';
import { CORPUS_MANIFEST } from './corpus-manifest.js';

const BATCH = 64;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function fetchTexto(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  return htmlToText(await res.text());
}

async function main(): Promise<void> {
  const embeddings = createEmbeddingsAdapter(requireEmbeddingsConfig());

  for (const item of CORPUS_MANIFEST) {
    console.log(`\n→ ${item.identificador} (${item.sigla})`);
    const texto = await fetchTexto(item.fonteUrl);
    const chunks = chunkLegislacao(texto, {
      sigla: item.sigla,
      identificador: item.identificador,
      fonteUrl: item.fonteUrl,
    });
    if (chunks.length === 0) {
      console.warn('  0 trechos — verifique a URL/parser; pulando.');
      continue;
    }

    const normaId = await upsertNorma({
      tipo: 'legislacao',
      titulo: item.titulo,
      identificador: item.identificador,
      dataPublicacao: item.dataPublicacao ?? null,
      vigenciaStatus: 'vigente',
      fonteUrl: item.fonteUrl,
    });
    await deleteTrechos(normaId);

    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const vectors = await embeddings.embed(slice.map((c) => c.texto));
      for (let j = 0; j < slice.length; j++) {
        const c = slice[j]!;
        await insertTrecho(normaId, {
          artigo: c.artigo,
          paragrafo: c.paragrafo,
          inciso: c.inciso,
          ordem: c.ordem,
          texto: c.texto,
          citacao: c.citacao,
          fonteUrl: item.fonteUrl,
          embedding: vectors[j]!,
        });
      }
      console.log(`  ${Math.min(i + BATCH, chunks.length)}/${chunks.length} trechos`);
    }
  }

  console.log('\nIngestão concluída.');
  await closeDatabase();
}

main().catch(async (err) => {
  console.error('Falha na ingestão:', err);
  await closeDatabase().catch(() => {});
  process.exit(1);
});

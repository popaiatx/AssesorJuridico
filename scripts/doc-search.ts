/**
 * Busca documentos pelo MESMO caminho do produto (Passo 12B), SEM o WhatsApp —
 * para validar a busca e o ISOLAMENTO por assinante antes do chip. Resolve o
 * assinante pelo TELEFONE (identidade) e roda o handler real (busca exata +
 * semântica, escopadas por tenant; URL assinada só do dono).
 *
 * Requer SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY (URL assinada) e DATABASE_URL.
 * EMBEDDINGS_* é opcional (sem ele, só a busca exata). Uso (raiz do projeto):
 *   npm run doc:search -- --telefone 5511999990001 "contrato de aluguel do João"
 *
 * Teste de isolamento: rode com o telefone de A e depois de B e confira que cada
 * um só vê os próprios documentos (a referência de um nunca traz o do outro).
 */
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const telefone = flag('--telefone');
const positionais: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i]!.startsWith('--')) i++;
  else positionais.push(argv[i]!);
}
const referencia = positionais.join(' ').trim();

if (!telefone || !referencia) {
  console.error('Uso: npm run doc:search -- --telefone <telefone> "<referência>"');
  process.exit(1);
}

requireEnv(
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'],
  'a busca de documentos (npm run doc:search)',
);

const { resolveAssinanteByPhone } = await import('../src/infra/db/identity.js');
const { supabaseStorage } = await import('../src/adapters/storage/supabase-storage.js');
const docsStore = await import('../src/infra/db/documentos-store.js');
const { getEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { BuscarDocumentos } = await import('../src/application/documentos/buscar-documentos.js');
const { DocumentSearchHandler } = await import('../src/application/documentos/document-search-handler.js');
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

try {
  const assinanteId = await resolveAssinanteByPhone(telefone);
  if (!assinanteId) {
    console.error(`Telefone ${telefone} não tem assinante. Rode antes: npm run seed:assinante -- ${telefone}`);
    process.exitCode = 1;
  } else {
    const embCfg = getEmbeddingsConfig();
    const busca = new BuscarDocumentos({
      store: {
        buscarExato: docsStore.buscarDocumentosExato,
        buscarSemantico: docsStore.buscarDocumentosSemantico,
        contarSemTexto: docsStore.contarDocumentosSemTexto,
      },
      ...(embCfg ? { embeddings: createEmbeddingsAdapter(embCfg) } : {}),
      topN: config.DOCUMENTOS_BUSCA_TOPN,
      minSimilarity: config.DOCUMENTOS_BUSCA_MIN_SIM,
      logger: { error: (o, m) => console.error('[busca][erro]', m ?? '', o) },
    });
    const handler = new DocumentSearchHandler({
      busca,
      storage: supabaseStorage,
      urlTtlSec: config.DOCUMENTOS_URL_TTL_SEC,
    });

    console.log(
      `\nBuscando "${referencia}" para o assinante ${assinanteId} ` +
        `(${embCfg ? 'exata + semântica' : 'só exata'})...\n`,
    );
    const r = await handler.handle({
      assinanteId,
      intent: 'documento',
      message: { messageId: 'cli', from: telefone, text: referencia, timestamp: new Date().toISOString() },
    });
    console.log('─'.repeat(60));
    console.log(r.replyText);
    console.log('─'.repeat(60));
  }
} catch (err) {
  console.error('Falha na busca:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

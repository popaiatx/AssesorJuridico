/**
 * Resume um documento JÁ GUARDADO pelo MESMO caminho do produto (Passo 12C), SEM
 * o WhatsApp. Resolve o assinante pelo TELEFONE (identidade), localiza o documento
 * pela referência (busca 12B, escopada por tenant) e resume:
 *   --modo guardado (default) = usa o resumo salvo (ou gera+persiste se faltar)
 *   --modo novo | --foco "…"  = gera um resumo novo relendo o Storage (não persiste)
 *
 * Isolamento: o documento é resolvido só entre os do próprio assinante; a releitura
 * do Storage só acontece após getById confirmar a posse (RLS). Uso (raiz):
 *   npm run doc:summary -- --telefone 5511999990001 "contrato de aluguel"
 *   npm run doc:summary -- --telefone 5511999990001 "contrato" --modo novo --foco "prazos"
 *
 * (Ordinais como "resume o segundo" dependem da memória entre turnos do WhatsApp;
 *  aqui a referência é por nome/número — cobertos por testes unitários.)
 */
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const telefone = flag('--telefone');
const modo = (flag('--modo') ?? 'guardado') as 'guardado' | 'novo';
const foco = flag('--foco');
const positionais: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i]!.startsWith('--')) i++;
  else positionais.push(argv[i]!);
}
const referencia = positionais.join(' ').trim();

if (!telefone || !referencia || !['guardado', 'novo'].includes(modo)) {
  console.error('Uso: npm run doc:summary -- --telefone <tel> "<referência>" [--modo guardado|novo] [--foco "..."]');
  process.exit(1);
}

requireEnv(
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY'],
  'o resumo de documento (npm run doc:summary)',
);

const { resolveAssinanteByPhone } = await import('../src/infra/db/identity.js');
const { supabaseStorage } = await import('../src/adapters/storage/supabase-storage.js');
const docsStore = await import('../src/infra/db/documentos-store.js');
const { requireLlmConfig } = await import('../src/adapters/llm/config.js');
const { createLlmAdapter } = await import('../src/adapters/llm/factory.js');
const { getEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { getOcrConfig } = await import('../src/adapters/ocr/config.js');
const { createOcrAdapter } = await import('../src/adapters/ocr/factory.js');
const { BuscarDocumentos } = await import('../src/application/documentos/buscar-documentos.js');
const { ResumirDocumento } = await import('../src/application/documentos/resumir-documento.js');
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const ocrCfg = getOcrConfig();
const ocr = ocrCfg ? createOcrAdapter(ocrCfg) : null;

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
    const resumo = new ResumirDocumento({
      store: { getById: docsStore.getDocumentoById, setResumo: docsStore.setResumoDocumento },
      storage: supabaseStorage,
      llm: createLlmAdapter(requireLlmConfig()),
      ...(ocr && ocrCfg ? { ocr, ocrMinConfianca: ocrCfg.minConfianca, ocrMaxPaginas: ocrCfg.maxPaginas } : {}),
      logger: { error: (o, m) => console.error('[resumo][erro]', m ?? '', o) },
    });

    console.log(`\nResumindo "${referencia}" (modo ${modo}${foco ? `, foco "${foco}"` : ''}) para ${assinanteId}...\n`);
    const { documentos } = await busca.buscar(assinanteId, referencia);
    if (documentos.length === 0) {
      console.log('Não achei nenhum documento com essa referência para resumir.');
    } else if (documentos.length > 1) {
      console.log(`Achei ${documentos.length} documentos — refine a referência:`);
      documentos.forEach((d, i) => console.log(`  ${i + 1}. ${d.nome}`));
    } else {
      const pedido = foco ? { modo, foco } : { modo };
      const texto = await resumo.resumirPorId(assinanteId, documentos[0]!.id, pedido);
      console.log('─'.repeat(60));
      console.log(texto);
      console.log('─'.repeat(60));
    }
  }
} catch (err) {
  console.error('Falha ao resumir:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  if (ocr) await ocr.terminar().catch(() => {});
  await closeDatabase().catch(() => {});
}

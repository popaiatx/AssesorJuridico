/**
 * Re-OCR dos documentos "ponto cego" (Passo 13) — reprocessa com OCR os que estão
 * como `sem_texto`, gerando chaves/resumo/embedding e tirando-os do ponto cego.
 * Idempotente: só mexe em `sem_texto` (vira ok_ocr e não é reprocessado de novo).
 *
 * Roda OFFLINE (não trava a conversa), então pode ler MAIS páginas por documento
 * que o fluxo síncrono: use --max-paginas (default 30) para contratos longos.
 * É BACK-OFFICE, mas o re-OCR de cada documento é ESCOPADO POR TENANT: o serviço
 * confirma a posse (getById) antes de baixar do Storage — nunca toca arquivo alheio.
 *
 * Requer SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, LLM_*, OCR_ENABLED.
 * EMBEDDINGS_* é opcional (sem ele, gera chaves/resumo mas sem embedding). Uso:
 *   npm run doc:ocr                       # todos os sem_texto (lote padrão)
 *   npm run doc:ocr -- --telefone 5511999990001   # só de um assinante
 *   npm run doc:ocr -- --max-paginas 50 --lote 100
 */
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const telefone = flag('--telefone');
const lote = Math.max(1, Math.min(500, Number(flag('--lote') ?? 50)));
const maxPaginas = Math.max(1, Math.min(500, Number(flag('--max-paginas') ?? 30)));

requireEnv(
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY'],
  'o re-OCR de documentos (npm run doc:ocr)',
);

const { resolveAssinanteByPhone } = await import('../src/infra/db/identity.js');
const { resolveProcessoIdByCnj } = await import('../src/infra/db/cerebro1-store.js');
const { supabaseStorage } = await import('../src/adapters/storage/supabase-storage.js');
const docsStore = await import('../src/infra/db/documentos-store.js');
const { requireLlmConfig } = await import('../src/adapters/llm/config.js');
const { createLlmAdapter } = await import('../src/adapters/llm/factory.js');
const { getEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { getOcrConfig } = await import('../src/adapters/ocr/config.js');
const { createOcrAdapter } = await import('../src/adapters/ocr/factory.js');
const { DocumentoService } = await import('../src/application/documentos/documento-service.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const ocrCfg = getOcrConfig();
if (!ocrCfg) {
  console.error('OCR desabilitado (OCR_ENABLED=false). Ative para reprocessar.');
  process.exit(1);
}
const ocr = createOcrAdapter(ocrCfg);
const embCfg = getEmbeddingsConfig();

const service = new DocumentoService({
  storage: supabaseStorage,
  store: {
    inserir: docsStore.inserirDocumento,
    gravarConteudo: docsStore.gravarConteudoDocumento,
    getById: docsStore.getDocumentoById,
    pendenteDecisao: docsStore.documentoPendenteDecisao,
    remover: docsStore.removerDocumento,
  },
  llm: createLlmAdapter(requireLlmConfig()),
  ...(embCfg ? { embeddings: createEmbeddingsAdapter(embCfg) } : {}),
  ocr,
  ocrMinConfianca: ocrCfg.minConfianca,
  ocrMaxPaginas: maxPaginas, // offline: pode ler mais páginas que o fluxo síncrono
  resolveProcessoId: resolveProcessoIdByCnj,
  logger: { error: (o, m) => console.error('[re-ocr][erro]', m ?? '', o) },
});

let assinanteFiltro: string | undefined;
try {
  if (telefone) {
    const id = await resolveAssinanteByPhone(telefone);
    if (!id) {
      console.error(`Telefone ${telefone} não tem assinante.`);
      process.exit(1);
    }
    assinanteFiltro = id;
  }

  const pendentes = await docsStore.listarDocumentosSemTexto(lote, assinanteFiltro);
  console.log(`\n${pendentes.length} documento(s) sem_texto para reprocessar (max ${maxPaginas} pág/doc)...\n`);
  let ok = 0;
  let ainda = 0;
  for (const d of pendentes) {
    const r = await service.reprocessarOcr(d.assinanteId, d.id, maxPaginas);
    if (r.ok) {
      ok++;
      console.log(`  ✅ ${d.nome} → ${r.status}`);
    } else {
      if (r.status === 'sem_texto') ainda++;
      console.log(`  ▫️  ${d.nome} → ${r.status} (${r.mensagem})`);
    }
  }
  console.log(`\nConcluído: ${ok} recuperado(s) por OCR${ainda ? `, ${ainda} seguem sem texto legível` : ''}.`);
} catch (err) {
  console.error('Falha no re-OCR:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await ocr.terminar().catch(() => {});
  await closeDatabase().catch(() => {});
}

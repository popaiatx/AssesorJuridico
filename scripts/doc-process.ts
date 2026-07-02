/**
 * Processa um DOCUMENTO local pelo MESMO caminho do produto (Passo 12A), SEM o
 * WhatsApp — para validar extração/resumo/guarda e o isolamento antes do chip.
 *
 * Roda o serviço real contra Storage (bucket privado) + DB. Requer SUPABASE_*,
 * SUPABASE_SERVICE_ROLE_KEY (Storage), DATABASE_URL e LLM_*. Uso (raiz do projeto):
 *   npm run doc:process -- <arquivo> --telefone 5511999990001 [--acao ambos] [--processo <CNJ>]
 *
 * --acao: resumir | salvar | ambos (default: ambos). O bucket "documentos" precisa
 * existir (privado) no Supabase. O download da mídia do WhatsApp fica para o chip.
 *
 * --responder "<texto>" (Passo 18): simula o TURNO SEGUINTE pelo MESMO caminho da
 * interceptação do produto (handleDecision) — para validar a sugestão de pasta
 * ("sim" vincula, "não" mantém avulso, número resolve a desambiguação) sem chip.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
// Positional = arquivo (pula cada flag e o seu valor).
const positionais: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i]!.startsWith('--')) i++;
  else positionais.push(argv[i]!);
}
const arquivo = positionais[0];
const acaoArg = (flag('--acao') ?? 'ambos') as 'resumir' | 'salvar' | 'ambos';
const telefone = flag('--telefone');
const processo = flag('--processo') ?? null;
const responder = flag('--responder') ?? null;

if (!arquivo || !telefone || !['resumir', 'salvar', 'ambos'].includes(acaoArg)) {
  console.error('Uso: npm run doc:process -- <arquivo> --telefone <telefone> [--acao resumir|salvar|ambos] [--processo <CNJ>]');
  process.exit(1);
}

requireEnv(
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY'],
  'o processamento de documento (npm run doc:process)',
);

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.csv': 'text/csv',
};

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
const { DocumentHandler } = await import('../src/application/documentos/document-handler.js');
const { supabaseDocumentoPastaStore } = await import('../src/adapters/documentos/supabase-pasta-store.js');
const { supabasePendingStore } = await import('../src/adapters/cerebro1/supabase-cerebro1-store.js');
const { normalizeText } = await import('../src/core/domain/validators.js');
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

const ocrCfg = getOcrConfig();
const ocr = ocrCfg ? createOcrAdapter(ocrCfg) : null;

try {
  const assinanteId = await resolveAssinanteByPhone(telefone!);
  if (!assinanteId) {
    console.error(`Telefone ${telefone} não tem assinante. Rode antes: npm run seed:assinante -- ${telefone}`);
    process.exitCode = 1;
  } else {
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
      ...(ocr && ocrCfg ? { ocr, ocrMinConfianca: ocrCfg.minConfianca, ocrMaxPaginas: ocrCfg.maxPaginas } : {}),
      maxBytes: config.DOCUMENTOS_MAX_MB * 1024 * 1024,
      resolveProcessoId: resolveProcessoIdByCnj,
      pastas: { store: supabaseDocumentoPastaStore, pending: supabasePendingStore },
      logger: { error: (o, m) => console.error('[doc][erro]', m ?? '', o) },
    });

    const bytes = new Uint8Array(readFileSync(arquivo!));
    const nome = basename(arquivo!);
    const contentType = CONTENT_TYPES[extname(arquivo!).toLowerCase()] ?? null;

    console.log(`\nProcessando "${nome}" (${acaoArg}) para o assinante ${assinanteId}...\n`);
    const reply = await service.processarComAcao(
      assinanteId,
      { bytes, filename: nome, contentType, legenda: null, numeroCnj: processo },
      acaoArg,
    );
    console.log('─'.repeat(60));
    console.log(reply);
    console.log('─'.repeat(60));

    if (responder) {
      // Turno seguinte pelo MESMO caminho do produto (interceptação pré-classificação).
      const handler = new DocumentHandler({
        service,
        store: {
          inserir: docsStore.inserirDocumento,
          gravarConteudo: docsStore.gravarConteudoDocumento,
          getById: docsStore.getDocumentoById,
          pendenteDecisao: docsStore.documentoPendenteDecisao,
          remover: docsStore.removerDocumento,
        },
        pending: supabasePendingStore,
      });
      console.log(`\n👤 Você: ${responder}`);
      const r2 = await handler.handleDecision(assinanteId, normalizeText(responder));
      console.log(`🤖 estagiárIA: ${r2 ?? '(sem pendência — a mensagem seguiria o fluxo normal)'}`);
    }
  }
} catch (err) {
  // Mensagem limpa (não despeja stack): erros conhecidos já vêm explicados.
  console.error('Falha ao processar documento:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  if (ocr) await ocr.terminar().catch(() => {}); // encerra o worker de OCR (senão trava a saída)
  await closeDatabase().catch(() => {});
}

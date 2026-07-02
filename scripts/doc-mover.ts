/**
 * Move um documento entre PASTAS (Passo 18) pelo caminho real, sem WhatsApp:
 * resolve o documento pela referência (busca 12B, escopada), o processo destino
 * pelo seletor do Passo 15, e move via serviço real (posse de doc E processo
 * re-verificadas; nada é reprocessado — só o vínculo muda). Uso (raiz):
 *   npm run doc:mover -- --telefone <tel> "<doc>" --para "<nº/trecho ou cliente>"
 *   npm run doc:mover -- --telefone <tel> "<doc>" --avulso
 */
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const telefone = flag('--telefone');
const para = flag('--para');
const avulso = argv.includes('--avulso');
const positionais: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--avulso') continue;
  if (argv[i]!.startsWith('--')) i++;
  else positionais.push(argv[i]!);
}
const referencia = positionais.join(' ').trim();

if (!telefone || !referencia || (!para && !avulso) || (para && avulso)) {
  console.error('Uso: npm run doc:mover -- --telefone <tel> "<doc>" (--para "<processo>" | --avulso)');
  process.exit(1);
}

requireEnv(
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'],
  'o mover de documento (npm run doc:mover)',
);

const { resolveAssinanteByPhone } = await import('../src/infra/db/identity.js');
const docsStore = await import('../src/infra/db/documentos-store.js');
const { findProcessos } = await import('../src/infra/db/cerebro1-store.js');
const { BuscarDocumentos } = await import('../src/application/documentos/buscar-documentos.js');
const { getEmbeddingsConfig } = await import('../src/adapters/embeddings/config.js');
const { createEmbeddingsAdapter } = await import('../src/adapters/embeddings/factory.js');
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

function selectorDe(ref: string) {
  const digits = ref.replace(/\D/g, '');
  const soNumeros = /^[\d\s./-]+$/.test(ref);
  if (soNumeros && digits.length === 20) return { numeroCnj: digits };
  if (soNumeros && digits.length >= 4) return { numeroFragmento: digits };
  return { clienteNome: ref };
}

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
    let { documentos } = await busca.buscar(assinanteId, referencia);
    // Vários? Se a referência é o NOME exato de um deles, é ele (CLI pragmática).
    if (documentos.length > 1) {
      const exato = documentos.filter((d) => d.nome.toLowerCase() === referencia.toLowerCase());
      if (exato.length === 1) documentos = exato;
    }
    if (documentos.length !== 1) {
      if (documentos.length === 0) console.log('Não achei nenhum documento com essa referência.');
      else {
        console.log(`Achei ${documentos.length} — refine a referência:`);
        documentos.forEach((d, i) => console.log(`  ${i + 1}. ${d.nome}`));
      }
    } else {
      const doc = documentos[0]!;
      let processoId: string | null = null;
      let rotulo = '📂 avulso';
      if (para) {
        const procs = await findProcessos(assinanteId, selectorDe(para));
        if (procs.length !== 1) {
          console.log(procs.length === 0 ? 'Processo destino não encontrado no acervo.' : 'Mais de um processo — use o número completo.');
          throw new Error('destino ambíguo/inexistente');
        }
        processoId = procs[0]!.id;
        rotulo = `📁 processo ${procs[0]!.numeroCnj ?? ''}${procs[0]!.clienteNome ? ` (${procs[0]!.clienteNome})` : ''}`;
      }
      const ok = await docsStore.setDocumentoProcessoId(assinanteId, doc.id, processoId);
      console.log(ok ? `✅ Movido: "${doc.nome}" → ${rotulo}` : 'Não consegui mover (documento não encontrado).');
    }
  }
} catch (err) {
  console.error('Falha ao mover:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

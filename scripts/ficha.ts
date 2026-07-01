/**
 * Mostra a FICHA DO PROCESSO pelo MESMO caminho do produto (Passo 15), SEM o
 * WhatsApp e SEM LLM: resolve o assinante pelo TELEFONE (identidade), acha o
 * processo pela referência (número CNJ/fragmento, cliente ou parte — busca
 * escopada por tenant) e imprime a ficha formatada (serviço real + formatação
 * real). Uso (raiz do projeto):
 *   npm run ficha -- --telefone 5511999990001 "12345"
 *   npm run ficha -- --telefone 5511999990001 "Maria Silva"
 *
 * ISOLAMENTO: a resolução e a agregação rodam escopadas pelo assinante do
 * telefone; processo de outro dono simplesmente não aparece.
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
  console.error('Uso: npm run ficha -- --telefone <tel> "<nº do processo (ou trecho), cliente ou parte>"');
  process.exit(1);
}

requireEnv(['DATABASE_URL'], 'a ficha do processo (npm run ficha)');

const { resolveAssinanteByPhone } = await import('../src/infra/db/identity.js');
const { findProcessos } = await import('../src/infra/db/cerebro1-store.js');
const { supabaseFichaStore } = await import('../src/adapters/cerebro1/supabase-ficha-store.js');
const { FichaProcessoService } = await import('../src/application/cerebro1/ficha-processo.js');
const { formatarFicha } = await import('../src/core/domain/cerebro1/ficha-format.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

// Interpreta a referência como o handler faria: 20 dígitos = CNJ exato;
// 4+ dígitos = fragmento do número; senão, nome (cliente ou parte).
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
    const sel = selectorDe(referencia);
    let candidatos = await findProcessos(assinanteId, sel);
    // Nome não bateu como cliente? Tenta como parte contrária (mesma escopagem).
    if (candidatos.length === 0 && 'clienteNome' in sel) {
      candidatos = await findProcessos(assinanteId, { parte: referencia });
    }
    if (candidatos.length === 0) {
      console.log('Não encontrei esse processo. Tente o número (CNJ ou um trecho), o cliente ou a parte.');
    } else if (candidatos.length > 1) {
      console.log(`Encontrei ${candidatos.length} processos — refine a referência:`);
      candidatos.forEach((p, i) =>
        console.log(`  ${i + 1}) ${p.numeroCnj ?? '(sem número)'}${p.clienteNome ? ` — cliente ${p.clienteNome}` : ''}`),
      );
    } else {
      const svc = new FichaProcessoService({ store: supabaseFichaStore, clock: () => new Date() });
      const ficha = await svc.montarPorId(assinanteId, candidatos[0]!.id);
      if (!ficha) {
        console.log('Não encontrei mais esse processo.');
      } else {
        console.log('─'.repeat(60));
        console.log(formatarFicha(ficha));
        console.log('─'.repeat(60));
      }
    }
  }
} catch (err) {
  console.error('Falha ao montar a ficha:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

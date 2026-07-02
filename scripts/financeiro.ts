/**
 * Consulta "o que tenho a receber" pelo caminho REAL (Passo 16), sem WhatsApp e
 * SEM LLM: pendentes escopadas por tenant + "atrasada" derivada (hoje BRT).
 * Uso (raiz):
 *   npm run financeiro -- --telefone 5511999990001
 *   npm run financeiro -- --telefone 5511999990001 --mes 2026-07
 *   npm run financeiro -- --telefone 5511999990001 "12345"   # por processo
 */
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const telefone = flag('--telefone');
const mes = flag('--mes');
const positionais: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i]!.startsWith('--')) i++;
  else positionais.push(argv[i]!);
}
const referencia = positionais.join(' ').trim();

if (!telefone || (mes && !/^\d{4}-\d{2}$/.test(mes))) {
  console.error('Uso: npm run financeiro -- --telefone <tel> [--mes YYYY-MM] ["<nº/trecho do processo ou cliente>"]');
  process.exit(1);
}

requireEnv(['DATABASE_URL'], 'a consulta financeira (npm run financeiro)');

const { resolveAssinanteByPhone } = await import('../src/infra/db/identity.js');
const { listarPendentes } = await import('../src/infra/db/financeiro-store.js');
const { formatarConsultaFinanceiro } = await import('../src/core/domain/cerebro1/financeiro-format.js');
const { hojeBRT } = await import('../src/core/domain/cerebro1/parcelas.js');
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
    const fimDoMes = mes
      ? `${mes}-${String(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`
      : null;
    const rows = await listarPendentes(assinanteId, {
      processo: referencia ? selectorDe(referencia) : null,
      de: mes ? `${mes}-01` : null,
      ate: fimDoMes,
    });
    const escopo = mes ? `em ${mes.slice(5, 7)}/${mes.slice(0, 4)}` : referencia ? `(${referencia})` : null;
    console.log('─'.repeat(60));
    console.log(formatarConsultaFinanceiro(rows, hojeBRT(new Date()), escopo));
    console.log('─'.repeat(60));
  }
} catch (err) {
  console.error('Falha na consulta:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

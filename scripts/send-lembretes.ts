/**
 * Job de LEMBRETE PROATIVO (back-office / Railway Cron, processo SEPARADO).
 *
 * Seleciona os lembretes devidos (compromissos.lembrete_em na janela) e envia ao
 * dono pelo template aprovado. Idempotente (marca após sucesso), resiliente por
 * lembrete, serializado por advisory lock. Fuso: compara em UTC, exibe em BRT.
 *
 * Uso (a partir da raiz do projeto):
 *   npm run send:lembretes                    # rodada real (precisa WHATSAPP_*)
 *   npm run send:lembretes -- --dry-run       # NÃO envia, NÃO marca; lista o que enviaria
 *   npm run send:lembretes -- --dry-run --now "2026-07-01T16:05:00Z"   # simula "agora"
 *
 * Railway: Cron Job a cada 15 min com `npm run send:lembretes` (schedule no README).
 * O ENVIO REAL depende do template `lembrete_generico` aprovado na Meta (PENDENTE).
 */
import { requireEnv } from './_preflight.js';
import type { LembreteSender } from '../src/core/ports/reminders.js';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const nowIdx = argv.indexOf('--now');
const nowArg = nowIdx >= 0 ? argv[nowIdx + 1] : undefined;

let now: Date;
if (nowArg) {
  now = new Date(nowArg);
  if (Number.isNaN(now.getTime())) {
    console.error(`--now inválido: "${nowArg}" (use ISO 8601, ex.: 2026-07-01T16:05:00Z)`);
    process.exit(1);
  }
} else {
  now = new Date();
}

// Env: sempre precisa de banco; envio real (não dry-run) precisa do WhatsApp.
const baseEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DATABASE_URL'];
requireEnv(
  dryRun ? baseEnv : [...baseEnv, 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
  dryRun ? 'o dry-run de lembretes' : 'o envio de lembretes (npm run send:lembretes)',
);

const { remindersStore, withLembretesLock } = await import('../src/infra/db/reminders-store.js');
const { sendLembretes } = await import('../src/application/lembretes/send-lembretes.js');
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

if (!dryRun && !config.LEMBRETES_ENABLED) {
  console.log('LEMBRETES_ENABLED=false — envio desativado; nada a fazer.');
  await closeDatabase().catch(() => {});
  process.exit(0);
}

const logger = {
  info(obj: Record<string, unknown>, msg?: string): void {
    console.log('[lembretes]', msg ?? '', JSON.stringify(obj));
  },
  error(obj: Record<string, unknown>, msg?: string): void {
    console.error('[lembretes][erro]', msg ?? '', JSON.stringify(obj));
  },
};

// Sender real só fora do dry-run (constrói o adapter do WhatsApp). No dry-run,
// um stub que jamais é chamado (o motor não envia em dry-run).
async function buildSender(): Promise<LembreteSender> {
  if (dryRun) {
    return { enviar: () => Promise.reject(new Error('dry-run não envia')) };
  }
  const { getWhatsappConfig } = await import('../src/adapters/whatsapp/config.js');
  const { CloudApiClient } = await import('../src/adapters/whatsapp/cloud-api-client.js');
  const { WhatsappAdapter } = await import('../src/adapters/whatsapp/whatsapp-adapter.js');
  const { PgWindowStore } = await import('../src/adapters/whatsapp/pg-stores.js');
  const { whatsappLembreteSender } = await import('../src/adapters/whatsapp/lembrete-sender.js');
  const wcfg = getWhatsappConfig();
  if (!wcfg) {
    throw new Error('WhatsApp não configurado (defina WHATSAPP_* no .env) para o envio real.');
  }
  const adapter = new WhatsappAdapter({
    config: wcfg,
    client: new CloudApiClient(wcfg),
    window: new PgWindowStore(),
    clock: () => new Date(),
  });
  return whatsappLembreteSender(adapter);
}

try {
  const sender = await buildSender();
  const result = await withLembretesLock(() =>
    sendLembretes(
      {
        store: remindersStore,
        sender,
        now: () => now,
        timeZone: config.LEMBRETES_TIMEZONE,
        graceMin: config.LEMBRETES_GRACE_MIN,
        logger,
      },
      { dryRun },
    ),
  );

  if (result === null) {
    console.log('Outra rodada de lembretes já está em andamento — nada a fazer.');
  } else if (result.dryRun) {
    console.log(`\n=== DRY-RUN (agora=${now.toISOString()}) — NADA foi enviado nem marcado ===`);
    console.log(`Lembretes devidos: ${result.verificados}`);
    for (const p of result.preview) {
      console.log(`\n→ para ${p.telefone} | compromisso ${p.compromissoId} | disparo ${p.lembreteEm}`);
      console.log(`  ${p.mensagem}`);
    }
    if (result.preview.length === 0) console.log('(nenhum lembrete na janela agora)');
  } else {
    console.log(
      `\nLembretes (${result.status}): verificados=${result.verificados} ` +
        `enviados=${result.enviados} falhas=${result.falhas}`,
    );
    for (const e of result.erros) console.log(`  • ${e.compromissoId}: ${e.erro}`);
  }
} catch (err) {
  console.error('Falha no job de lembretes:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

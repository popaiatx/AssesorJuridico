/**
 * Conversa com o CÉREBRO 1 REAL pela linha de comando (sem WhatsApp): mesmo
 * `Cerebro1Handler` do produto (LLM real, stores reais, ficha e financeiro),
 * com TURNOS EM SEQUÊNCIA — o que permite exercitar confirmações ("sim"),
 * desambiguação numerada e slot-filling exatamente como no chat.
 *
 * Fecha o gap "validar o Cérebro 1 sem chip" (Passos 7/11/15/16). Uso (raiz):
 *   npm run c1 -- --telefone 5511999990001 "registra honorário de 10x R$ 1.000 todo dia 20 no processo do Gabriel" "sim"
 *   npm run c1 -- --telefone 5511999990001 "mostra a ficha do processo 12345"
 *
 * ISOLAMENTO: o assinante vem do TELEFONE (identidade), como no WhatsApp.
 */
import { requireEnv } from './_preflight.js';

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const telefone = flag('--telefone');
const mensagens: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i]!.startsWith('--')) i++;
  else mensagens.push(argv[i]!);
}

if (!telefone || mensagens.length === 0) {
  console.error('Uso: npm run c1 -- --telefone <tel> "mensagem 1" ["mensagem 2" ...]');
  process.exit(1);
}

requireEnv(
  ['DATABASE_URL', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY'],
  'a conversa com o Cérebro 1 (npm run c1)',
);

const { resolveAssinanteByPhone } = await import('../src/infra/db/identity.js');
const { requireLlmConfig } = await import('../src/adapters/llm/config.js');
const { createLlmAdapter } = await import('../src/adapters/llm/factory.js');
const { Cerebro1Handler } = await import('../src/application/cerebro1/cerebro1-handler.js');
const { FichaProcessoService } = await import('../src/application/cerebro1/ficha-processo.js');
const { supabaseFichaStore } = await import('../src/adapters/cerebro1/supabase-ficha-store.js');
const { supabaseFinanceiroStore } = await import('../src/adapters/cerebro1/supabase-financeiro-store.js');
const { supabaseCerebro1Store, supabasePendingStore } = await import(
  '../src/adapters/cerebro1/supabase-cerebro1-store.js'
);
const { closeDatabase } = await import('../src/infra/db/tenant.js');

try {
  const assinanteId = await resolveAssinanteByPhone(telefone);
  if (!assinanteId) {
    console.error(`Telefone ${telefone} não tem assinante. Rode antes: npm run seed:assinante -- ${telefone}`);
    process.exitCode = 1;
  } else {
    const handler = new Cerebro1Handler({
      llm: createLlmAdapter(requireLlmConfig()),
      store: supabaseCerebro1Store,
      pending: supabasePendingStore,
      clock: () => new Date(),
      logger: { error: (o, m) => console.error('[c1][erro]', m ?? '', o) },
      ficha: new FichaProcessoService({ store: supabaseFichaStore, clock: () => new Date() }),
      financeiro: supabaseFinanceiroStore,
    });
    for (const texto of mensagens) {
      console.log(`\n👤 Você: ${texto}`);
      const r = await handler.handle({
        assinanteId,
        intent: 'consulta_dados',
        message: {
          messageId: `cli-${Date.now()}`,
          from: telefone,
          text: texto,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`🤖 estagiárIA:\n${r.replyText}`);
    }
  }
} catch (err) {
  console.error('Falha na conversa:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

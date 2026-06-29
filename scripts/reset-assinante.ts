/**
 * Reset ADMINISTRATIVO de assinante (apenas DEV).
 *
 * Remove o assinante por telefone (cascata: clientes, processos, consentimentos,
 * etc.) e limpa qualquer estado de onboarding pendente — para você refazer o
 * fluxo de NÚMERO NOVO do seu próprio número em produção.
 *
 * Usa o caminho admin isolado (service_role) — é um script CLI, fora do caminho
 * de mensagem. Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.
 *
 * Uso (telefone exatamente como o WhatsApp envia em `from`, ex.: 5511999990001):
 *   npm run reset:assinante -- 5511999990001
 */
import { getAdminClient } from '../src/infra/db/admin.js';

async function main(): Promise<void> {
  const telefone = process.argv[2] ?? process.env.RESET_PHONE;
  if (!telefone) {
    console.error('Uso: npm run reset:assinante -- <telefone>');
    process.exit(1);
    return;
  }

  const admin = getAdminClient();

  const { error: delAssinante } = await admin.from('assinantes').delete().eq('telefone', telefone);
  if (delAssinante) {
    console.error('Falha ao remover assinante:', delAssinante.message);
    process.exit(1);
    return;
  }

  const { error: delEstado } = await admin
    .from('onboarding_estado')
    .delete()
    .eq('phone', telefone);
  if (delEstado) {
    console.error('Falha ao limpar estado de onboarding:', delEstado.message);
    process.exit(1);
    return;
  }

  console.log(
    `Reset concluído para ${telefone}. ` +
      'A próxima mensagem desse número cai no onboarding (número novo).',
  );
}

main().catch((err) => {
  console.error('Erro inesperado no reset:', err);
  process.exit(1);
});

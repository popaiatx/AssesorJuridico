/**
 * Simula o FIM DO TRIAL (apenas DEV), para testar o bloqueio sem esperar 3 dias.
 *
 * Coloca `trial_fim` no passado (status `trial`) para o telefone informado — a
 * próxima mensagem cai no porteiro como trial vencido e é desviada para pagamento.
 *
 * Usa o caminho admin isolado (service_role) — script CLI, fora do caminho de
 * mensagem. Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.
 *
 * Uso (telefone como o WhatsApp envia em `from`, ex.: 5511999990001):
 *   npm run trial:expire -- 5511999990001
 */
import { getAdminClient } from '../src/infra/db/admin.js';

async function main(): Promise<void> {
  const telefone = process.argv[2] ?? process.env.TRIAL_PHONE;
  if (!telefone) {
    console.error('Uso: npm run trial:expire -- <telefone>');
    process.exit(1);
    return;
  }

  const admin = getAdminClient();

  const { data: assinante, error: selErr } = await admin
    .from('assinantes')
    .select('id')
    .eq('telefone', telefone)
    .single();
  if (selErr || !assinante) {
    console.error('Assinante não encontrado para esse telefone:', selErr?.message ?? '');
    process.exit(1);
    return;
  }

  const noPassado = new Date(Date.now() - 60_000).toISOString(); // 1 min atrás
  const { error: updErr } = await admin
    .from('assinaturas')
    .update({ trial_fim: noPassado, status: 'trial' })
    .eq('assinante_id', assinante.id);
  if (updErr) {
    console.error('Falha ao expirar o trial:', updErr.message);
    process.exit(1);
    return;
  }

  console.log(
    `Trial expirado para ${telefone}. A próxima mensagem será bloqueada e ` +
      'desviada para o fluxo de pagamento.',
  );
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});

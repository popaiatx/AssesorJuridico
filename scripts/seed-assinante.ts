/**
 * Seed ADMINISTRATIVO de assinante de teste (apenas DEV).
 *
 * Onboarding real ainda é placeholder; este script é o caminho MÍNIMO e isolado
 * para destravar o teste de ponta a ponta: cria/atualiza um assinante com o seu
 * telefone para que o orquestrador o reconheça (em vez de cair no onboarding).
 *
 * Usa o ÚNICO ponto admin isolado (cliente service_role, que ignora o RLS) — por
 * isso vive num script, fora do caminho de mensagem. NÃO é o onboarding final.
 *
 * Uso (o telefone deve ser EXATAMENTE o que o WhatsApp envia em `from`,
 * código do país + número, sem '+', ex.: 5511999990001):
 *   npm run seed:assinante -- 5511999990001 "Seu Nome"
 * Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.
 */
import { getAdminClient } from '../src/infra/db/admin.js';

async function main(): Promise<void> {
  const telefone = process.argv[2] ?? process.env.SEED_PHONE;
  const nome = process.argv[3] ?? process.env.SEED_NOME ?? 'Advogado de Teste';
  if (!telefone) {
    console.error('Uso: npm run seed:assinante -- <telefone> [nome]');
    process.exit(1);
    return;
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('assinantes')
    .upsert(
      {
        nome,
        oab_numero: '000000',
        oab_seccional: 'SP',
        documento: '00000000000',
        telefone,
        status: 'ativo',
      },
      { onConflict: 'telefone' },
    )
    .select('id')
    .single();

  if (error) {
    console.error('Falha ao criar assinante de teste:', error.message);
    process.exit(1);
    return;
  }
  console.log(`Assinante de teste pronto: id=${data.id} telefone=${telefone}`);
}

main().catch((err) => {
  console.error('Erro inesperado no seed:', err);
  process.exit(1);
});

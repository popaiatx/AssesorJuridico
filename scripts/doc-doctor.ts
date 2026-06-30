/**
 * Diagnóstico do ambiente de documentos (12A/12B) — somente LEITURA. Confere os
 * pré-requisitos do fluxo e relata em linguagem clara (sem stack trace cru):
 *  - conexão de banco (DATABASE_URL);
 *  - colunas exigidas em `documentos` (incl. `embedding` da migração 0024);
 *  - extensão pgvector;
 *  - existência do bucket de Storage (DOCUMENTOS_BUCKET).
 * Uso: npm run doc:doctor
 */
import { requireEnv } from './_preflight.js';

requireEnv(['DATABASE_URL'], 'o diagnóstico de documentos (npm run doc:doctor)');

const { pool } = await import('../src/infra/db/pool.js');
const { config } = await import('../src/infra/config/index.js');
const { closeDatabase } = await import('../src/infra/db/tenant.js');

let ok = true;
const linha = (rotulo: string, estado: boolean, detalhe = ''): void => {
  ok = ok && estado;
  console.log(`${estado ? '✅' : '❌'} ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`);
};

try {
  // 1) Banco acessível
  try {
    await pool`select 1`;
    linha('Conexão de banco (DATABASE_URL)', true);
  } catch (err) {
    linha('Conexão de banco (DATABASE_URL)', false, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // 2) Colunas exigidas em documentos
  const cols = await pool<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'documentos'
  `;
  const nomes = new Set(cols.map((c) => c.column_name));
  for (const req of ['busca_texto', 'extracao_status', 'status', 'chaves', 'embedding']) {
    linha(
      `Coluna documentos.${req}`,
      nomes.has(req),
      nomes.has(req) ? '' : 'migração não aplicada — rode as migrações (supabase db push)',
    );
  }

  // 3) pgvector
  const ext = await pool<{ extname: string }[]>`select extname from pg_extension where extname = 'vector'`;
  linha('Extensão pgvector', ext.length > 0, ext.length ? '' : 'CREATE EXTENSION vector (migração 0018/0024)');

  // 4) Bucket de Storage
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    linha(`Bucket "${config.DOCUMENTOS_BUCKET}"`, false, 'SUPABASE_SERVICE_ROLE_KEY ausente (não dá para checar)');
  } else {
    const { getAdminClient } = await import('../src/infra/db/admin.js');
    const { data, error } = await getAdminClient().storage.listBuckets();
    if (error) {
      linha(`Bucket "${config.DOCUMENTOS_BUCKET}"`, false, `falha ao listar buckets: ${error.message}`);
    } else {
      const existe = (data ?? []).some((b) => b.name === config.DOCUMENTOS_BUCKET);
      linha(
        `Bucket "${config.DOCUMENTOS_BUCKET}"`,
        existe,
        existe ? 'privado, ok' : 'NÃO existe — crie no painel do Supabase (Storage), privado',
      );
    }
  }

  console.log(`\n${ok ? '✅ Tudo pronto para o fluxo de documentos.' : '❌ Há pré-requisitos faltando (veja acima).'}`);
  if (!ok) process.exitCode = 1;
} catch (err) {
  console.error('Diagnóstico interrompido:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}

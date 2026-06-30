/**
 * Cria (idempotente) o bucket PRIVADO de documentos no Supabase Storage, com o
 * nome de `DOCUMENTOS_BUCKET`. Back-office (service_role). Seguro rodar várias
 * vezes: se já existir, não faz nada. Limite de upload = DOCUMENTOS_MAX_MB.
 * Uso: npm run doc:bucket
 */
import { requireEnv } from './_preflight.js';

requireEnv(
  ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  'a criação do bucket de documentos (npm run doc:bucket)',
);

const { getAdminClient } = await import('../src/infra/db/admin.js');
const { config } = await import('../src/infra/config/index.js');

const nome = config.DOCUMENTOS_BUCKET;
const storage = getAdminClient().storage;

const { data: buckets, error: listErr } = await storage.listBuckets();
if (listErr) {
  console.error(`Falha ao listar buckets: ${listErr.message}`);
  process.exit(1);
}
if ((buckets ?? []).some((b) => b.name === nome)) {
  console.log(`✅ Bucket "${nome}" já existe (privado). Nada a fazer.`);
} else {
  const { error } = await storage.createBucket(nome, {
    public: false, // PRIVADO — acesso só por URL assinada curta (sigilo)
    fileSizeLimit: `${config.DOCUMENTOS_MAX_MB}MB`,
  });
  if (error) {
    console.error(`❌ Falha ao criar o bucket "${nome}": ${error.message}`);
    process.exit(1);
  }
  console.log(`✅ Bucket "${nome}" criado (privado, limite ${config.DOCUMENTOS_MAX_MB}MB).`);
}

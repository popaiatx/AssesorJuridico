/**
 * Bootstrap da aplicação. Sobe o servidor HTTP e trata shutdown gracioso
 * (encerra o pool de banco). A validação das variáveis de ambiente acontece no
 * import de `config` (fail-fast).
 */
import { config } from './infra/config/index.js';
import { buildServer } from './infra/http/server.js';
import { closeDatabase } from './infra/db/tenant.js';

async function main(): Promise<void> {
  const app = buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'encerrando...');
    try {
      await app.close();
      await closeDatabase();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  // Falha no boot é fatal e explícita (nunca silenciada).
  console.error('Falha ao iniciar a aplicação:', err);
  process.exit(1);
});

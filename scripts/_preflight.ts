/**
 * Pré-checagem de ambiente para os scripts de OPS (ingest/sync/ask-rag).
 *
 * Carrega o `.env` e verifica, com UMA mensagem clara, quais variáveis exigidas
 * estão faltando — ANTES de a validação fail-fast do `config` explodir com um stack
 * trace. Sempre rode os scripts a partir da RAIZ do projeto (onde está o package.json):
 * `npm run <script>` já faz isso (npm executa com a raiz como diretório de trabalho).
 */
import 'dotenv/config';

export function requireEnv(keys: string[], contexto: string): void {
  const faltando = keys.filter((k) => {
    const v = process.env[k];
    return v === undefined || v.trim() === '';
  });
  if (faltando.length > 0) {
    console.error(
      `\n❌ Configuração incompleta para ${contexto}.\n` +
        `   Faltam no .env (raiz do projeto): ${faltando.join(', ')}\n` +
        `   Preencha as variáveis (veja .env.example) e rode de novo a partir da raiz.\n`,
    );
    process.exit(1);
  }
}

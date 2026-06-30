/**
 * Cliente ADMINISTRATIVO (service_role) — ISOLADO.
 *
 * ⚠️  A chave service_role IGNORA O RLS. Um bug aqui vaza dados entre assinantes.
 *     Por isso este módulo:
 *      - é o ÚNICO ponto do código que instancia o cliente service_role;
 *      - destina-se SÓ a back-office, jobs administrativos e operações que,
 *        por natureza, precedem o contexto de tenant (ver `resolveAssinanteByPhone`);
 *      - NUNCA deve ser chamado no caminho normal de um assinante (use `withTenant`).
 *
 * Ver CLAUDE.md ("NUNCA usar service_role em operação de um assinante") e a
 * skill banco-supabase.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let cached: SupabaseClient | null = null;

/**
 * Transporte de Realtime NO-OP. O back-office usa só DB/Storage — nunca canais
 * em tempo real. Sem isto, o supabase-js tenta resolver um WebSocket nativo já
 * na CONSTRUÇÃO do cliente (`RealtimeClient`), o que **quebra no Node 20**
 * (WebSocket nativo só no Node 22+) e derrubava todos os scripts de banco.
 *
 * Passar um `transport` faz o supabase-js NÃO chamar a fábrica de WebSocket;
 * como nunca abrimos um canal, esta classe jamais é instanciada. Se algum código
 * tentar usar realtime por engano, falha alto e claro (em vez de silenciar).
 */
class RealtimeDesabilitado {
  constructor() {
    throw new Error(
      'Realtime está desabilitado no cliente admin (back-office só usa DB/Storage).',
    );
  }
}

/**
 * Retorna o cliente service_role. Lança se a chave não estiver configurada,
 * deixando explícito que esta é uma operação privilegiada (não silencia erro).
 */
export function getAdminClient(): SupabaseClient {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY ausente: operação administrativa indisponível. ' +
        'Configure no ambiente apenas onde back-office/migrações exigirem.',
    );
  }
  if (!cached) {
    cached = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      // Desliga o Realtime (ver RealtimeDesabilitado): roda no Node 20.19+ e 22+.
      realtime: { transport: RealtimeDesabilitado as unknown as never },
    });
  }
  return cached;
}

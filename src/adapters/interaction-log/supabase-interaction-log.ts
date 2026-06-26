/**
 * Implementação real do log de interação.
 *
 *  - COM tenant (assinanteId presente): grava em `interacoes_log` via
 *    `withTenant` (role authenticated, RLS atuando). entrada/saida NÃO são
 *    gravadas ainda (sem anonimização — skill seguranca-dados-sigilo).
 *  - PRÉ-tenant (assinanteId null): NÃO grava no banco (a tabela tem RLS por
 *    tenant e assinante_id NOT NULL). Registra só no logger da aplicação,
 *    sem dado sensível. A auditoria pré-tenant será retomada com o onboarding
 *    (ver ESTADO_DO_PROJETO.md / README — não pode virar ponto cego).
 */
import type {
  InteractionLogEntry,
  InteractionLogPort,
} from '../../core/ports/interaction-log.js';
import { withTenant } from '../../infra/db/tenant.js';

/** Logger mínimo (compatível com o pino/Fastify). */
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

export class SupabaseInteractionLog implements InteractionLogPort {
  constructor(private readonly logger: Logger) {}

  async record(entry: InteractionLogEntry): Promise<void> {
    if (entry.assinanteId === null) {
      // Pré-tenant: só logger, sem persistir e sem dado sensível em claro.
      this.logger.info(
        { event: 'interacao_pre_tenant', intent: entry.intent },
        'interação pré-tenant (não persistida)',
      );
      return;
    }

    await withTenant(entry.assinanteId, async (tx) => {
      await tx`
        insert into interacoes_log
          (assinante_id, intencao, cerebro_usado, fontes_citadas, anonimizado)
        values
          (${entry.assinanteId}, ${entry.intent}, ${entry.cerebro},
           ${entry.fontesCitadas}, ${entry.anonimizado})
      `;
    });
  }
}

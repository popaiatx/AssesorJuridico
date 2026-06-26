/**
 * Port de LOG DE INTERAÇÃO (auditoria imutável).
 *
 * Decisão (caminho pré-tenant): a implementação grava em `interacoes_log` apenas
 * quando há `assinanteId` (via `withTenant`, role authenticated, respeitando o
 * RLS). Interações pré-tenant (onboarding / telefone desconhecido) vão só para o
 * logger da aplicação — ver adapters/interaction-log e ESTADO_DO_PROJETO.md.
 *
 * Sem dado sensível em claro: `entrada`/`saida` ficam fora até existir
 * anonimização (skill seguranca-dados-sigilo).
 */
import type { Cerebro, Intent } from '../domain/intents.js';

export interface InteractionLogEntry {
  assinanteId: string | null;
  intent: Intent;
  /** Cérebro acionado; null neste passo (placeholders não acionam cérebro). */
  cerebro: Cerebro | null;
  anonimizado: boolean;
  fontesCitadas: string[];
}

export interface InteractionLogPort {
  record(entry: InteractionLogEntry): Promise<void>;
}

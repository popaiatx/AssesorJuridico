/**
 * Porteiro real: lê o status + trial_fim da assinatura via `withTenant` (RLS,
 * sem service_role) e decide com `decideAccess`. FAIL-CLOSED: erro de leitura →
 * bloqueia (não lança no caminho da mensagem).
 *
 * O leitor é injetável para testar a regra de fail-closed sem banco.
 */
import { decideAccess, type AccessDecision, type SubscriptionSnapshot } from '../../core/domain/access.js';
import type { SubscriptionGate } from '../../core/ports/subscription-gate.js';
import { withTenant } from '../../infra/db/tenant.js';

export type SubscriptionReader = (assinanteId: string) => Promise<SubscriptionSnapshot | null>;

async function defaultRead(assinanteId: string): Promise<SubscriptionSnapshot | null> {
  return withTenant(assinanteId, async (tx) => {
    const rows = await tx<{ status: string; trial_fim: Date | string | null }[]>`
      select status, trial_fim from assinaturas
      where assinante_id = ${assinanteId}
      order by criado_em desc
      limit 1
    `;
    const r = rows[0];
    if (!r) return null;
    return { status: r.status, trialFim: r.trial_fim ? new Date(r.trial_fim) : null };
  });
}

export class SupabaseSubscriptionGate implements SubscriptionGate {
  constructor(private readonly read: SubscriptionReader = defaultRead) {}

  async evaluate(assinanteId: string, now: Date): Promise<AccessDecision> {
    let snapshot: SubscriptionSnapshot | null;
    try {
      snapshot = await this.read(assinanteId);
    } catch {
      // Fail-closed: se não dá para confirmar acesso, bloqueia.
      return { allowed: false, reason: 'erro_leitura' };
    }
    return decideAccess(snapshot, now);
  }
}

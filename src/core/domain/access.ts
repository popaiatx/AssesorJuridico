/**
 * Decisão de acesso (porteiro) — PURA e FAIL-CLOSED.
 *
 * Bloqueia por padrão. Só libera com confirmação POSITIVA: assinatura `ativa`,
 * ou `trial` dentro do prazo (`now < trial_fim`). Qualquer outra coisa — sem
 * assinatura, `trial_fim` nulo, trial vencido, status inesperado — BLOQUEIA e
 * desvia para o fluxo de pagamento (mesmo princípio do RLS fail-closed).
 */
export interface SubscriptionSnapshot {
  status: string;
  trialFim: Date | null;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

export function decideAccess(snapshot: SubscriptionSnapshot | null, now: Date): AccessDecision {
  // Sem linha de assinatura → bloqueia (fail-closed).
  if (!snapshot) return { allowed: false, reason: 'sem_assinatura' };

  // Assinatura paga/ativa → libera.
  if (snapshot.status === 'ativa') return { allowed: true, reason: 'ativa' };

  // Trial: só libera com data válida e dentro do prazo.
  if (snapshot.status === 'trial') {
    if (snapshot.trialFim === null) return { allowed: false, reason: 'trial_sem_data' };
    if (now < snapshot.trialFim) return { allowed: true, reason: 'trial_ativo' };
    return { allowed: false, reason: 'trial_expirado' };
  }

  // Qualquer outro status (aguardando_pagamento, inadimplente, suspensa,
  // cancelada, ou desconhecido) → bloqueia.
  return { allowed: false, reason: `status_${snapshot.status}` };
}

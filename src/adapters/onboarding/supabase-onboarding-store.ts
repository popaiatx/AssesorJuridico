/**
 * Implementação real do estado do onboarding (tabela travada `onboarding_estado`
 * via funções SECURITY DEFINER — sem service_role no caminho da mensagem).
 */
import type { OnboardingDados, OnboardingEtapa, OnboardingState } from '../../core/domain/onboarding.js';
import type { OnboardingStore } from '../../core/ports/onboarding-store.js';
import {
  deleteOnboardingEstado,
  getOnboardingEstado,
  upsertOnboardingEstado,
} from '../../infra/db/onboarding-store.js';

export class SupabaseOnboardingStore implements OnboardingStore {
  async get(phone: string): Promise<OnboardingState | null> {
    const row = await getOnboardingEstado(phone);
    if (!row) return null;
    return { etapa: row.etapa as OnboardingEtapa, dados: row.dados as OnboardingDados };
  }

  save(phone: string, state: OnboardingState): Promise<void> {
    return upsertOnboardingEstado(phone, state.etapa, state.dados as Record<string, unknown>);
  }

  clear(phone: string): Promise<void> {
    return deleteOnboardingEstado(phone);
  }
}

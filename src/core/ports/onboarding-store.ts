/**
 * Port do estado persistente do onboarding (retomada entre mensagens).
 * A implementação real usa a tabela travada `onboarding_estado` (SECURITY DEFINER).
 */
import type { OnboardingState } from '../domain/onboarding.js';

export interface OnboardingStore {
  get(phone: string): Promise<OnboardingState | null>;
  save(phone: string, state: OnboardingState): Promise<void>;
  clear(phone: string): Promise<void>;
}

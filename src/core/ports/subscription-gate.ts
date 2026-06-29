/**
 * Port do PORTEIRO de acesso. Avalia, a cada mensagem, se o assinante pode
 * seguir o fluxo normal ou deve ser desviado para pagamento. Fail-closed.
 */
import type { AccessDecision } from '../domain/access.js';

export interface SubscriptionGate {
  evaluate(assinanteId: string, now: Date): Promise<AccessDecision>;
}

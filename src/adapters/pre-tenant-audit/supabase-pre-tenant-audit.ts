/**
 * Auditoria pré-tenant real: grava o evento do funil de onboarding na tabela
 * travada `onboarding_eventos`. O telefone é gravado em HASH (SHA-256) — sem dado
 * sensível em claro; só etapa/evento.
 */
import { createHash } from 'node:crypto';
import type { PreTenantAuditEvent, PreTenantAuditPort } from '../../core/ports/pre-tenant-audit.js';
import { logOnboardingEvento } from '../../infra/db/onboarding-store.js';

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

export class SupabasePreTenantAudit implements PreTenantAuditPort {
  record(event: PreTenantAuditEvent): Promise<void> {
    return logOnboardingEvento(hashPhone(event.phone), event.etapa, event.evento);
  }
}

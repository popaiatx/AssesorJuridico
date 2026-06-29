/**
 * Port de auditoria PRÉ-TENANT (funil de onboarding). Fecha o ponto cego R-B.
 * A implementação grava o telefone em HASH (sem dado sensível em claro); só
 * etapa/evento ficam em claro.
 */
export interface PreTenantAuditEvent {
  /** Telefone em claro — a implementação faz o hash antes de persistir. */
  phone: string;
  etapa: string;
  evento: string;
}

export interface PreTenantAuditPort {
  record(event: PreTenantAuditEvent): Promise<void>;
}

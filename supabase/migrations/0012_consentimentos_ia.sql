-- 0012_consentimentos_ia.sql
-- Consentimento de uso de IA aceito no onboarding (Recomendação OAB 001/2024).

create table consentimentos_ia (
  id            uuid primary key default gen_random_uuid(),
  assinante_id  uuid not null references assinantes (id) on delete cascade,
  versao_termo  text not null,
  aceito_em     timestamptz not null default now(),
  canal         text
);

create index idx_consentimentos_assinante on consentimentos_ia (assinante_id);

alter table consentimentos_ia enable row level security;
alter table consentimentos_ia force row level security;

-- Registro de consentimento é histórico: lê e insere, não altera/exclui pelo tenant.
grant select, insert on consentimentos_ia to authenticated;

create policy consentimentos_tenant_select on consentimentos_ia
  for select using (assinante_id = app.current_assinante_id());

create policy consentimentos_tenant_insert on consentimentos_ia
  for insert with check (assinante_id = app.current_assinante_id());

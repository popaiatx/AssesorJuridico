-- 0011_interacoes_log.sql
-- Log IMUTÁVEL de interação (auditoria). Sem dado sensível em claro.
-- Imutabilidade no caminho de tenant: concede-se só SELECT/INSERT; não há
-- política de UPDATE/DELETE => a role authenticated não consegue alterar/excluir.

create table interacoes_log (
  id              uuid primary key default gen_random_uuid(),
  assinante_id    uuid not null references assinantes (id) on delete cascade,
  ts              timestamptz not null default now(),
  intencao        text,
  entrada         text,
  cerebro_usado   text,                 -- 'dados' | 'juridico_rag' | 'tribunais'
  fontes_citadas  text[] not null default '{}',
  saida           text,
  anonimizado     boolean not null default false
);

create index idx_interacoes_assinante on interacoes_log (assinante_id);
create index idx_interacoes_ts on interacoes_log (ts);

alter table interacoes_log enable row level security;
alter table interacoes_log force row level security;

-- Sem UPDATE/DELETE: imutável para o caminho de tenant.
grant select, insert on interacoes_log to authenticated;

create policy interacoes_tenant_select on interacoes_log
  for select using (assinante_id = app.current_assinante_id());

create policy interacoes_tenant_insert on interacoes_log
  for insert with check (assinante_id = app.current_assinante_id());

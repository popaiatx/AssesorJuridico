-- 0009_lancamentos_financeiros.sql
-- Custos e honorários por processo. assinante_id denormalizado (R3) via FK composta.

create type lancamento_tipo as enum ('custo', 'honorario');
create type lancamento_status as enum ('pendente', 'pago', 'cancelado');

create table lancamentos_financeiros (
  id                    uuid primary key default gen_random_uuid(),
  assinante_id          uuid not null,
  processo_id           uuid not null,
  tipo                  lancamento_tipo not null,
  valor                 numeric(15, 2) not null,
  vencimento            date,
  status                lancamento_status not null default 'pendente',
  lembrete_cobranca_em  timestamptz,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  constraint lancamentos_processo_fk
    foreign key (processo_id, assinante_id)
    references processos (id, assinante_id) on delete cascade
);

create index idx_lancamentos_processo on lancamentos_financeiros (processo_id);
create index idx_lancamentos_assinante on lancamentos_financeiros (assinante_id);
create index idx_lancamentos_vencimento on lancamentos_financeiros (vencimento);
create index idx_lancamentos_status on lancamentos_financeiros (status);

create trigger trg_lancamentos_touch
  before update on lancamentos_financeiros
  for each row execute function app.touch_updated_em();

alter table lancamentos_financeiros enable row level security;
alter table lancamentos_financeiros force row level security;

grant select, insert, update, delete on lancamentos_financeiros to authenticated;

create policy lancamentos_tenant on lancamentos_financeiros
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

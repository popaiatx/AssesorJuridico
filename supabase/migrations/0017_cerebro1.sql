-- 0017_cerebro1.sql
-- Cérebro 1 (dados do escritório): descrição em compromissos + ação pendente
-- (confirmar-antes-de-gravar / slot-filling), por tenant.

alter table compromissos add column if not exists descricao text;

-- Uma ação em andamento por assinante (coletando params → confirmando → executa).
-- Tabela de TENANT (assinante já existe): RLS por tenant, sem SECURITY DEFINER.
create table acoes_pendentes (
  assinante_id   uuid primary key references assinantes (id) on delete cascade,
  acao           text not null,
  params         jsonb not null default '{}'::jsonb,
  fase           text not null default 'coletando', -- 'coletando' | 'confirmando'
  faltando       text[] not null default '{}',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

alter table acoes_pendentes enable row level security;
alter table acoes_pendentes force row level security;

grant select, insert, update, delete on acoes_pendentes to authenticated;

create policy acoes_pendentes_tenant on acoes_pendentes
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

create trigger trg_acoes_pendentes_touch
  before update on acoes_pendentes
  for each row execute function app.touch_updated_em();

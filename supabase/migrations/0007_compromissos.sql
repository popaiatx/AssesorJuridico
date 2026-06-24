-- 0007_compromissos.sql
-- Compromissos/prazos. processo_id opcional; quando setado, a FK composta
-- garante que pertence ao mesmo assinante (R3).

create type compromisso_tipo as enum ('audiencia', 'reuniao', 'prazo');
create type compromisso_origem as enum ('manual', 'extraido');

create table compromissos (
  id             uuid primary key default gen_random_uuid(),
  assinante_id   uuid not null references assinantes (id) on delete cascade,
  processo_id    uuid,
  tipo           compromisso_tipo not null,
  data_hora      timestamptz not null,
  local          text,
  lembrete_em    timestamptz[] not null default '{}',
  origem         compromisso_origem not null default 'manual',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint compromissos_processo_fk
    foreign key (processo_id, assinante_id)
    references processos (id, assinante_id) on delete cascade
);

create index idx_compromissos_assinante on compromissos (assinante_id);
create index idx_compromissos_processo on compromissos (processo_id);
create index idx_compromissos_data_hora on compromissos (data_hora);

create trigger trg_compromissos_touch
  before update on compromissos
  for each row execute function app.touch_updated_em();

alter table compromissos enable row level security;
alter table compromissos force row level security;

grant select, insert, update, delete on compromissos to authenticated;

create policy compromissos_tenant on compromissos
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

-- 0004_clientes.sql
-- Cliente do advogado (dado de terceiro — tratamento sob LGPD).

create table clientes (
  id             uuid primary key default gen_random_uuid(),
  assinante_id   uuid not null references assinantes (id) on delete cascade,
  nome           text not null,
  documento      text,
  contato        text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  -- Alvo da FK composta de processos.cliente_id (R3): consistência de tenant.
  constraint clientes_id_assinante_uk unique (id, assinante_id)
);

create index idx_clientes_assinante on clientes (assinante_id);

create trigger trg_clientes_touch
  before update on clientes
  for each row execute function app.touch_updated_em();

alter table clientes enable row level security;
alter table clientes force row level security;

grant select, insert, update, delete on clientes to authenticated;

create policy clientes_tenant on clientes
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

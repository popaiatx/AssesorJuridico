-- 0005_processos.sql
-- Processo. Pai das movimentações/documentos/lançamentos (FK composta — R3).

create table processos (
  id               uuid primary key default gen_random_uuid(),
  assinante_id     uuid not null references assinantes (id) on delete cascade,
  -- Cliente opcional; se setado, deve pertencer ao MESMO assinante (FK composta).
  cliente_id       uuid,
  numero_cnj       text,
  comarca          text,
  vara             text,
  area             text,
  parte_contraria  text,
  status           text,
  valor_causa      numeric(15, 2),
  segredo_justica  boolean not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  -- Alvo da FK composta dos filhos (R3): consistência de (id, assinante_id).
  constraint processos_id_assinante_uk unique (id, assinante_id),
  constraint processos_cliente_fk
    -- Ao excluir o cliente, anula só cliente_id (PG15); assinante_id é NOT NULL.
    foreign key (cliente_id, assinante_id)
    references clientes (id, assinante_id) on delete set null (cliente_id)
);

create index idx_processos_assinante on processos (assinante_id);
create index idx_processos_cliente on processos (cliente_id);
create index idx_processos_cliente_assinante on processos (cliente_id, assinante_id);
create unique index uq_processos_assinante_cnj
  on processos (assinante_id, numero_cnj) where numero_cnj is not null;

create trigger trg_processos_touch
  before update on processos
  for each row execute function app.touch_updated_em();

alter table processos enable row level security;
alter table processos force row level security;

grant select, insert, update, delete on processos to authenticated;

create policy processos_tenant on processos
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

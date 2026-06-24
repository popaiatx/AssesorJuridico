-- 0006_movimentacoes.sql
-- Movimentação processual. assinante_id denormalizado (R3): a FK composta para
-- processos (id, assinante_id) garante que ele NUNCA diverge do processo pai.

create table movimentacoes (
  id            uuid primary key default gen_random_uuid(),
  assinante_id  uuid not null,
  processo_id   uuid not null,
  data          timestamptz not null,
  descricao     text not null,
  fonte         text,                       -- agregador
  hash          text,                       -- dedupe de movimentação
  criado_em     timestamptz not null default now(),
  constraint movimentacoes_processo_fk
    foreign key (processo_id, assinante_id)
    references processos (id, assinante_id) on delete cascade
);

create index idx_movimentacoes_processo on movimentacoes (processo_id);
create index idx_movimentacoes_assinante on movimentacoes (assinante_id);
create index idx_movimentacoes_data on movimentacoes (data);
create unique index uq_movimentacoes_processo_hash
  on movimentacoes (processo_id, hash) where hash is not null;

alter table movimentacoes enable row level security;
alter table movimentacoes force row level security;

grant select, insert, update, delete on movimentacoes to authenticated;

create policy movimentacoes_tenant on movimentacoes
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

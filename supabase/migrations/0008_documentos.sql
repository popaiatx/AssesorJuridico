-- 0008_documentos.sql
-- Documento de processo. Conteúdo vai ao Storage privado; aqui só a referência.
-- assinante_id denormalizado (R3) via FK composta para processos.

create type classificacao_sigilo as enum ('normal', 'sigiloso', 'segredo_justica');

create table documentos (
  id                    uuid primary key default gen_random_uuid(),
  assinante_id          uuid not null,
  processo_id           uuid not null,
  nome                  text not null,
  tipo                  text,
  storage_ref           text not null,        -- referência no bucket privado
  classificacao_sigilo  classificacao_sigilo not null default 'normal',
  enviado_em            timestamptz not null default now(),
  constraint documentos_processo_fk
    foreign key (processo_id, assinante_id)
    references processos (id, assinante_id) on delete cascade
);

create index idx_documentos_processo on documentos (processo_id);
create index idx_documentos_assinante on documentos (assinante_id);

alter table documentos enable row level security;
alter table documentos force row level security;

grant select, insert, update, delete on documentos to authenticated;

create policy documentos_tenant on documentos
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

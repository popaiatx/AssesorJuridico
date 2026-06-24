-- 0003_assinantes.sql
-- Raiz do tenant. Aqui o "assinante_id" do contexto É o próprio id da linha.

create type assinante_status as enum ('trial', 'ativo', 'inadimplente', 'cancelado');
create type plano as enum ('solo', 'escritorio');

create table assinantes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  oab_numero     text not null,
  oab_seccional  text not null,                 -- UF da seccional
  documento      text not null,                 -- CPF/CNPJ
  telefone       text not null unique,          -- chave WhatsApp (identidade)
  email          text,
  status         assinante_status not null default 'trial',
  plano          plano not null default 'solo',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  -- Alvo da FK composta dos filhos (R3): garante consistência de (id, assinante_id).
  constraint assinantes_id_uk unique (id)
);

create trigger trg_assinantes_touch
  before update on assinantes
  for each row execute function app.touch_updated_em();

-- RLS: um assinante só enxerga a própria linha. Criação/exclusão NÃO passam pelo
-- caminho de tenant (onboarding usa o caminho pré-tenant controlado — R4).
alter table assinantes enable row level security;
alter table assinantes force row level security;

grant select, update on assinantes to authenticated;

create policy assinantes_self_select on assinantes
  for select using (id = app.current_assinante_id());

create policy assinantes_self_update on assinantes
  for update using (id = app.current_assinante_id())
  with check (id = app.current_assinante_id());

-- Caminho PRÉ-TENANT (R4): resolve telefone -> id, SEM expor outras colunas.
-- SECURITY DEFINER para funcionar antes de haver contexto de tenant; retorna só o id.
create or replace function app.resolve_assinante_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from assinantes where telefone = p_phone;
$$;

comment on function app.resolve_assinante_by_phone(text) is
  'Pré-tenant (R4): telefone -> assinante_id. Retorna só o id; nenhuma outra coluna.';

grant execute on function app.resolve_assinante_by_phone(text) to authenticated;

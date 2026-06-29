-- 0014_onboarding.sql
-- Onboarding (máquina de estados) + criação do assinante + auditoria pré-tenant.
--
-- Tudo ocorre ANTES de existir tenant (número novo). Mesmo padrão pré-tenant:
-- tabelas travadas (RLS on+force, SEM políticas/grants), manipuladas só por
-- funções SECURITY DEFINER. Nada de service_role no caminho da mensagem.

-- Estado do onboarding, por telefone, persistente entre mensagens (retomada).
-- `dados` guarda os campos em coleta (estado operacional; tabela travada).
create table onboarding_estado (
  phone          text primary key,
  etapa          text not null,
  dados          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

alter table onboarding_estado enable row level security;
alter table onboarding_estado force row level security;

-- Auditoria pré-tenant do funil (fecha o ponto cego R-B). SEM dado sensível em
-- claro: telefone entra como HASH (SHA-256, feito na app); só etapa/evento em claro.
create table onboarding_eventos (
  id          uuid primary key default gen_random_uuid(),
  phone_hash  text not null,
  etapa       text not null,
  evento      text not null,
  criado_em   timestamptz not null default now()
);

create index idx_onboarding_eventos_phone_hash on onboarding_eventos (phone_hash);
create index idx_onboarding_eventos_criado_em on onboarding_eventos (criado_em);

alter table onboarding_eventos enable row level security;
alter table onboarding_eventos force row level security;

-- Estado: get / upsert / delete.
create or replace function app.get_onboarding_estado(p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('etapa', etapa, 'dados', dados)
  from onboarding_estado
  where phone = p_phone;
$$;

create or replace function app.upsert_onboarding_estado(
  p_phone text,
  p_etapa text,
  p_dados jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into onboarding_estado (phone, etapa, dados)
  values (p_phone, p_etapa, p_dados)
  on conflict (phone) do update
    set etapa = excluded.etapa,
        dados = excluded.dados,
        atualizado_em = now();
$$;

create or replace function app.delete_onboarding_estado(p_phone text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from onboarding_estado where phone = p_phone;
$$;

-- Auditoria pré-tenant: registra um evento do funil (telefone já em hash).
create or replace function app.log_onboarding_evento(
  p_phone_hash text,
  p_etapa text,
  p_evento text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into onboarding_eventos (phone_hash, etapa, evento)
  values (p_phone_hash, p_etapa, p_evento);
$$;

-- PONTO ÚNICO de criação do assinante (caminho da mensagem → SECURITY DEFINER,
-- não service_role). Cria o assinante em TRIAL e grava o consentimento de IA,
-- atomicamente. Idempotente por telefone.
create or replace function app.create_assinante_onboarding(
  p_telefone text,
  p_nome text,
  p_oab_numero text,
  p_oab_seccional text,
  p_documento text,
  p_email text,
  p_consent_versao text,
  p_canal text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into assinantes
    (nome, oab_numero, oab_seccional, documento, telefone, email, status, plano)
  values
    (p_nome, p_oab_numero, p_oab_seccional, p_documento, p_telefone,
     nullif(p_email, ''), 'trial', 'solo')
  on conflict (telefone) do nothing
  returning id into v_id;

  if v_id is null then
    -- Já existia (não deveria, mas é idempotente): reutiliza o id.
    select id into v_id from assinantes where telefone = p_telefone;
  else
    insert into consentimentos_ia (assinante_id, versao_termo, canal)
    values (v_id, p_consent_versao, p_canal);
  end if;

  return v_id;
end;
$$;

grant execute on function app.get_onboarding_estado(text) to authenticated;
grant execute on function app.upsert_onboarding_estado(text, text, jsonb) to authenticated;
grant execute on function app.delete_onboarding_estado(text) to authenticated;
grant execute on function app.log_onboarding_evento(text, text, text) to authenticated;
grant execute on function
  app.create_assinante_onboarding(text, text, text, text, text, text, text, text)
  to authenticated;

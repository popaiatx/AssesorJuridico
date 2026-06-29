-- 0015_onboarding_enxuto_trial.sql
-- Onboarding enxuto (sem OAB/documento obrigatórios) + trial de 3 dias na
-- tabela assinaturas (fonte única de verdade do status de acesso).

-- 1) OAB e documento passam a ser OPCIONAIS (não quebra dados existentes).
alter table assinantes alter column oab_numero drop not null;
alter table assinantes alter column oab_seccional drop not null;
alter table assinantes alter column documento drop not null;

-- 2) Assinatura: método é nulo no trial; trial_fim guarda o fim do teste.
alter table assinaturas alter column metodo drop not null;
alter table assinaturas add column if not exists trial_fim timestamptz;

-- 3) Novo estado: trial venceu, aguardando o primeiro pagamento.
alter type assinatura_status add value if not exists 'aguardando_pagamento';

-- 4) create_assinante_onboarding reescrita (assinatura enxuta):
--    cria assinante (oab/doc nulos) + consentimento + assinatura (trial, trial_fim).
drop function if exists app.create_assinante_onboarding(text, text, text, text, text, text, text, text);

create or replace function app.create_assinante_onboarding(
  p_telefone text,
  p_nome text,
  p_email text,
  p_consent_versao text,
  p_canal text,
  p_trial_dias int
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into assinantes (nome, telefone, email, status, plano)
  values (p_nome, p_telefone, nullif(p_email, ''), 'trial', 'solo')
  on conflict (telefone) do nothing
  returning id into v_id;

  if v_id is null then
    -- Já existia: idempotente, não duplica consentimento/assinatura.
    select id into v_id from assinantes where telefone = p_telefone;
    return v_id;
  end if;

  insert into consentimentos_ia (assinante_id, versao_termo, canal)
  values (v_id, p_consent_versao, p_canal);

  insert into assinaturas (assinante_id, status, trial_fim)
  values (v_id, 'trial', now() + make_interval(days => p_trial_dias));

  return v_id;
end;
$$;

grant execute on function
  app.create_assinante_onboarding(text, text, text, text, text, int)
  to authenticated;

-- 0002_tenant_context.sql
-- Contexto de tenant e utilitários compartilhados pelo RLS.
--
-- Refinamento R1 (FALHAR FECHADO): sem a GUC setada, current_assinante_id()
-- retorna NULL — nunca erro, nunca "todas as linhas". As políticas comparam
-- `assinante_id = app.current_assinante_id()`; com NULL, isso é NULL (não TRUE)
-- => ZERO linhas. Sem tenant, nada é visível.

create schema if not exists app;

-- Lê o assinante do contexto da transação (setado por withTenant via set_config).
-- `true` em current_setting = missing_ok: retorna NULL se a GUC não existir.
create or replace function app.current_assinante_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_assinante_id', true), '')::uuid;
$$;

comment on function app.current_assinante_id() is
  'Assinante do contexto atual (RLS). NULL quando não setado => zero linhas (fail-closed).';

-- Trigger genérico para manter atualizado_em.
create or replace function app.touch_updated_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- A role de tenant (authenticated, sem BYPASSRLS) precisa acessar o schema app
-- e executar a função de contexto.
grant usage on schema app to authenticated;
grant execute on function app.current_assinante_id() to authenticated;

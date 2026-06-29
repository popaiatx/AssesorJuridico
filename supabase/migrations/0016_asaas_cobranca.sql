-- 0016_asaas_cobranca.sql
-- Cobrança Asaas: link de pagamento na assinatura + aplicação idempotente de
-- eventos do webhook. O webhook NÃO tem contexto de tenant (o Asaas nos chama),
-- então a aplicação usa função SECURITY DEFINER (não service_role), com
-- idempotência via pagamento_eventos.gateway_event_id (único).

alter table assinaturas add column if not exists cobranca_url text;
alter table assinaturas add column if not exists gateway_customer_id text;

-- Aplica um evento do Asaas de forma IDEMPOTENTE e TRANSACIONAL:
--  - tenta registrar o evento (dedupe por gateway_event_id); se já existia, no-op;
--  - se novo e houver status, atualiza a assinatura (defensivo a estados repetidos).
-- Mapeia ao assinante por p_assinante_id (= externalReference do Asaas).
create or replace function app.apply_asaas_event(
  p_gateway_event_id text,
  p_assinante_id uuid,
  p_tipo text,
  p_novo_status assinatura_status,
  p_proximo_vencimento date,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ins int;
begin
  insert into pagamento_eventos (assinante_id, gateway_event_id, tipo, payload)
  values (p_assinante_id, p_gateway_event_id, p_tipo, p_payload)
  on conflict (gateway_event_id) do nothing;
  get diagnostics v_ins = row_count;

  if v_ins = 0 then
    return false; -- duplicado: efeito único garantido
  end if;

  if p_novo_status is not null then
    update assinaturas
       set status = p_novo_status,
           proximo_vencimento = coalesce(p_proximo_vencimento, proximo_vencimento),
           -- ao ativar, a cobrança aberta deixa de valer
           cobranca_url = case when p_novo_status = 'ativa' then null else cobranca_url end,
           atualizado_em = now()
     where assinante_id = p_assinante_id;
  end if;

  return true;
end;
$$;

grant execute on function
  app.apply_asaas_event(text, uuid, text, assinatura_status, date, jsonb)
  to authenticated;

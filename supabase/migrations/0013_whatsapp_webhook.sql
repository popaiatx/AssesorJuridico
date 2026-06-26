-- 0013_whatsapp_webhook.sql
-- Idempotência do webhook do WhatsApp e janela de 24h.
--
-- Estas operações ocorrem ANTES de existir contexto de tenant (telefone pode
-- ser desconhecido → onboarding). Seguindo o padrão pré-tenant: as tabelas têm
-- RLS habilitado + forçado e NENHUMA política/grant (ficam travadas); só são
-- manipuladas por funções SECURITY DEFINER de superfície mínima. Nada de
-- service_role no caminho da mensagem.

-- Dedup com LEASE: claim ('processing') → sucesso ('done') → falha (release/delete).
-- O lease cobre worker que caiu no meio: um claim 'processing' vencido é reassumido.
create table whatsapp_mensagens_processadas (
  message_id    text primary key,
  status        text not null default 'processing', -- 'processing' | 'done'
  claimed_at    timestamptz not null default now(),
  concluido_em  timestamptz
);

alter table whatsapp_mensagens_processadas enable row level security;
alter table whatsapp_mensagens_processadas force row level security;
-- Sem políticas e sem grants de tabela: acesso só via funções definer abaixo.

-- Janela de 24h por contato (telefone), para liberar texto livre vs template.
create table whatsapp_contatos_janela (
  phone           text primary key,
  ultima_entrada  timestamptz not null
);

alter table whatsapp_contatos_janela enable row level security;
alter table whatsapp_contatos_janela force row level security;

-- Tenta reivindicar a mensagem. true = pode processar agora; false = pular.
create or replace function app.try_claim_whatsapp_message(
  p_message_id text,
  p_lease_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status  text;
  v_claimed timestamptz;
begin
  -- Caminho rápido: insere se for nova.
  insert into whatsapp_mensagens_processadas (message_id) values (p_message_id);
  return true;
exception when unique_violation then
  -- Já existe: avalia status/lease sob trava.
  select status, claimed_at into v_status, v_claimed
    from whatsapp_mensagens_processadas
    where message_id = p_message_id
    for update;

  if v_status = 'done' then
    return false; -- duplicata real (já concluída)
  end if;

  -- 'processing': só reassume se o lease expirou (worker anterior caiu).
  if v_claimed < now() - make_interval(secs => p_lease_seconds) then
    update whatsapp_mensagens_processadas
       set claimed_at = now()
       where message_id = p_message_id;
    return true;
  end if;

  return false; -- outro worker processando agora
end;
$$;

comment on function app.try_claim_whatsapp_message(text, int) is
  'Idempotência com lease: true se a mensagem pode ser processada agora.';

-- Marca como concluída — SÓ após o processamento ter sucesso (envio incluído).
create or replace function app.mark_whatsapp_message_done(p_message_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update whatsapp_mensagens_processadas
     set status = 'done', concluido_em = now()
   where message_id = p_message_id;
$$;

-- Libera o claim em falha transitória, para a reentrega da Meta reprocessar.
create or replace function app.release_whatsapp_message(p_message_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from whatsapp_mensagens_processadas
   where message_id = p_message_id and status <> 'done';
$$;

-- Registra o timestamp da última mensagem do usuário (janela de 24h).
create or replace function app.touch_whatsapp_window(p_phone text, p_at timestamptz)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into whatsapp_contatos_janela (phone, ultima_entrada)
  values (p_phone, p_at)
  on conflict (phone) do update
    set ultima_entrada = greatest(
      whatsapp_contatos_janela.ultima_entrada, excluded.ultima_entrada);
$$;

-- Última entrada do contato (null se nunca escreveu). O cálculo da janela é na app.
create or replace function app.whatsapp_window_last(p_phone text)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ultima_entrada from whatsapp_contatos_janela where phone = p_phone;
$$;

grant execute on function app.try_claim_whatsapp_message(text, int) to authenticated;
grant execute on function app.mark_whatsapp_message_done(text) to authenticated;
grant execute on function app.release_whatsapp_message(text) to authenticated;
grant execute on function app.touch_whatsapp_window(text, timestamptz) to authenticated;
grant execute on function app.whatsapp_window_last(text) to authenticated;

-- 0027_cobranca_lembretes.sql
-- Passo 16 — LEMBRETE DE COBRANÇA. Espelho do padrão da 0021 (lembrete de
-- agenda): idempotência do envio + seleção cross-tenant controlada (SECURITY
-- DEFINER, sem service_role). O aviso vai SEMPRE ao PRÓPRIO advogado (dono da
-- parcela) — o sistema NUNCA cobra o cliente final.
--
-- Os INSTANTES são COMPUTADOS do `vencimento` na seleção (vencimento - d dias,
-- às p_hora:p_minuto de Brasília) — sem estado por parcela; mudar a config vale
-- para o acervo inteiro. Idempotência por (lancamento_id, instante).

create table cobranca_lembretes_enviados (
  id             uuid primary key default gen_random_uuid(),
  lancamento_id  uuid not null references lancamentos_financeiros (id) on delete cascade,
  assinante_id   uuid not null references assinantes (id) on delete cascade,
  lembrete_em    timestamptz not null,
  enviado_em     timestamptz not null default now(),
  criado_em      timestamptz not null default now(),
  constraint cobranca_lembretes_uq unique (lancamento_id, lembrete_em)
);

create index idx_cobranca_lembretes_lancamento on cobranca_lembretes_enviados (lancamento_id);

alter table cobranca_lembretes_enviados enable row level security;
alter table cobranca_lembretes_enviados force row level security;

grant select, insert on cobranca_lembretes_enviados to authenticated;

create policy cobranca_lembretes_tenant on cobranca_lembretes_enviados
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

-- Seleção das cobranças DEVIDAS na janela [agora - grace, agora]: parcela
-- pendente cujo instante computado caiu na janela e ainda não foi marcada.
create or replace function app.cobrancas_due(
  p_agora timestamptz,
  p_grace_min int,
  p_dias_antes int[],
  p_hora int,
  p_minuto int
)
returns table (
  assinante_id    uuid,
  telefone        text,
  lancamento_id   uuid,
  lembrete_em     timestamptz,
  vencimento      date,
  valor           numeric,
  parcela         int,
  total_parcelas  int,
  descricao       text,
  processo_numero text,
  cliente_nome    text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.assinante_id,
    a.telefone,
    l.id as lancamento_id,
    inst.lembrete_em,
    l.vencimento,
    l.valor,
    l.parcela,
    l.total_parcelas,
    l.descricao,
    p.numero_cnj as processo_numero,
    c.nome as cliente_nome
  from lancamentos_financeiros l
  join assinantes a on a.id = l.assinante_id
  join processos p on p.id = l.processo_id
  left join clientes c on c.id = p.cliente_id
  cross join lateral (
    -- (vencimento - d) às p_hora:p_minuto no fuso de Brasília → timestamptz.
    select ((l.vencimento - d)::timestamp
            + make_interval(hours => p_hora, mins => p_minuto))
           at time zone 'America/Sao_Paulo' as lembrete_em
    from unnest(p_dias_antes) as d
  ) inst
  where l.status = 'pendente'
    and l.vencimento is not null
    and a.telefone is not null
    and inst.lembrete_em <= p_agora
    and inst.lembrete_em >= p_agora - make_interval(mins => p_grace_min)
    and not exists (
      select 1 from cobranca_lembretes_enviados x
      where x.lancamento_id = l.id and x.lembrete_em = inst.lembrete_em
    )
  order by inst.lembrete_em;
$$;

-- Marca ATÔMICA e IDEMPOTENTE (deriva o assinante do próprio lançamento).
create or replace function app.marcar_cobranca_enviada(
  p_lancamento_id uuid,
  p_lembrete_em timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assinante uuid;
begin
  select assinante_id into v_assinante from lancamentos_financeiros where id = p_lancamento_id;
  if v_assinante is null then
    return false;
  end if;
  insert into cobranca_lembretes_enviados (lancamento_id, assinante_id, lembrete_em)
  values (p_lancamento_id, v_assinante, p_lembrete_em)
  on conflict (lancamento_id, lembrete_em) do nothing;
  return found;
end;
$$;

grant execute on function app.cobrancas_due(timestamptz, int, int[], int, int) to authenticated;
grant execute on function app.marcar_cobranca_enviada(uuid, timestamptz) to authenticated;

-- 0021_lembretes_enviados.sql
-- Passo 10 — LEMBRETE PROATIVO. Idempotência do envio + seleção cross-tenant
-- controlada (SECURITY DEFINER, sem service_role — mesmo padrão pré-tenant).
--
-- O Cérebro 1 já grava `compromissos.lembrete_em` (timestamptz[], 24h e 1h antes).
-- Aqui registramos o que JÁ foi enviado (marca-após-sucesso) e expomos a seleção
-- dos lembretes devidos para o job (back-office). Nada de LLM; o conteúdo vai ao
-- próprio dono (o advogado) pelo template aprovado.

-- Registro idempotente do envio: 1 linha por (compromisso, instante de lembrete).
create table lembretes_enviados (
  id             uuid primary key default gen_random_uuid(),
  compromisso_id uuid not null references compromissos (id) on delete cascade,
  assinante_id   uuid not null references assinantes (id) on delete cascade,
  lembrete_em    timestamptz not null,
  enviado_em     timestamptz not null default now(),
  criado_em      timestamptz not null default now(),
  constraint lembretes_enviados_uq unique (compromisso_id, lembrete_em)
);

create index idx_lembretes_enviados_compromisso on lembretes_enviados (compromisso_id);

alter table lembretes_enviados enable row level security;
alter table lembretes_enviados force row level security;

grant select, insert on lembretes_enviados to authenticated;

create policy lembretes_enviados_tenant on lembretes_enviados
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

-- Seleção dos lembretes DEVIDOS na janela [agora - grace, agora], ignorando
-- futuros, compromissos já passados (data_hora) e os já enviados. Cross-tenant,
-- mas devolve só os dados do próprio dono de cada linha (vai para o dono).
create or replace function app.lembretes_due(p_agora timestamptz, p_grace_min int)
returns table (
  assinante_id    uuid,
  telefone        text,
  compromisso_id  uuid,
  lembrete_em     timestamptz,
  data_hora       timestamptz,
  tipo            text,
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
    c.assinante_id,
    a.telefone,
    c.id as compromisso_id,
    le.lembrete as lembrete_em,
    c.data_hora,
    c.tipo::text,
    c.descricao,
    p.numero_cnj as processo_numero,
    cl.nome as cliente_nome
  from compromissos c
  join assinantes a on a.id = c.assinante_id
  cross join lateral unnest(c.lembrete_em) as le(lembrete)
  left join processos p on p.id = c.processo_id
  left join clientes cl on cl.id = p.cliente_id
  where le.lembrete <= p_agora
    and le.lembrete >= p_agora - make_interval(mins => p_grace_min)
    and c.data_hora > p_agora
    and not exists (
      select 1 from lembretes_enviados x
      where x.compromisso_id = c.id and x.lembrete_em = le.lembrete
    )
  order by le.lembrete;
$$;

-- Marca um lembrete como enviado de forma ATÔMICA e IDEMPOTENTE. Deriva o
-- assinante do próprio compromisso (não confia em parâmetro). Retorna TRUE se
-- marcou agora; FALSE se já estava marcado (conflito) ou compromisso inexistente.
create or replace function app.marcar_lembrete_enviado(
  p_compromisso_id uuid,
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
  select assinante_id into v_assinante from compromissos where id = p_compromisso_id;
  if v_assinante is null then
    return false;
  end if;
  insert into lembretes_enviados (compromisso_id, assinante_id, lembrete_em)
  values (p_compromisso_id, v_assinante, p_lembrete_em)
  on conflict (compromisso_id, lembrete_em) do nothing;
  return found; -- true só quando inseriu de fato
end;
$$;

grant execute on function app.lembretes_due(timestamptz, int) to authenticated;
grant execute on function app.marcar_lembrete_enviado(uuid, timestamptz) to authenticated;

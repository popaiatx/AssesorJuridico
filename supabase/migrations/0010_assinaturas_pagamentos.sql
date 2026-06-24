-- 0010_assinaturas_pagamentos.sql
-- Assinatura do produto + eventos de pagamento idempotentes.

create type pagamento_metodo as enum ('pix_automatico', 'cartao');
create type assinatura_status as enum ('trial', 'ativa', 'inadimplente', 'suspensa', 'cancelada');

create table assinaturas (
  id                  uuid primary key default gen_random_uuid(),
  assinante_id        uuid not null references assinantes (id) on delete cascade,
  gateway_ref         text,
  metodo              pagamento_metodo not null,
  status              assinatura_status not null default 'trial',
  proximo_vencimento  date,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create index idx_assinaturas_assinante on assinaturas (assinante_id);
create index idx_assinaturas_status on assinaturas (status);
create index idx_assinaturas_proximo_vencimento on assinaturas (proximo_vencimento);

create trigger trg_assinaturas_touch
  before update on assinaturas
  for each row execute function app.touch_updated_em();

alter table assinaturas enable row level security;
alter table assinaturas force row level security;

grant select, insert, update, delete on assinaturas to authenticated;

create policy assinaturas_tenant on assinaturas
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

-- Eventos de pagamento: cada evento do gateway processado UMA ÚNICA vez.
-- gateway_event_id UNIQUE é a chave de idempotência (webhook reentregue/duplicado).
create table pagamento_eventos (
  id                uuid primary key default gen_random_uuid(),
  assinante_id      uuid not null references assinantes (id) on delete cascade,
  assinatura_id     uuid references assinaturas (id) on delete set null,
  gateway_event_id  text not null,
  tipo              text not null,
  payload           jsonb not null,
  recebido_em       timestamptz not null default now(),
  constraint pagamento_eventos_gateway_event_uk unique (gateway_event_id)
);

create index idx_pagamento_eventos_assinante on pagamento_eventos (assinante_id);
create index idx_pagamento_eventos_assinatura on pagamento_eventos (assinatura_id);

alter table pagamento_eventos enable row level security;
alter table pagamento_eventos force row level security;

-- O assinante pode LER seus eventos; a gravação ocorre no processamento do
-- webhook (caminho administrativo/idempotente), não pelo caminho de tenant.
grant select on pagamento_eventos to authenticated;

create policy pagamento_eventos_tenant_select on pagamento_eventos
  for select using (assinante_id = app.current_assinante_id());

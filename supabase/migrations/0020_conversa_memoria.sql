-- 0020_conversa_memoria.sql
-- Passo 9 — MEMÓRIA DE CONVERSA por TENANT (janela curta; o TTL é aplicado na
-- aplicação na leitura). Mesmo padrão de `acoes_pendentes`: 1 linha por assinante,
-- RLS force, escrita só por `authenticated` (via withTenant), nunca service_role.
--
-- A memória serve SÓ para interpretar a próxima mensagem (resolver referências como
-- "dela"/"o artigo seguinte"); NUNCA é fonte de afirmação jurídica (a validação de
-- citação do Cérebro 2 continua contra o corpus). Conteúdo guardado é mínimo e já
-- anonimizado antes de ir ao LLM.

create table conversa_memoria (
  assinante_id  uuid primary key references assinantes (id) on delete cascade,
  turnos        jsonb not null default '[]'::jsonb,  -- janela curta: [{papel,texto?,intent?,fontes?,em}]
  atualizado_em timestamptz not null default now(),
  criado_em     timestamptz not null default now()
);

alter table conversa_memoria enable row level security;
alter table conversa_memoria force row level security;

grant select, insert, update, delete on conversa_memoria to authenticated;

create policy conversa_memoria_tenant on conversa_memoria
  for all using (assinante_id = app.current_assinante_id())
  with check (assinante_id = app.current_assinante_id());

-- Mantém `atualizado_em` no horário da última mensagem (base do TTL de expiração).
create trigger trg_conversa_memoria_touch
  before update on conversa_memoria
  for each row execute function app.touch_updated_em();

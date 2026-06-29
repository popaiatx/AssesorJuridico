-- 0019_corpus_sync.sql
-- Sincronização automática do corpus (Passo 8B). Acrescenta METADADOS DE SYNC por
-- norma (detecção de mudança por hash, rastreabilidade, vigência/revogação) e uma
-- tabela de AUDITORIA das execuções de sync.
--
-- O corpus continua COMPARTILHADO (referência pública, sem tenant): corpus_normas e
-- corpus_trechos mantêm a leitura pública do 0018. Já corpus_sync_runs é BACK-OFFICE
-- (operação): RLS habilitado e SEM política de leitura pública — só roles
-- privilegiadas (o job de sync, via pool) acessam. Nenhum dado de tenant aqui.

-- Metadados de sincronização por norma.
alter table corpus_normas
  add column if not exists fonte_hash           text,        -- SHA-256 do texto normalizado
  add column if not exists fonte_versao         text,        -- id de versão da fonte (null no Planalto)
  add column if not exists ultima_sincronizacao timestamptz, -- quando a norma foi vista por último
  add column if not exists revogada_em          date;        -- quando foi detectada a revogação

-- Filtro/junção por vigência (a busca exclui revogada do allowlist de afirmação).
create index if not exists idx_corpus_normas_vigencia on corpus_normas (vigencia_status);

-- Auditoria das execuções de sync (rastreabilidade; back-office).
create table corpus_sync_runs (
  id                  uuid primary key default gen_random_uuid(),
  fonte               text not null,                          -- ex.: 'planalto'
  iniciado_em         timestamptz not null default now(),
  finalizado_em       timestamptz,
  status              text not null default 'em_andamento',   -- em_andamento|sucesso|parcial|erro
  normas_verificadas  int not null default 0,
  normas_atualizadas  int not null default 0,
  normas_revogadas    int not null default 0,
  erros               jsonb not null default '[]'::jsonb,     -- [{identificador, erro}], inclui avisos de revisão
  criado_em           timestamptz not null default now()
);

-- RLS habilitado SEM política: corpus_sync_runs é operação interna (sem leitura
-- pública). O job de sync escreve via role privilegiada (pool), fora do caminho
-- da mensagem do assinante.
alter table corpus_sync_runs enable row level security;

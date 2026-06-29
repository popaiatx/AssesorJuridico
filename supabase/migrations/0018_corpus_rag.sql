-- 0018_corpus_rag.sql
-- Cérebro 2 (RAG jurídico): corpus COMPARTILHADO (referência pública), o oposto
-- do Cérebro 1 — NÃO é por tenant. RLS habilitado apenas com LEITURA PÚBLICA
-- (using true); a escrita ocorre só na ingestão (back-office, via pool/postgres).
-- Não contém PII. O log de interação (esse sim) continua por tenant.

create extension if not exists vector;

-- Normas (metadados da fonte).
create table corpus_normas (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null,                 -- 'legislacao' | 'jurisprudencia'
  titulo            text not null,                 -- ex.: "Código de Defesa do Consumidor"
  identificador     text not null unique,          -- ex.: "Lei nº 8.078/1990"
  data_publicacao   date,
  vigencia_status   text,                          -- ex.: 'vigente' (quando conhecido)
  fonte_url         text,
  criado_em         timestamptz not null default now()
);

-- Trechos (chunks por estrutura legal) + embedding.
-- Dimensão 1536 = OpenAI text-embedding-3-small (trocar o modelo/dim exige reingestão).
create table corpus_trechos (
  id          uuid primary key default gen_random_uuid(),
  norma_id    uuid not null references corpus_normas (id) on delete cascade,
  artigo      text,
  paragrafo   text,
  inciso      text,
  ordem       int not null default 0,
  texto       text not null,
  citacao     text not null,                       -- rótulo pronto p/ exibir
  fonte_url   text,
  embedding   vector(1536),
  criado_em   timestamptz not null default now()
);

create index idx_corpus_trechos_norma on corpus_trechos (norma_id);
-- Índice vetorial HNSW (cosine) para a busca por similaridade.
create index idx_corpus_trechos_embedding
  on corpus_trechos using hnsw (embedding vector_cosine_ops);

-- RLS habilitado, mas leitura é PÚBLICA (corpus compartilhado, sem dado de tenant).
-- Sem política de escrita: writes só por roles privilegiadas na ingestão.
alter table corpus_normas enable row level security;
alter table corpus_trechos enable row level security;

grant select on corpus_normas to authenticated, anon;
grant select on corpus_trechos to authenticated, anon;

create policy corpus_normas_public_read on corpus_normas for select using (true);
create policy corpus_trechos_public_read on corpus_trechos for select using (true);

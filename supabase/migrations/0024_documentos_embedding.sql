-- 0024_documentos_embedding.sql
-- Passo 12B (busca de documentos). Adiciona o EMBEDDING semântico por documento,
-- gerado a partir do `busca_texto` (chaves/resumo do 12A). Documento sem texto
-- (escaneado) fica com embedding NULL → achável só pela busca exata (nome/data).
--
-- ISOLAMENTO: a busca SEMPRE filtra por assinante_id na própria query (exata e
-- semântica), com a RLS force da `documentos` como backstop. O índice HNSW acelera
-- a ordenação por distância; a cláusula de tenant restringe as linhas antes.

create extension if not exists vector; -- já criada na 0018; idempotente

alter table documentos add column if not exists embedding vector(1536);

-- Índice vetorial (cosine) para a busca por similaridade.
create index if not exists idx_documentos_embedding
  on documentos using hnsw (embedding vector_cosine_ops);

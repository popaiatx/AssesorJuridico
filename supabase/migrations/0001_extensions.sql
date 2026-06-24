-- 0001_extensions.sql
-- Extensões base. pgvector (corpus do RAG / Cérebro 2) é da Fase 2 — não aqui.

-- gen_random_uuid() para PKs.
create extension if not exists pgcrypto;

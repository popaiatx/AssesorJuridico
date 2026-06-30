-- 0023_documentos_12a.sql
-- Passo 12A (gestão de documentos: receber/decidir/ler/resumir/guardar com chaves).
-- Evolui `documentos` (0008): permite documento SOLTO (sem processo) e guarda as
-- INFORMAÇÕES-CHAVE + resumo que vão alimentar a busca do 12B. O arquivo segue no
-- Storage privado; aqui só metadados + chaves (RLS force por tenant, já existente).

-- Documento solto: o vínculo a processo passa a ser OPCIONAL. A FK composta é
-- MATCH SIMPLE: com processo_id NULL, a FK não é checada (doc sem processo é válido).
alter table documentos alter column processo_id drop not null;

alter table documentos
  -- Informações-chave estruturadas (tipo/partes/numeros/datas/assunto/resumo_curto).
  -- Vazio quando não foi possível extrair (ver extracao_status). Nunca "chute".
  add column if not exists chaves          jsonb,
  -- Resumo (quando pedido/possível).
  add column if not exists resumo          text,
  -- 'ok' | 'sem_texto' (escaneado/imagem) | 'falha'. 'sem_texto' = ponto cego da busca.
  add column if not exists extracao_status text not null default 'ok',
  -- Texto denormalizado p/ a busca do 12B (partes+numeros+assunto+resumo). Índice no 12B.
  add column if not exists busca_texto     text,
  -- Ciclo: 'aguardando_decisao' (recebido, esperando 1/2/3) | 'guardado'.
  add column if not exists status          text not null default 'guardado',
  -- Legenda original que veio com o arquivo (se houve).
  add column if not exists legenda         text,
  add column if not exists atualizado_em   timestamptz not null default now();

-- Apoia a leitura "documento aguardando decisão deste tenant".
create index if not exists idx_documentos_status on documentos (assinante_id, status);

create trigger trg_documentos_touch
  before update on documentos
  for each row execute function app.touch_updated_em();

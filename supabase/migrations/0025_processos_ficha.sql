-- 0025_processos_ficha.sql
-- Passo 15 (ficha do processo). Completa os DADOS DO PROCESSO para a ficha:
-- fase processual e instância. Texto livre, sem enum (fases variam por área;
-- enum engessaria o preenchimento por conversa).
--
-- Nenhuma mudança de RLS/FK/índice: colunas novas na tabela já protegida (0005,
-- RLS force por tenant); os demais campos da ficha (vara, comarca, área, parte
-- contrária, valor da causa, segredo de justiça) já existem desde a fundação.

alter table processos
  add column if not exists fase      text,
  add column if not exists instancia text;

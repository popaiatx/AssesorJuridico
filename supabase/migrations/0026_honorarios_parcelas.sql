-- 0026_honorarios_parcelas.sql
-- Passo 16 (financeiro/honorários). Completa `lancamentos_financeiros` (0009):
-- cada PARCELA é uma linha; parcelas geradas juntas compartilham um `acordo_id`
-- (agrupamento leve — sem tabela de contrato por ora). À vista = parcela 1/1.
--
-- `descricao` (texto livre) comporta o honorário de ÊXITO no futuro sem nova
-- migração (decisão registrada no PLANO_EXPANSAO §3.2).
--
-- NOTA: `lembrete_cobranca_em` (0009) fica SEM USO — os instantes do lembrete
-- de cobrança são COMPUTADOS do `vencimento` na seleção (0027), sem estado por
-- parcela. Remoção da coluna fica para uma migração de limpeza futura.
--
-- Nenhuma mudança de RLS: tabela já protegida (RLS force por tenant, 0009).

alter table lancamentos_financeiros
  add column if not exists descricao      text,
  add column if not exists acordo_id      uuid,
  add column if not exists parcela        int,
  add column if not exists total_parcelas int,
  add column if not exists pago_em        timestamptz;

create index if not exists idx_lancamentos_acordo
  on lancamentos_financeiros (acordo_id);

-- Apoia a seleção de cobranças devidas (0027) e o "a receber" por período.
create index if not exists idx_lancamentos_assinante_status_venc
  on lancamentos_financeiros (assinante_id, status, vencimento);

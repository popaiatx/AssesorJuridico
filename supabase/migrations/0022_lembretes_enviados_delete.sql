-- 0022_lembretes_enviados_delete.sql
-- Passo 11 (editar/remover no Cérebro 1). Ao REMARCAR um compromisso, a marcação
-- de lembrete antiga precisa ser apagada (a nova data recalcula os lembretes; nada
-- pode ficar "já enviado" para a data nova). Isso é feito por `withTenant`
-- (role `authenticated`), que até agora só tinha select/insert nesta tabela.
--
-- A política por tenant (0021) já restringe DELETE ao próprio assinante; aqui só
-- concedemos o privilégio. Continua isolado (RLS force) e sem service_role.
grant delete on lembretes_enviados to authenticated;

---
name: banco-supabase
description: Como usar o Supabase como banco de dados deste projeto de forma escalável, segura e confiável para alto volume de usuários. Use SEMPRE que for criar/alterar schema, escrever migrações, montar queries, configurar Row Level Security (RLS), trabalhar com pgvector (RAG), Storage de documentos, pooler de conexões, índices ou performance. Use também ao revisar qualquer acesso ao banco, para garantir RLS, escopo de tenant e uso correto das chaves do Supabase.
---

# Banco de dados no Supabase (escalável, seguro, confiável)

O Supabase é Postgres gerenciado com extras que cobrem as necessidades deste projeto: RLS para multi-tenant, pgvector para o RAG, Storage para documentos, pooler de conexões para alto volume e migrações versionadas. O objetivo desta skill é garantir que esse poder seja usado sem abrir brechas de segurança nem gargalos de escala.

## Princípio central

**RLS (Row Level Security) é a base do isolamento entre assinantes.** O filtro por `assinante_id` na aplicação é a primeira linha; o RLS é a garantia que sobrevive a um bug na aplicação. As duas camadas andam juntas.

## RLS — isolamento multi-tenant

- **Habilite RLS em toda tabela** que contenha dado de assinante (`processos`, `clientes`, `compromissos`, `documentos`, `lancamentos`, `interacoes`, etc.). Tabela sem RLS é vazamento esperando para acontecer.
- Cada tabela tem política que restringe linhas ao tenant atual. O tenant vem de um claim no token da requisição (ex.: `assinante_id` em `request.jwt.claims`), nunca de um valor enviado pelo usuário.
- **A chave `service_role` IGNORA o RLS.** Esse é o erro mais perigoso e mais comum: usar `service_role` no backend "porque é prático" faz o RLS não valer nada. Regra:
  - `service_role`: só em back-office, jobs administrativos e migrações. Nunca no caminho de um assinante.
  - Operações de um assinante: use um token com o claim do tenant e deixe o RLS atuar; ou, se a operação roda no backend, aplique o filtro de tenant explicitamente **e** mantenha o RLS como rede de proteção.
- A chave `anon` é pública por natureza; ela só é segura porque o RLS limita o que ela enxerga. Nunca relaxe o RLS para "facilitar".

## pgvector — corpus do RAG (Cérebro 2)

- Guarde os embeddings do corpus jurídico em uma tabela com a extensão `vector`. Este corpus é **conhecimento geral, não dado de tenant** — mantenha-o separado das tabelas de assinante (ver skill `rag-juridico-confiavel`).
- Crie índice vetorial (HNSW para boa relação precisão/velocidade) para a busca por similaridade não varrer a tabela inteira.
- Guarde metadados junto (norma, artigo, vigência, link da fonte) para a citação obrigatória.

## Storage — documentos

- Documentos de processos vão em **buckets privados**. Nunca públicos: é sigilo profissional.
- Acesso via **URLs assinadas** com expiração curta, geradas sob demanda.
- Aplique políticas de acesso por tenant também no Storage; o documento de um assinante não pode ser acessível por outro.

## Alto volume e performance

- **Pooler de conexões:** o tráfego da aplicação (especialmente serverless / muitas conexões curtas) deve usar o **pooler do Supabase (Supavisor), em modo transaction** — não a conexão direta. Postgres tem limite de conexões; sem pooler, o alto fluxo derruba o banco.
  - Em modo transaction, evite depender de prepared statements de sessão; ajuste o driver conforme a doc do Supabase.
- **Índices:** crie índice em toda FK (`assinante_id`, `processo_id`, `cliente_id`) e nas colunas usadas em filtro/ordenação (`status`, `vencimento`, `data_hora`). Índice acompanha a query real — adicione conforme as consultas do produto.
- **Selecione só o necessário:** nunca `select *` quando poucos campos bastam; pagine listas; evite N+1.
- **Realtime e Edge Functions** são opcionais: Edge Functions podem hospedar webhooks (pagamento, tribunais) perto do banco; use se simplificar, sem acoplar o domínio a elas.

## Migrações e operação

- **Migrações versionadas** (Supabase CLI), revisadas em PR. Nunca altere o schema de produção na mão.
- Habilite **backups / PITR** e acompanhe métricas (conexões, consultas lentas) pelo painel.
- Segredos (`service_role`, chaves) **só no servidor**, em secret manager / variáveis de ambiente. A `anon` pode ir ao cliente; a `service_role`, jamais.

## Checklist antes de subir uma tabela ou query

1. A tabela tem dado de assinante? → RLS habilitado + política por tenant.
2. A query roda no caminho de um assinante? → não use `service_role`; garanta o filtro de tenant.
3. Tem índice nas colunas de filtro/junção?
4. A consulta seleciona só os campos necessários?
5. Documento sensível? → bucket privado + URL assinada.
6. O tráfego usa o pooler?

## Exemplos

**Política de RLS por tenant** (conceitual)
Em `processos`, habilite RLS e crie política de SELECT/INSERT/UPDATE/DELETE que só permite linhas onde `assinante_id` é igual ao claim de tenant do token da requisição. Sem token válido, nenhuma linha.

**Busca no RAG**
Gere o embedding da pergunta, busque por similaridade na tabela vetorial usando o índice HNSW, traga os trechos mais próximos com seus metadados; a resposta segue o pipeline da skill `rag-juridico-confiavel`.

**Erro a evitar**
Backend usando `service_role` para listar "meus processos" → o RLS é ignorado e, se o filtro de tenant falhar no código, um assinante vê processos de outro. Correto: token com claim de tenant + RLS atuando.

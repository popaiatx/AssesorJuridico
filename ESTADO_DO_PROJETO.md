# Estado do projeto — Assistente Jurídico no WhatsApp

> Documento vivo (convenção C do `CLAUDE.md`). Resumo do estado atual para
> retomar o trabalho a qualquer momento. **Não é changelog** — o histórico está
> no git. Atualizado ao final de cada passo, antes do push.

## Fase atual

- **Fase 1 (Núcleo).** Concluído o **Passo 5 — Onboarding + criação de assinante**.
  Ciclo no WhatsApp já validado em produção (Railway) nos passos anteriores;
  falta **validar em produção o fluxo de número novo** (onboarding completo →
  trial) — sua parte, com o guia no README (`reset:assinante` ou 2º número).
  Próximo: cérebros (C1 NL→SQL) ou pagamento (Asaas).

## O que já está pronto

- **Passo 1 — Fundação.** Estrutura ports & adapters (Node 20 + TS, Fastify);
  config validada por Zod (fail-fast); clientes de banco isolados (`withTenant`
  com RLS, `admin` com `service_role`, `identity` pré-tenant); 5 ports
  (payment, courts, whatsapp, llm, storage) com adapters **stub**; migrações
  Supabase `0001–0012` (schema do §5, RLS por tenant, índices); `/health` e
  `/health/ready`. Validado em Postgres 15.
- **Passo 2 — Orquestrador + classificação.** Intenções tipadas; `IntentClassifier`
  + `KeywordIntentClassifier` determinístico (sem LLM); `Orchestrator` que resolve
  telefone→assinante (pré-tenant), roteia para **um** handler, **pergunta** se
  ambíguo (rótulos amigáveis), e registra a interação; handlers **placeholder
  honestos**; `InteractionLogPort` (grava só com tenant; pré-tenant só logger).
- **Passo 3 — Adapter real do WhatsApp.** Webhook Fastify (`GET` handshake +
  `POST`); verificação de **assinatura HMAC** (corpo cru, timing-safe); **idempotência
  com lease** (migração 0013, funções `SECURITY DEFINER`); **processa antes do ack**
  (200 sucesso / 500 reentrega); **janela de 24h** por contato; envio via
  `CloudApiClient` (HTTP injetável); **mídia** vira placeholder honesto; registro de
  templates (1 inicial); `requireWhatsappConfig` (app sobe sem WhatsApp); fiação no
  `server`. Migração validada em Postgres 15.
- **Passo 4 — LLM provider-agnostic + ativação em dev.** `LlmPort` com tool use +
  saída estruturada; adapters **Anthropic** e **OpenAI** (raw HTTP injetável) com
  seleção por `LLM_PROVIDER`; `requireLlmConfig` (app sobe sem LLM);
  **`LlmIntentClassifier`** com fallback determinístico; **ajuda/conversa geral via
  LLM** (`duvida_juridica` segue placeholder — sem conteúdo jurídico sem fonte);
  `scripts/seed-assinante` (admin isolado) para destravar teste em dev; servidor
  pronto para hospedagem (`0.0.0.0`/`PORT`, `npm start`).
- **Passo 5 — Onboarding + criação de assinante.** Máquina de estados
  **determinística** (nome→OAB→CPF/CNPJ→e-mail→consentimento→criar) que sobrevive
  entre mensagens (`onboarding_estado`, tabela travada); validadores CPF/CNPJ
  (dígito), OAB (UF), e-mail; robustez R1 (cancelar/recomeçar, vazio/off-script);
  criação atômica em **trial** + consentimento via SECURITY DEFINER (sem
  service_role no caminho da mensagem); **auditoria pré-tenant** com telefone em
  hash (fecha R-B); `reset:assinante` para testar número novo. Migração 0014
  validada em Postgres 15. **102 testes verdes.**

## Decisões técnicas-chave

- **Isolamento multi-tenant por RLS**, não só por filtro de aplicação.
- **Tenant via GUC** `app.current_assinante_id` setada por transação (`SET LOCAL`),
  dentro de `withTenant(...)`.
- **RLS fail-closed:** sem contexto setado → `NULL` → zero linhas.
- **`DATABASE_URL` com role SEM BYPASSRLS:** `withTenant` faz `SET LOCAL ROLE
  authenticated` para o RLS atuar (a role de conexão do Supabase tem BYPASSRLS).
- **`service_role` isolada** (`src/infra/db/admin.ts`), só back-office/migrações.
- **`assinante_id` denormalizado** em `movimentacoes/documentos/lancamentos`,
  amarrado por **FK composta** a `processos(id, assinante_id)`.
- **Caminho pré-tenant** (`app.resolve_assinante_by_phone`, SECURITY DEFINER,
  retorna só o id) para resolver telefone → assinante antes de haver contexto.
- **`.env.example` é a fonte única de config**; cada adapter valida a própria
  config (vars futuras são opcionais até o adapter ser ativado).
- **Um cérebro por mensagem:** o orquestrador roteia para exatamente um handler;
  se a intenção é ambígua, **pergunta** em vez de adivinhar (rótulos amigáveis,
  nunca nomes internos).
- **Classificação:** via LLM quando configurado (`LlmIntentClassifier`), com
  **fallback determinístico** (palavras-chave) sempre que o LLM falhar ou estiver
  ausente.
- **LLM provider-agnostic:** um `LlmPort`, adapters Anthropic/OpenAI trocáveis por
  `LLM_PROVIDER`. Raw HTTP injetável (testável sem rede). Contexto mínimo ao LLM.
  **`duvida_juridica` nunca responde conteúdo jurídico sem fonte** (RAG futuro).
- **Webhook do WhatsApp: processa-antes-do-ack** (sem perder mensagem) +
  **idempotência com lease** (claim→done só após sucesso; falha libera; crash
  coberto por lease). **Fila durável** (ack rápido + worker assíncrono) é o
  caminho de produção em escala — viável neste host de processo (registrado).
- **Servidor pronto para hospedagem:** escuta `0.0.0.0`/`process.env.PORT`,
  `npm start` em produção; Render/Railway (não Vercel — é servidor persistente).
- **Onboarding determinístico** (sem LLM no controle de fluxo); criação em **trial**
  por ponto único SECURITY DEFINER; consentimento gravado (versão + timestamp);
  **auditoria pré-tenant com telefone em hash** (fecha o R-B).

## PENDENTE (explícito)

- Adapters reais ainda stubs: `payment`, `courts`, `storage`.
  (`whatsapp` e `llm` já são reais.)
- **Validar em produção o fluxo de número novo** (onboarding completo → trial →
  conversar) — guia no README (`reset:assinante` ou 2º número). (O ciclo
  mensagem→LLM→resposta já foi validado em produção.)
- **Onboarding — verificação real da inscrição na OAB** contra fonte externa
  (hoje só valida formato número+UF).
- **WhatsApp:** **download de mídia + Storage** (mídia hoje só placeholder);
  template aprovado na Meta.
- **LLM:** `embed` (fase RAG) e **nenhuma ferramenta de escrita ligada** ainda
  (tool use existe no port); anonimização antes de pôr dado de assinante em prompt.
- **Fila durável do webhook** (ack rápido + worker) — caminho de escala.
- Os três cérebros: NL→SQL (C1), RAG jurídico (C2), tribunais (C3). `pgvector`
  ainda não criado.
- Captura de `entrada`/`saida` no log (hoje `null`): só após termos anonimização.
- Provisionamento Supabase (projeto, pooler, role sem BYPASSRLS, backups/PITR).
- **Pruning** das linhas antigas de `whatsapp_mensagens_processadas` e
  `onboarding_estado` abandonados (operação).

## Próximos passos previstos

1. **Validar em produção o onboarding de número novo** → trial (guia no README).
2. Cérebros: C1 (NL→SQL — dados do escritório) ou C2 (RAG jurídico).
3. Pagamento (Asaas, idempotência de webhook) — tirar do stub.
4. Verificação real da OAB; mídia→Storage; fila durável do webhook.

## Como rodar

Ver [`README.md`](./README.md). Resumo: `npm install` → preencher `.env` (base em
`.env.example`) → banco via Supabase CLI → `npm run dev` → `GET /health`.

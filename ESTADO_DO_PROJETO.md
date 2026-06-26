# Estado do projeto — Assistente Jurídico no WhatsApp

> Documento vivo (convenção C do `CLAUDE.md`). Resumo do estado atual para
> retomar o trabalho a qualquer momento. **Não é changelog** — o histórico está
> no git. Atualizado ao final de cada passo, antes do push.

## Fase atual

- **Fase 1 (Núcleo).** Concluído o **Passo 4 — LLM provider-agnostic + ativação
  em dev**. Próximo: onboarding / criação de assinante (+ auditoria pré-tenant).
  Falta a **validação manual real** do ciclo (deploy + Meta + chave de LLM) — sua
  parte, com o guia no README.

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
  pronto para hospedagem (`0.0.0.0`/`PORT`, `npm start`). **83 testes verdes.**

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

## PENDENTE (explícito)

- Adapters reais ainda stubs: `payment`, `courts`, `storage`.
  (`whatsapp` e `llm` já são reais.)
- **Validação manual real (sua parte):** deploy (Supabase + Render/Railway),
  webhook na Meta, chave de LLM, seed do assinante e troca de mensagens reais —
  guia no README. Sem isso, nada do ciclo ponta-a-ponta foi validado de verdade.
- **WhatsApp:** **download de mídia + Storage** (mídia hoje só placeholder);
  template aprovado na Meta.
- **LLM:** `embed` (fase RAG) e **nenhuma ferramenta de escrita ligada** ainda
  (tool use existe no port); anonimização antes de pôr dado de assinante em prompt.
- **Fila durável do webhook** (ack rápido + worker) — caminho de escala.
- Onboarding / criação de assinante (`createAssinanteOnboarding`).
- **Auditoria pré-tenant:** interações sem `assinante_id` (onboarding/telefone
  desconhecido) **não** são gravadas em `interacoes_log` hoje. Quando o onboarding
  for construído, **retomar** uma tabela de auditoria pré-tenant para o funil de
  onboarding não virar ponto cego.
- Os três cérebros: NL→SQL (C1), RAG jurídico (C2), tribunais (C3). `pgvector`
  ainda não criado.
- Captura de `entrada`/`saida` no log (hoje `null`): só após termos anonimização.
- Provisionamento Supabase (projeto, pooler, role sem BYPASSRLS, backups/PITR).
- **Pruning** das linhas antigas de `whatsapp_mensagens_processadas` (operação).

## Próximos passos previstos

1. **Validação manual real** do ciclo (deploy + Meta + LLM + seed) — guia no README.
2. Onboarding / criação de assinante (máquina de estados) + auditoria pré-tenant.
3. Cérebros (C1 NL→SQL, depois C2 RAG, C3 tribunais).
4. Pagamento (Asaas, idempotência de webhook).

## Como rodar

Ver [`README.md`](./README.md). Resumo: `npm install` → preencher `.env` (base em
`.env.example`) → banco via Supabase CLI → `npm run dev` → `GET /health`.

# Estado do projeto — Assistente Jurídico no WhatsApp

> Documento vivo (convenção C do `CLAUDE.md`). Resumo do estado atual para
> retomar o trabalho a qualquer momento. **Não é changelog** — o histórico está
> no git. Atualizado ao final de cada passo, antes do push.

## Fase atual

- **Fase 1 (Núcleo).** Concluído o **Passo 3 — Adapter real do WhatsApp**.
  Próximo: onboarding / criação de assinante (+ auditoria pré-tenant).

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
  `server`. **70 testes verdes**; migração validada em Postgres 15.

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
- **Classificador determinístico** (palavras-chave, sem acento) por enquanto;
  interface pronta para um classificador via LLM depois.
- **Webhook do WhatsApp: processa-antes-do-ack** (sem perder mensagem) +
  **idempotência com lease** (claim→done só após sucesso; falha libera; crash
  coberto por lease). Fila durável (para ack cedo com segurança) = melhoria futura.

## PENDENTE (explícito)

- Adapters reais ainda stubs: `payment`, `courts`, `llm`, `storage`.
  (`whatsapp` já é real.)
- **WhatsApp — validação manual** (handshake/entrega reais com a Meta, template
  aprovado, URL pública) e **download de mídia + Storage** (mídia hoje só
  placeholder). Passo a passo manual no README.
- **Fila durável do webhook** (permitiria ack cedo) — melhoria futura.
- Onboarding / criação de assinante (`createAssinanteOnboarding`).
- **Auditoria pré-tenant:** interações sem `assinante_id` (onboarding/telefone
  desconhecido) **não** são gravadas em `interacoes_log` hoje. Quando o onboarding
  for construído, **retomar** uma tabela de auditoria pré-tenant para o funil de
  onboarding não virar ponto cego.
- Os três cérebros: NL→SQL (C1), RAG jurídico (C2), tribunais (C3). `pgvector`
  ainda não criado.
- Captura de `entrada`/`saida` no log (hoje `null`): só após termos anonimização.
- Classificador via LLM (interface pronta; impl determinística por enquanto).
- Provisionamento Supabase (projeto, pooler, role sem BYPASSRLS, backups/PITR).
- **Pruning** das linhas antigas de `whatsapp_mensagens_processadas` (operação).

## Próximos passos previstos

1. Onboarding / criação de assinante (máquina de estados) + auditoria pré-tenant.
2. Cérebros (C1 NL→SQL, depois C2 RAG, C3 tribunais).
3. Pagamento (Asaas, idempotência de webhook).
4. Validação manual do WhatsApp com credenciais reais (quando disponíveis).

## Como rodar

Ver [`README.md`](./README.md). Resumo: `npm install` → preencher `.env` (base em
`.env.example`) → banco via Supabase CLI → `npm run dev` → `GET /health`.

# Estado do projeto — Assistente Jurídico no WhatsApp

> Documento vivo (convenção C do `CLAUDE.md`). Resumo do estado atual para
> retomar o trabalho a qualquer momento. **Não é changelog** — o histórico está
> no git. Atualizado ao final de cada passo, antes do push.
>
> Mapa prático de módulos e como testar: [`GUIA.md`](GUIA.md). Roteiros de
> ingestão/sync e validação A/B/C: [`README.md`](README.md).

## Fase atual

- **Fase 2 (Inteligência).** Concluídos o **Passo 8A — Cérebro 2 (RAG jurídico)** e o
  **Passo 8B — fontes pluggáveis + sincronização automática do corpus**: corpus
  LOCAL (Supabase+pgvector) que se mantém fresco por job de sync com a fonte oficial
  (Planalto), detectando novo/alterado/revogado, re-embedando só o que muda, com
  vigência na busca (revogada nunca afirma) — tudo sem afrouxar o antialucinação.
  Falta **rodar a ingestão/sync** (`npm run ingest:corpus` / `sync:corpus`),
  **agendar o Railway Cron** (semanal) e **validar** (CLI `ask:rag` e/ou WhatsApp).
  Próximo: **jurisprudência** (agregador pago, mesma sync) ou **Cérebro 3 (tribunais)**.
  Pendências de validação acumuladas: Cérebro 1, pagamento sandbox (6B), RAG.

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
  validada em Postgres 15.
- **Passo 6A — Onboarding enxuto + trial + porteiro.** Cadastro reduzido a
  **nome + e-mail + consentimento** (OAB/documento removidos do fluxo e nulos no
  banco). Assinatura **`trial` de 3 dias** criada no onboarding (`trial_fim`),
  fonte única de status. **Porteiro fail-closed** no orquestrador, antes de
  rotear: só libera com `ativa` ou trial no prazo; qualquer outra coisa (vencido,
  sem dado, erro de leitura) **bloqueia e desvia para pagamento** (placeholder
  honesto em 6A). `trial:expire` para testar o bloqueio. Migração 0015 validada em
  Postgres 15.
- **Passo 6B — Asaas (sandbox).** `PaymentPort` + `AsaasAdapter` (raw HTTP
  injetável; base v3 oficial por `ASAAS_ENV`; header `access_token`). Handler de
  cobrança **idempotente** (reusa `cobranca_url` ou cria assinatura e envia link;
  `externalReference = assinante_id`). **Webhook `/webhooks/asaas`**:
  autenticado (`asaas-access-token` timing-safe), **idempotente** por id do evento
  (`app.apply_asaas_event`, SECURITY DEFINER), **processa-antes-do-ack**, confirma
  no Asaas antes de ativar; mapa CONFIRMED/RECEIVED→ativa, OVERDUE→inadimplente,
  REFUNDED/DELETED→aguardando_pagamento, desconhecido→ignora. Máquina de estados
  da assinatura; ao ativar, o porteiro do 6A libera. Migração 0016 validada em
  Postgres 15.
- **Passo 7 — Cérebro 1 (dados do escritório).** LLM age via **ações tipadas**
  (tool-use): `criar/listar_compromisso`, `cadastrar/listar/consultar_processo`,
  `ajuda`. **Sem SQL livre** — o código executa queries parametrizadas por tenant.
  **Confirmar-antes-de-gravar** + slot-filling (`acoes_pendentes`); leitura
  **ler-depois-formatar** com **anonimização** (Cliente A/Parte A → reidentifica).
  **Isolamento em 3 camadas** testado com 2 assinantes. Migração 0017 validada em
  Postgres 15.
- **Passo 8A — Cérebro 2 (RAG jurídico, legislação).** Corpus **compartilhado**
  (`corpus_normas`/`corpus_trechos`, pgvector + HNSW, leitura pública sem tenant);
  **`EmbeddingsPort`** dedicado (OpenAI `text-embedding-3-small`/1536; `embed`
  removido do `LlmPort`). `chunkLegislacao` por artigo; pipeline
  **recuperar→gerar(só do recuperado)→validar-citação→recusar** com saída
  estruturada (`orientacao` + `afirmacoes[{texto,fonte}]`) e os 3 tipos A/B/C.
  `duvida_juridica`→C2 (só com LLM+embeddings). Log por tenant grava `cerebro` +
  `fontes`. Ingestão `npm run ingest:corpus` (CF/CC/CPC/CLT/CDC/8.213). Migração
  0018 validada em Postgres+pgvector. **162 testes verdes.**
- **Validação local do RAG sem WhatsApp:** `npm run ask:rag -- "pergunta"`
  (`scripts/ask-rag.ts`) instancia o **mesmo `Cerebro2Handler`** (não é cópia) e
  imprime resposta + fontes validadas. Roteiro de ingestão (com checagem da 0018 e
  query de contagem), idempotência e validação manual A/B/C documentados no README.
- **Passo 8B — fontes pluggáveis + sincronização automática.** `SourcePort`
  provider-agnostic; `PlanaltoLegislacaoSource` (texto consolidado, latin1, detecção
  de revogação defensiva por marcador) + **stub** de jurisprudência (agregador pago) +
  slot `LegalMetadataSource` (LexML/normas) como interface pronta. **Motor `syncCorpus`
  reutilizável** (ingest = sync com `force`): hash SHA-256 → skip/re-embed por norma →
  vigência sticky → resiliência por norma → auditoria `corpus_sync_runs`. Migração
  0019 (validada em Postgres+pgvector). Vigência na busca (revogada fora do allowlist —
  aditivo ao 8A). `scripts/sync-corpus.ts` (`--norma`/`--force`, advisory lock),
  Railway Cron semanal. Decisão de fonte: `docs/spike-8b-fonte-legislacao.md`.
  **182 testes verdes.**

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
- **Onboarding determinístico** (sem LLM no controle de fluxo); cadastro enxuto
  (nome+e-mail); criação em **trial** por ponto único SECURITY DEFINER;
  **auditoria pré-tenant com telefone em hash** (fecha o R-B).
- **Status da assinatura = fonte única de verdade do acesso** na tabela
  `assinaturas` (`status` + `trial_fim`); `assinantes.status` não é usado para gate.
- **Porteiro fail-closed:** bloqueia por padrão; só libera com confirmação positiva
  (ativa ou trial no prazo). Erro de leitura/estado inesperado → bloqueia.
- **Pagamento (Asaas):** gateway é a fonte da verdade (confirma antes de ativar);
  webhook **autenticado + idempotente**, processa-antes-do-ack; cobrança
  idempotente (não duplica link); nunca armazena cartão.
- **Cérebro 1 = ações tipadas, não SQL livre:** o LLM escolhe a ação e extrai
  params (contexto mínimo); o código executa por query parametrizada e escopada.
  **Confirmar-antes-de-gravar**; **anonimização** ao mandar dados de leitura ao LLM.
- **Isolamento (3 camadas):** identidade → tenant; schemas sem `assinante_id`;
  RLS backstop. `acoes_pendentes` por tenant ("sim" só resolve a ação daquele).
- **Corpus do RAG é compartilhado, não-tenant** (oposto do Cérebro 1): leitura
  pública. **Embeddings = provedor próprio** (Anthropic não tem). RAG só **afirma
  com fonte validada**; A/B/C com antialucinação inviolável nas afirmações.
- **Corpus LOCAL sincronizado, não cópia congelada nem API por pergunta:** a
  recuperação semântica é nossa (embeddings); o job de sync dá frescor sem latência/
  indisponibilidade externa no caminho da pergunta. **Fonte = Planalto** (texto
  consolidado + revogação por marcador); LexML/metadados externos ficam como slot
  futuro (spike provou que não entrega vigência/harvest estáveis hoje). Mudança por
  **hash**, revogação **defensiva e sticky**, **resiliência por norma**; revogada
  nunca é citada como vigente. Sync é **back-office** (pool, sem service_role).

## PENDENTE (explícito)

- **Pagamento — validação manual (sandbox):** criar conta/chaves Asaas,
  configurar o webhook (por último), simular pagar→desbloquear. Aprovação dos
  **templates de cobrança na Meta** (avisos fora da janela 24h). Pix Automático
  fino = refinamento futuro.
- Adapters reais ainda stubs: `courts`, `storage`, **fonte de jurisprudência**.
  (`whatsapp`, `llm`, `payment`/Asaas, `embeddings` e **fonte de legislação/Planalto**
  já são reais.)
- **Cérebro 2 — rodar a ingestão/sync e agendar:** `npm run ingest:corpus` (carga) e
  `npm run sync:corpus` (incremental); **agendar o Railway Cron semanal**; **validar**
  sem WhatsApp pela CLI `npm run ask:rag -- "..."` (roteiro A/B/C no README) e depois
  pelo WhatsApp. Confirmar revogação/vigência via `corpus_sync_runs`/`corpus_normas`.
- **Jurisprudência — agregador pago:** plugar adapter real no `SourcePort` (stub
  pronto), respeitando os termos de uso; usa a MESMA sincronização. Ampliar o
  manifesto de legislação conforme necessário.
- **Validar em produção** (acumulado): Cérebro 1, pagamento sandbox (6B), RAG.
- **Onboarding — verificação real da inscrição na OAB** contra fonte externa
  (removida do fluxo obrigatório; pode virar opção futura).
- **WhatsApp:** **download de mídia + Storage** (mídia hoje só placeholder);
  template aprovado na Meta.
- **Fila durável do webhook** (ack rápido + worker) — caminho de escala.
- **Cérebro 3 (tribunais)** — agregador (próximo dos cérebros).
- **Cérebro 1 — incrementos:** custos/honorários, edição/exclusão de registros,
  lembretes proativos (scheduler) a partir de `lembrete_em`.
- Captura de `entrada`/`saida` no log (hoje `null`): só após estender a anonimização.
- Provisionamento Supabase (projeto, pooler, role sem BYPASSRLS, backups/PITR).
- **Pruning** das linhas antigas de `whatsapp_mensagens_processadas` e
  `onboarding_estado` abandonados (operação).
- **Dunning/lembretes** de cobrança (pré-vencimento, suspensão) e conciliação
  periódica com o Asaas — fase de operação do pagamento.

## Próximos passos previstos

1. **Rodar a ingestão/sync do corpus**, **agendar o Railway Cron semanal** e
   **validar o RAG** (dispositivo real cita certo; armadilha recusa; revogada não
   afirma); validar também C1 e pagamento sandbox.
2. **Jurisprudência — agregador pago** plugado no `SourcePort` (mesma sync), ou
   **Cérebro 3 (tribunais)**.
3. Incrementos do Cérebro 1 (honorários/custos, edição, lembretes proativos);
   dunning de cobrança; mídia→Storage.

## Como rodar

Ver [`README.md`](./README.md). Resumo: `npm install` → preencher `.env` (base em
`.env.example`) → banco via Supabase CLI → `npm run dev` → `GET /health`.

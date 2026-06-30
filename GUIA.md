# GUIA — o que já existe e como testar

Mapa prático do sistema atual e como exercitá-lo. **Fonte canônica do estado é o
[`ESTADO_DO_PROJETO.md`](ESTADO_DO_PROJETO.md)**; o roteiro detalhado de ingestão/sync
e de validação A/B/C do RAG está no [`README.md`](README.md). Este guia amarra tudo.

> **Todos os comandos `npm` rodam a partir da RAIZ do projeto** (a pasta onde está o
> `package.json`). O `npm run <script>` já usa a raiz como diretório de trabalho.

---

## Como rodar

**Local (dev):**
```bash
npm install
cp .env.example .env      # preencha (veja a seção de cada módulo)
npm run dev               # sobe o servidor (Fastify) com reload
```
O app **sobe mesmo sem todos os adapters**: cada um só liga se a sua config existir
(senão fica inativo/placeholder). Sem LLM, a classificação cai no fallback por
palavras-chave; sem embeddings, o Cérebro 2 fica placeholder; etc.

**Produção (Railway):** `npm run build` → `npm start` (servidor persistente — não
serverless). A sincronização do corpus é um **Cron Job semanal SEPARADO** rodando
`npm run sync:corpus` (ver README › Sincronização). Banco = Supabase via **pooler**
(porta 6543). Segredos só em variáveis de ambiente; nunca no git.

**Migrações:** `supabase db push` aplica as pendentes (até a `0019`).

---

## Visão geral dos módulos

| Módulo | O que faz (uma linha) |
|---|---|
| **Orquestrador + classificação** | Recebe a mensagem, classifica a intenção (LLM com fallback por palavras-chave) e roteia para **um** cérebro/handler. |
| **WhatsApp (adapter)** | Entrada/saída pelo WhatsApp Cloud API: verifica webhook, faz parse das mensagens, respeita janela de 24h. |
| **Onboarding + trial + porteiro** | Cadastro enxuto determinístico, cria assinatura `trial`; o porteiro libera/bloqueia o acesso (fail-closed). |
| **Pagamento (Asaas)** | Gera cobrança, recebe webhook autenticado e idempotente, ativa o acesso só após confirmação no gateway. |
| **Cérebro 1 — dados do escritório** | Linguagem natural → ação tipada (processos/compromissos) por query escopada ao tenant; confirma antes de gravar. |
| **Cérebro 2 — RAG jurídico + sync** | Responde dúvidas jurídicas só com fonte recuperada do corpus (citação validada); corpus local mantido fresco por sincronização. |

---

## Por módulo: o que faz, onde está, como testar

### 1. Orquestrador + classificação de intenção
- **Faz:** classifica a intenção e chama **um** handler (um-cérebro-por-mensagem); grava log de interação (`cerebro`, `fontes`).
- **Arquivos:** `src/application/orchestrator.ts`, `src/core/orchestration/`, `src/adapters/classifier/`, `src/application/llm-intent-classifier.ts`.
- **Testar — automatizado:** `npm test` → `tests/orchestrator*.test.ts`, `tests/classifier.test.ts`, `tests/llm-classifier.test.ts`, `tests/registry.test.ts` (roteamento, fallback determinístico, gate).
- **Testar — manual:** indireto, via WhatsApp (uma mensagem cai no cérebro certo) ou pela CLI do Cérebro 2 (`ask:rag`).

### 2. WhatsApp (adapter)
- **Faz:** `GET/POST /webhooks/whatsapp` — handshake (verify token) e recepção; parse e envio dentro da janela de 24h; assinatura verificada.
- **Arquivos:** `src/adapters/whatsapp/`, `src/infra/http/` (rotas), `src/adapters/whatsapp/pg-stores.ts` (dedup/janela).
- **Config (.env):** `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
- **Testar — automatizado:** `tests/whatsapp-*.test.ts` (parse, janela, assinatura, processor, rotas).
- **Testar — manual:** **depende do chip** (registrar o número na Meta). Sem chip, não dá para validar ponta a ponta pelo WhatsApp.

### 3. Onboarding enxuto + trial + porteiro
- **Faz:** primeiro contato → cadastro mínimo (nome+e-mail) → assinatura `trial`; porteiro decide acesso (ativa/trial no prazo libera; resto bloqueia).
- **Arquivos:** `src/application/onboarding/`, `src/core/domain/onboarding/`, `src/application/subscription-gate.ts`, migrações `0014`/`0015`.
- **Testar — automatizado:** `tests/onboarding-*.test.ts`, `tests/subscription-gate.test.ts`, `tests/access.test.ts`.
- **Testar — manual (sem chip):** use os scripts admin — `npm run seed:assinante -- <telefone>` (cria assinante de teste), `npm run trial:expire -- <telefone>` (vence o trial para ver o bloqueio), `npm run reset:assinante -- <telefone>` (recomeça do zero). A validação pelo WhatsApp **depende do chip**.

### 4. Pagamento (Asaas)
- **Faz:** cria cobrança/link, recebe `POST /webhooks/asaas` (autenticado + idempotente), confirma no gateway antes de ativar.
- **Arquivos:** `src/adapters/payment/asaas/`, `src/application/payment/`, migrações `0010`/`0016`.
- **Config (.env):** `ASAAS_ENV` (sandbox/production), `ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`.
- **Testar — automatizado:** `tests/asaas-*.test.ts` (adapter, webhook idempotente, handler de pagamento).
- **Testar — manual (sandbox):** criar conta/chaves Asaas sandbox, configurar o webhook, simular `trial:expire` → link → pagar no sandbox → desbloqueio. **Não depende do chip** (o ciclo de pagamento pode ser exercitado no sandbox), mas o aviso proativo de cobrança pelo WhatsApp depende de template aprovado + chip.

### 5. Cérebro 1 — dados do escritório
- **Faz:** linguagem natural → **ação tipada** (cadastrar/listar/consultar processo; criar/listar compromisso) por query parametrizada e **escopada ao tenant**; confirma antes de gravar; anonimiza ao mandar leitura ao LLM.
- **Arquivos:** `src/application/cerebro1/`, `src/adapters/cerebro1/`, `src/core/domain/cerebro1/`, migração `0017`.
- **Config (.env):** `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` (+ `DATABASE_URL`, `SUPABASE_*`).
- **Testar — automatizado:** `tests/cerebro1-*.test.ts` (ações, handler, isolamento por tenant), `tests/anonymization.test.ts`.
- **Testar — manual:** pelo WhatsApp (**depende do chip**): "cadastra o processo …", "lista meus compromissos" — ver a confirmação antes de gravar e o isolamento entre assinantes.

### 6. Cérebro 2 — RAG jurídico + sincronização do corpus
- **Faz:** dúvida jurídica → embed → recupera no corpus (pgvector) → o LLM redige **só do recuperado** → valida citação → senão **recusa**. Três tipos (A afirmação com fonte / B orientação geral / C transparente sem fonte). **Revogada nunca é citada como vigente.** Corpus local mantido fresco por `sync:corpus`.
- **Arquivos:** `src/application/cerebro2/` (handler, `rag-generate`, `sync-corpus`), `src/core/domain/cerebro2/` (`rag`, `chunk-legislacao`, `revogacao`), `src/adapters/source/` (Planalto + stub jurisprudência), `src/adapters/embeddings/`, `src/infra/db/corpus-store.ts`, migrações `0018`/`0019`.
- **Config (.env):** `EMBEDDINGS_PROVIDER=openai`, `EMBEDDINGS_MODEL=text-embedding-3-small`, `EMBEDDINGS_API_KEY`, `RAG_MIN_SIMILARITY=0.3`, `LLM_*`, `DATABASE_URL`, `SUPABASE_*`. (A **ingestão/sync NÃO usa LLM**; só a resposta — `ask:rag`/WhatsApp — usa.)
- **Testar — automatizado:** `tests/rag.test.ts` (A/B/C + antialucinação + revogada fora do allowlist), `tests/cerebro2-handler.test.ts`, `tests/sync-corpus.test.ts` (idempotência, alteração, revogação, resiliência), `tests/source-planalto.test.ts`, `tests/revogacao.test.ts`, `tests/embeddings.test.ts`.
- **Testar — manual SEM chip (CLI):** carregue o corpus e use `npm run ask:rag -- "..."` (mesmo pipeline do handler). Roteiro A/B/C completo no README. **Não depende do chip.**

---

## Comandos úteis (scripts npm)

| Comando | O que faz | Quando usar |
|---|---|---|
| `npm run dev` | Sobe o servidor com reload. | Desenvolvimento local. |
| `npm run build` / `npm start` | Compila / roda o servidor. | Produção (Railway). |
| `npm run typecheck` | `tsc --noEmit` (cobre `src/`). | Antes de commit. |
| `npm run lint` | ESLint (cobre `src/` e `scripts/`). | Antes de commit. |
| `npm test` | Vitest (suíte completa). | Antes de commit / CI. |
| `npm run ingest:corpus` | **Carga inicial** do corpus (sync com `--force`: reconstrói tudo). Não usa LLM. | Primeira carga ou reconstrução total. |
| `npm run sync:corpus` | **Sincronização incremental** (só o que mudou); `-- --norma "…"` (uma) / `-- --force` (tudo). | Manutenção; é o que o Railway Cron roda semanalmente. |
| `npm run ask:rag -- "pergunta"` | Valida o RAG pela CLI (mesmo pipeline do handler). Usa LLM + embeddings. | Validar o Cérebro 2 **sem WhatsApp**. |
| `npm run seed:assinante -- <tel>` | Cria/atualiza um assinante de teste (admin). | Destravar testes sem onboarding. |
| `npm run reset:assinante -- <tel>` | Remove o assinante (cascata) + limpa onboarding. | Refazer o fluxo de número novo. |
| `npm run trial:expire -- <tel>` | Vence o trial (coloca `trial_fim` no passado). | Testar o bloqueio pós-trial. |
| `supabase db push` | Aplica as migrações pendentes. | Antes de usar o corpus/banco novo. |

> Os scripts de OPS (`ingest`/`sync`/`ask:rag`) fazem **pré-checagem do `.env`** e, se
> faltar variável, imprimem **uma mensagem clara** dizendo qual — antes de qualquer
> conexão. Rode-os sempre da raiz do projeto.

---

## Estado de validação (honesto)

| Item | Testes automatizados | Validado em produção | Depende do chip? |
|---|---|---|---|
| Orquestrador + classificação | ✅ | ⚠️ indireto | Para teste real, sim |
| WhatsApp (webhook/parse/janela) | ✅ | ❌ ainda não | **Sim** (registrar número na Meta) |
| Onboarding + trial + porteiro | ✅ | ❌ ainda não | **Sim** (fluxo real é pelo WhatsApp) |
| Pagamento Asaas | ✅ | ❌ falta sandbox | **Não** (ciclo pode rodar no sandbox); aviso proativo sim |
| Cérebro 1 (dados do escritório) | ✅ | ❌ ainda não | **Sim** (uso real é pelo WhatsApp) |
| Cérebro 2 — motor RAG + sync | ✅ | ❌ falta rodar ingestão + validar | **Não** — valida pela CLI `ask:rag` |
| Cérebro 2 — resposta pelo WhatsApp | ✅ (handler) | ❌ ainda não | **Sim** |
| Migração 0019 (sync) | ✅ (Docker pgvector) | ⚠️ aplicar com `db push` | Não |

**Resumo do que dá para validar JÁ, sem chip:** (1) **Cérebro 2** ponta a ponta pela
CLI (`ingest:corpus` → `ask:rag` com A/B/C); (2) **pagamento Asaas no sandbox**
(ciclo `trial:expire` → link → pagar → desbloqueio). **O que depende do chip:**
WhatsApp, onboarding real, Cérebro 1 e a resposta do Cérebro 2 pelo WhatsApp.

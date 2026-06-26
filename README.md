# Assistente Jurídico no WhatsApp — Fundação (Fase 1)

Assessor jurídico pessoal que funciona pelo WhatsApp. Este repositório está na
**Fase 1 (Núcleo)**; este passo entregou **apenas a fundação** — estrutura em
camadas, banco com isolamento por tenant, interfaces (ports) e health check.
**Ainda não há funcionalidades de produto.**

Leia antes de evoluir: [`CLAUDE.md`](./CLAUDE.md), [`PLANEJAMENTO.md`](./PLANEJAMENTO.md)
e as skills em `.claude/skills/`.

## Stack

- **Node 20 LTS + TypeScript** (ESM/NodeNext, `strict`)
- **Fastify** — HTTP (webhooks e rotas)
- **Supabase** (Postgres gerenciado) — migrações via **Supabase CLI**
- **postgres** (porsager) — driver do caminho de tenant, via **pooler Supavisor (transaction)**
- **@supabase/supabase-js** — só no cliente administrativo (`service_role`)
- **Zod** (validação de env), **Vitest** (testes), **ESLint + Prettier**

## Arquitetura (ports & adapters)

```
src/
  core/
    domain/      # entidades (§5 do PLANEJAMENTO) — sem I/O
    ports/       # interfaces de saída: payment, courts, whatsapp, llm, storage
    errors.ts    # NotImplementedError
    domain/intents.ts      # intenções tipadas + rótulos amigáveis + mapa→cérebro
    orchestration/         # contrato de handler (1 por intenção)
    ports/                 # + intent-classifier, interaction-log
  application/
    orchestrator.ts        # porta de entrada (classifica → roteia 1 handler → loga)
    handlers/              # placeholders honestos ("em desenvolvimento")
  adapters/      # stubs dos ports + classifier (real) + interaction-log (real)
    classifier/            # KeywordIntentClassifier (determinístico, sem LLM)
    interaction-log/       # SupabaseInteractionLog (withTenant / pré-tenant)
  infra/
    config/      # carrega e valida envs (fail-fast)
    db/          # pool, withTenant (RLS), admin (service_role), identity (pré-tenant)
    http/        # servidor Fastify + health
  index.ts       # bootstrap
supabase/
  migrations/    # 0001–0013 (schema, RLS, índices, idempotência WhatsApp)
  config.toml
```

O `core/` não importa `infra/` nem adapters. A dependência aponta para dentro.

## Orquestração (porta de entrada)

Cada mensagem passa pelo `Orchestrator` (`src/application/orchestrator.ts`):

1. resolve telefone → `assinante_id` (caminho pré-tenant, `resolveAssinanteByPhone`);
2. telefone **desconhecido** → intenção `onboarding` (sem classificar);
3. classifica a intenção (`KeywordIntentClassifier`, determinístico, **sem LLM**);
4. intenção **ambígua** → **pergunta** em linguagem natural (rótulos amigáveis,
   nunca nomes internos), sem acionar nada;
5. senão **roteia para UM único handler** (um-cérebro-por-mensagem);
6. **registra** a interação.

Os handlers ainda são **placeholders honestos** ("🚧 em desenvolvimento") — a
classificação, o roteamento e o registro são reais e testados. O envio ao
WhatsApp e os cérebros são passos futuros.

**Log de interação:** grava em `interacoes_log` (via `withTenant`) **só quando há
tenant**. Interações **pré-tenant** (onboarding/telefone desconhecido) vão só ao
logger da aplicação, sem persistir e sem dado sensível — a **tabela de auditoria
pré-tenant será retomada no onboarding** (R-B), para o funil não virar ponto cego.

## Webhook do WhatsApp (Cloud API)

Entrada real do produto. Só é registrado se as `WHATSAPP_*` estiverem
configuradas (senão o app sobe com o webhook desabilitado).

- `GET /webhooks/whatsapp` — handshake de verificação (`hub.challenge` /
  `WHATSAPP_VERIFY_TOKEN`).
- `POST /webhooks/whatsapp` — recebe mensagens.

**Garantias (críticas):**
- **Assinatura** `X-Hub-Signature-256` validada (HMAC do corpo cru com
  `WHATSAPP_APP_SECRET`, comparação timing-safe). Inválida → `401`, não processa.
- **Processa ANTES do ack:** o processamento conclui e só então responde `200`;
  falha transitória → `500` e a Meta reentrega (confiabilidade > velocidade).
- **Idempotência com lease** (migração 0013, funções `SECURITY DEFINER`): o claim
  só vira `done` **após sucesso**; falha **libera** o claim; crash no meio é
  coberto pela expiração do lease. Nenhuma mensagem se perde.
- **Janela de 24h** por contato: texto livre só dentro dela; fora, exige template.
- **Mídia** (imagem/documento/áudio/…): responde placeholder honesto; download e
  Storage ficam **PENDENTE**.

### Verificação manual com a Meta (PENDENTE — exige credenciais reais)

Não há como automatizar isto sem credenciais/URL pública. Passo a passo:

1. Preencha no `.env`: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_VERIFY_TOKEN` (string que você escolhe), `WHATSAPP_APP_SECRET`.
2. `npm run dev` e exponha a porta com um túnel (ex.: `cloudflared tunnel --url
   http://localhost:3000` ou `ngrok http 3000`) para obter uma URL HTTPS pública.
3. No painel Meta (WhatsApp > Configuration), configure o **Callback URL**
   (`https://SEU-TUNEL/webhooks/whatsapp`) e o **Verify Token** igual ao do `.env`;
   clique em **Verify and Save** → deve passar no handshake (GET).
4. **Subscribe** ao campo `messages`.
5. Envie uma mensagem real do seu WhatsApp para o número de teste → você deve
   receber a resposta do assistente (placeholder honesto desta fase).
6. **Template:** cadastre/aprovar na Meta um template `lembrete_generico`
   (categoria utilitária, `pt_BR`, 1 parâmetro) antes de usar envio proativo.

## Como rodar

Pré-requisitos: Node 20, e (para o banco) um projeto Supabase ou o Supabase CLI.

```bash
npm install
cp .env.example .env      # preencha os valores (NUNCA commite o .env)

# Banco (escolha um):
supabase start            # Postgres local (requer Docker), ou
supabase link --project-ref <ref> && supabase db push   # aplica migrações no remoto

npm run dev               # sobe a API em http://localhost:3000
curl localhost:3000/health        # {"status":"ok"}
curl localhost:3000/health/ready  # confere o banco (503 se indisponível)
```

Scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `format`, `test`,
`db:start`, `db:reset`, `db:migration`, `db:push`.

## Segurança e isolamento multi-tenant (essencial)

O isolamento entre assinantes é garantido pelo **RLS do Postgres**, não só pelo
filtro na aplicação. Pontos críticos desta fundação:

- **Fail-closed (R1):** `app.current_assinante_id()` retorna `NULL` quando não há
  contexto setado; as políticas então não casam → **zero linhas**. Sem tenant,
  nada é visível.
- **Mesma transação (R2):** todo acesso a dado de tenant passa por
  `withTenant(assinanteId, fn)` (`src/infra/db/tenant.ts`), que abre a transação,
  faz `SET LOCAL` do contexto e **rebaixa para a role `authenticated`** antes de
  rodar as queries.
- **RLS e a role de conexão:** a `DATABASE_URL` conecta numa role com privilégio
  (Supabase: `postgres`, que tem `BYPASSRLS`). Por isso o `withTenant` executa
  `SET LOCAL ROLE authenticated` (sem `BYPASSRLS`) — só assim o RLS atua. **Nunca**
  rode query de tenant fora do `withTenant`.
- **`service_role` isolada:** vive só em `src/infra/db/admin.ts`, para
  back-office/migrações. **Ignora o RLS** — nunca no caminho de um assinante.
- **Consistência do tenant denormalizado (R3):** `movimentacoes`, `documentos` e
  `lancamentos_financeiros` têm `assinante_id` denormalizado, amarrado por **FK
  composta** a `processos(id, assinante_id)` — não pode divergir do processo pai.
- **Caminho pré-tenant (R4):** antes de existir contexto, a resolução
  telefone → `assinante_id` usa `app.resolve_assinante_by_phone()` (SECURITY
  DEFINER, retorna só o id). A criação no onboarding tem um ponto único
  (`src/infra/db/identity.ts`) — **PENDENTE**.
- **Segredos** só em `.env`/secret manager (ver `.gitignore`). **Log imutável** de
  interação (`interacoes_log`) sem dado sensível em claro.

Validado em Postgres 15: fail-closed, isolamento entre dois assinantes, rejeição
de `assinante_id` divergente, resolver por telefone e imutabilidade do log.

## Tabelas (migrações 0001–0012)

`assinantes`, `clientes`, `processos`, `movimentacoes`, `compromissos`,
`documentos`, `lancamentos_financeiros`, `assinaturas` + `pagamento_eventos`
(idempotência por `gateway_event_id`), `interacoes_log` (imutável),
`consentimentos_ia`. Toda tabela de assinante tem RLS habilitado, política por
tenant e índices nas FKs e colunas de filtro.

## PENDENTE (fora do escopo atual)

Nada de mock que finja funcionar — o que não foi implementado está explícito:

- **Adapters externos** (`src/adapters/{payment,courts,llm,storage}`): **stubs que
  lançam `NotImplementedError`**. Implementação real em fases próprias. (Os
  adapters de `classifier`, `interaction-log` e **`whatsapp`** já são reais.)
- **WhatsApp — validação manual e mídia:** o adapter é real, mas o handshake/
  entrega reais com a Meta e o template aprovado exigem **verificação manual**
  (passo a passo acima). **Download de mídia + Storage** ficam PENDENTE.
- **Durabilidade do webhook:** hoje processa-antes-do-ack (sem perda). Uma **fila
  durável** permitiria ack cedo com segurança — melhoria futura.
- **Classificador via LLM**: a interface (`IntentClassifier`) está pronta; hoje
  só o classificador determinístico. Plugar um classificador via `LlmPort` depois.
- **Onboarding / criação de assinante** (`createAssinanteOnboarding` em
  `identity.ts`): ponto único definido, **não implementado**.
- **Auditoria pré-tenant (R-B):** interações sem `assinante_id` não são
  persistidas hoje. Ao construir o onboarding, **retomar** uma tabela de
  auditoria pré-tenant para o funil não virar ponto cego.
- **Captura de `entrada`/`saida` no log**: hoje ficam fora; só após anonimização.
- **Três cérebros**: NL→SQL (C1), RAG jurídico (C2), tribunais (C3) — fases
  seguintes. `pgvector` (corpus do RAG) ainda não criado.
- **Pagamento, lembretes proativos, painel admin** — fases seguintes.
- **Storage**: buckets privados e políticas por tenant — fase de documentos.
- **Provisionamento Supabase**: projeto, pooler, role sem `BYPASSRLS`,
  backups/PITR — operação.

## Convenções

- Camadas: domínio não conhece gateway/agregador/WhatsApp/LLM/Storage; tudo via
  port. Adapters trocáveis.
- Migrações versionadas (Supabase CLI); nada de schema improvisado.
- Erros tratados explicitamente, nunca silenciados.

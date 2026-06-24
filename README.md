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
  application/   # casos de uso — VAZIO nesta fase
  adapters/      # stubs dos ports (lançam NotImplementedError) — PENDENTE
  infra/
    config/      # carrega e valida envs (fail-fast)
    db/          # pool, withTenant (RLS), admin (service_role), identity (pré-tenant)
    http/        # servidor Fastify + health
  index.ts       # bootstrap
supabase/
  migrations/    # 0001–0012 (schema, RLS, índices)
  config.toml
```

O `core/` não importa `infra/` nem adapters. A dependência aponta para dentro.

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

## PENDENTE (fora do escopo desta fundação)

Nada de mock que finja funcionar — o que não foi implementado está explícito:

- **Adapters** (`src/adapters/*`): `payment`, `courts`, `whatsapp`, `llm`,
  `storage` são **stubs que lançam `NotImplementedError`**. Implementação real em
  fases próprias.
- **Onboarding / criação de assinante** (`createAssinanteOnboarding` em
  `identity.ts`): ponto único definido, **não implementado**.
- **Orquestrador e classificação de intenção** — próximo passo.
- **Três cérebros**: NL→SQL (Cérebro 1), RAG jurídico (Cérebro 2), tribunais
  (Cérebro 3) — fases seguintes. `pgvector` (corpus do RAG) ainda não criado.
- **Pagamento, WhatsApp real, lembretes, painel admin** — fases seguintes.
- **Storage**: buckets privados e políticas de acesso por tenant no Storage —
  a definir na fase de documentos.
- **Provisionamento Supabase**: criar projeto, configurar pooler e a role de
  conexão sem `BYPASSRLS`, backups/PITR — operação.

## Convenções

- Camadas: domínio não conhece gateway/agregador/WhatsApp/LLM/Storage; tudo via
  port. Adapters trocáveis.
- Migrações versionadas (Supabase CLI); nada de schema improvisado.
- Erros tratados explicitamente, nunca silenciados.

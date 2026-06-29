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

## LLM (provider-agnostic)

O acesso ao modelo é por um único port (`LlmPort`); o domínio não conhece o
provedor. Dois adapters reais — **Anthropic** e **OpenAI** — selecionados por
config (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`). Trocar de provedor/modelo é
mudar `.env`. A interface já suporta **tool use** e **saída estruturada** (para
os próximos passos); nenhuma ferramenta de escrita está ligada ainda.

- **Classificação de intenção via LLM** (`LlmIntentClassifier`) quando o LLM está
  configurado; **fallback** automático para o `KeywordIntentClassifier` em
  qualquer falha. Sem LLM, o app usa só o keyword.
- **Ajuda/conversa geral** respondida pelo LLM (`ajuda`/`outro`). **`duvida_juridica`
  segue placeholder** — conteúdo jurídico só com fonte/citação (RAG, fase futura).
- **Segurança:** contexto mínimo ao LLM (vai só o texto da mensagem). Provedor
  precisa ter **política de não-treinamento + DPA** (ver `.env.example`).
- **Recomendado em dev:** `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-haiku-4-5`
  (barato e rápido — importa para a latência do webhook, §abaixo).

## Onboarding (cadastro de número novo)

Quando um número **não cadastrado** escreve, o orquestrador roteia para o
`OnboardingHandler` — uma **máquina de estados determinística** (sem LLM
decidindo fluxo), que sobrevive entre mensagens:

`boas-vindas → nome → OAB (número + seccional) → CPF/CNPJ → e-mail → termo de uso
de IA (aceite ativo) → criação do assinante (status trial) → ativação + tutorial`.

- **Validação** de cada campo (OAB com UF válida; CPF/CNPJ com dígito verificador;
  e-mail). **Verificação real da inscrição na OAB contra fonte externa = PENDENTE.**
- **Robustez:** `cancelar`/`recomeçar` reinicia; mensagem fora do roteiro ou só
  mídia → re-explica e permanece na etapa (nunca pula validação).
- **Criação:** ponto único `app.create_assinante_onboarding` (SECURITY DEFINER,
  **sem service_role no caminho da mensagem**) — cria o assinante (trial) e grava
  o consentimento (versão + timestamp) atomicamente. Criado o assinante, a próxima
  mensagem resolve para o tenant e segue o caminho normal (`withTenant`).
- **Auditoria pré-tenant** (`onboarding_eventos`, tabela travada): registra o funil
  com o **telefone em hash** (sem dado sensível em claro) — fecha o ponto cego R-B.
- **Trial:** a conta entra em teste; **pagamento segue stub** (sem cobrança).

## Deploy e ativação (modo desenvolvimento real)

Pronto para hospedagem: o Fastify escuta em `0.0.0.0` e na porta de
`process.env.PORT` (sem host/porta fixos), com `npm run build` + `npm start` para
produção. `/health` e o webhook funcionam atrás do HTTPS/proxy de uma plataforma.

> **Latência do webhook:** o processamento (classificação via LLM + handler geral)
> ocorre **antes do ack** (decisão do Passo 3), e a Meta espera resposta rápida.
> Por isso o caminho é enxuto e o modelo padrão é o Haiku (rápido). Em **escala de
> produção**, o caminho é **fila durável** (ack rápido + processamento assíncrono
> num worker em background) — viável neste host de processo; ver `ESTADO_DO_PROJETO.md`.

### Caminho REAL (URL pública estável)

**1) Provisionar o Supabase (pré-requisito — o app faz fail-fast sem isto):**
   - Crie um projeto em supabase.com.
   - Project Settings › API: copie `SUPABASE_URL`, `SUPABASE_ANON_KEY` e a
     `service_role` (→ `SUPABASE_SERVICE_ROLE_KEY`, **admin only**).
   - Database › Connection pooling (Supavisor, **transaction**, porta 6543): copie
     a string → `DATABASE_URL`. A role **não** pode ter BYPASSRLS (ver
     "RLS e a role de conexão").
   - Rode as migrações `0001–0013` no projeto:
     ```bash
     supabase link --project-ref <REF>
     supabase db push
     ```

**2) Deploy num host de processo persistente (Render ou Railway):**
   - Conecte o repositório do GitHub.
   - Build: `npm install && npm run build`. Start: `npm start`.
   - Configure **todas** as variáveis do `.env.example` na plataforma (Supabase,
     `WHATSAPP_*`, `LLM_*`). **Não** defina `PORT` à mão — a plataforma injeta.
   - Publique → você recebe uma **URL HTTPS estável**.
   - *Por que não Vercel:* este é um **servidor persistente** (mantém webhook e
     pool de conexões), não funções serverless — Render/Railway são o encaixe.

**3) Configurar o webhook na Meta** (Meta for Developers › seu app › WhatsApp):
   - **Callback URL:** `https://SEU-DOMINIO/webhooks/whatsapp`.
   - **Verify token:** o mesmo valor de `WHATSAPP_VERIFY_TOKEN` (string que você
     define; igual nos dois lados). Clique **Verify and Save** (handshake GET).
   - **Subscribe** ao campo `messages`.
   - Em API Setup, **adicione seu número** como destinatário de teste.

**4) Testar o fluxo de NÚMERO NOVO (onboarding):** o onboarding agora é a porta
   de entrada — não precisa de seed para um número novo. De um número **não**
   cadastrado, mande uma mensagem e siga o cadastro até virar assinante trial.
   - Como **seu** número já é assinante (do seed do Passo 4), há dois caminhos para
     re-testar o onboarding em produção:
     - **Reset (recomendado):** `npm run reset:assinante -- 5511999990001`
       (telefone exatamente como o WhatsApp envia em `from`: país+número, sem `+`).
       Remove o assinante e limpa o estado → a próxima mensagem cai no onboarding.
     - **Segundo número:** no painel da Meta (API Setup), adicione outro número
       como destinatário de teste e faça o onboarding por ele.
   - O **seed** (`npm run seed:assinante -- <tel> "Nome"`) continua disponível para
     criar um assinante direto, pulando o onboarding (atalho de dev).

**5) Trocar mensagens reais:** de um número novo, passe pelo onboarding → conta
   trial criada → o ciclo **WhatsApp → orquestrador → LLM → resposta** passa a
   valer. Dúvidas gerais/ajuda vêm do LLM; ações seguem placeholders honestos.

### Caminho rápido (iteração local)

```bash
npm run dev                 # sobe local em http://localhost:$PORT (default 3000)
ngrok http 3000             # URL HTTPS temporária → use como Callback URL na Meta
```
No plano free do ngrok a URL **muda a cada reinício** — refaça o passo 3 quando
trocar. Para algo estável, use o caminho REAL acima.

## Como rodar (local, sem deploy)

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

## Tabelas (migrações 0001–0013)

`assinantes`, `clientes`, `processos`, `movimentacoes`, `compromissos`,
`documentos`, `lancamentos_financeiros`, `assinaturas` + `pagamento_eventos`
(idempotência por `gateway_event_id`), `interacoes_log` (imutável),
`consentimentos_ia`. Toda tabela de assinante tem RLS habilitado, política por
tenant e índices nas FKs e colunas de filtro. A `0013` adiciona as tabelas
travadas do webhook (`whatsapp_mensagens_processadas`, `whatsapp_contatos_janela`)
e a `0014` as do onboarding (`onboarding_estado`, `onboarding_eventos`) —
manipuladas só por funções `SECURITY DEFINER`.

## PENDENTE (fora do escopo atual)

Nada de mock que finja funcionar — o que não foi implementado está explícito:

- **Adapters externos** (`src/adapters/{payment,courts,storage}`): **stubs que
  lançam `NotImplementedError`**. Implementação real em fases próprias. (Os
  adapters de `classifier`, `interaction-log`, `whatsapp` e **`llm`** já são reais.)
- **LLM — embeddings e validação real:** `generate` é real (Anthropic/OpenAI);
  `embed` é **PENDENTE** (fase RAG). Tool use existe no port mas **nenhuma
  ferramenta de escrita está ligada**. O ciclo real com chave/URL pública é
  **validação manual** (guia de deploy acima).
- **WhatsApp — validação manual e mídia:** o adapter é real, mas o handshake/
  entrega reais com a Meta e o template aprovado exigem **verificação manual**
  (passo a passo acima). **Download de mídia + Storage** ficam PENDENTE.
- **Durabilidade do webhook:** hoje processa-antes-do-ack (sem perda). Uma **fila
  durável** permitiria ack cedo com segurança — melhoria futura.
- **Onboarding — verificação real da OAB:** o cadastro valida o **formato** da OAB
  (número + UF), mas a **conferência da inscrição contra fonte externa** é PENDENTE.
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

# Assistente Jurídico no WhatsApp — Fundação (Fase 1)

Assessor jurídico pessoal que funciona pelo WhatsApp. Este repositório está na
**Fase 1 (Núcleo)**; este passo entregou **apenas a fundação** — estrutura em
camadas, banco com isolamento por tenant, interfaces (ports) e health check.
**Ainda não há funcionalidades de produto.**

Leia antes de evoluir: [`CLAUDE.md`](./CLAUDE.md), [`PLANEJAMENTO.md`](./PLANEJAMENTO.md)
e as skills em `.claude/skills/`. Para um **mapa do que já existe e como testar cada
módulo**, veja o [`GUIA.md`](./GUIA.md) (estado canônico em
[`ESTADO_DO_PROJETO.md`](./ESTADO_DO_PROJETO.md)). Para uma visão **em linguagem
simples** (o que o assessor faz, como falar com ele e a visão de produto), veja o
[`MANUAL_DO_ASSESSOR.md`](./MANUAL_DO_ASSESSOR.md).

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

`consulta_dados` e `agendar` são atendidas pelo **Cérebro 1** (abaixo, quando o LLM
está configurado); `duvida_juridica` (Cérebro 2/RAG) e `consulta_andamento`
(Cérebro 3) seguem **placeholders honestos**. Antes de rotear, o **porteiro**
(trial/pagamento) já decidiu se o usuário tem acesso.

**Log de interação:** grava em `interacoes_log` (via `withTenant`) **só quando há
tenant**. Interações **pré-tenant** (onboarding/telefone desconhecido) vão só ao
logger da aplicação, sem persistir e sem dado sensível — a **tabela de auditoria
pré-tenant será retomada no onboarding** (R-B), para o funil não virar ponto cego.

## Cérebro 1 — dados do escritório (NL → ações)

A primeira vez que o LLM **age** sobre os dados do próprio usuário. Princípio:
**"painel de botões", não SQL livre** — o LLM escolhe uma **ação** (tool-use) e
extrai parâmetros; o **código executa** por query parametrizada e tipada.

- **Ações:** `criar_compromisso`, `listar_compromissos`, `editar_compromisso`,
  `cancelar_compromisso`, `cadastrar_processo`, `listar_processos`,
  `consultar_processo`, `editar_processo`, `arquivar_processo`, `ajuda_assessor`
  (registro tipado, fácil de expandir — financeiro/honorários virão depois).
- **Editar/remover (Passo 11):** o alvo é resolvido por um **seletor** (processo/
  tipo/dia, ou CNJ/cliente/parte) **escopado por tenant**; se casar com vários, o
  assessor **pergunta qual** (lista numerada) — **nunca adivinha**; se nenhum, avisa.
  A confirmação mostra o **registro real** (reforçada na remoção: "⚠️ vou REMOVER…,
  definitivo"). **Remarcar recalcula os lembretes** (24h/1h da nova data, nada no
  passado) e descarta a marcação antiga. Compromisso é removido de fato; processo é
  **arquivado** (reversível, mantém histórico) — sem exclusão destrutiva.
- **Seleção (1 chamada):** contexto mínimo ao LLM — só a mensagem + o menu de ações
  + a data/hora atual (para datas relativas). **Nenhuma linha do banco** nessa chamada.
- **Confirmar antes de gravar:** toda escrita mostra o que será salvo em linguagem
  natural ("Confirmar: audiência em 2 de julho às 14h — …? Responda *SIM*") e só
  grava após o "sim" (estado em `acoes_pendentes`, por tenant). Leitura não confirma.
- **Slot-filling:** se faltar um dado, pergunta **só o que falta** e completa; nunca
  inventa valor. Pedido fora de escopo → resposta útil (não "não entendi" seco).
- **Validação:** data válida, CNJ de 20 dígitos, campos obrigatórios → senão pede correção.
- **Leitura (ler-depois-formatar):** o código roda a query; processos (com nome de
  cliente/parte) vão ao LLM **anonimizados** ("Cliente A", "Parte A") e a resposta é
  **reidentificada** localmente. Falha do LLM → formatação em código (sem erro técnico).

### Isolamento entre usuários (três camadas)
1. `assinante_id` vem **sempre da identidade** (telefone), nunca do texto/params do LLM.
2. Os **schemas das ações não têm** campo de tenant — o código injeta o `assinante_id`.
3. **RLS** do Supabase como backstop (`withTenant`/`authenticated`, sem `service_role`).
A `acoes_pendentes` é por tenant: o "sim" só resolve a ação **daquele** assinante.
Testado com dois assinantes (A nunca lê/lista/consulta nem confirma ação de B).

## Cérebro 2 — RAG jurídico (recuperar → citar → validar → recusar)

O diferencial de confiabilidade: a IA só afirma o que **recupera** de um corpus de
legislação real, **com citação validada**; sem fonte, **recusa**. Atende
`duvida_juridica` (só com **LLM + embeddings** configurados; senão, placeholder).

- **Corpus COMPARTILHADO** (o oposto do Cérebro 1): `corpus_normas`/`corpus_trechos`
  são referência pública, **sem RLS por tenant** (leitura pública). pgvector + HNSW;
  embeddings OpenAI `text-embedding-3-small` (1536). O **log de interação** segue por
  tenant (com `cerebro` e `fontes citadas`).
- **Pipeline:** `embed(pergunta)` → busca vetorial → trechos **pertinentes** (acima
  de `RAG_MIN_SIMILARITY`) → o LLM redige com **saída estruturada** → fronteira
  determinística valida e compõe.
- **Três tipos de pedido** (antialucinação inviolável para afirmações):
  - **(A) afirmação jurídica** (prazo, artigo, base legal): só sai com `fonte`
    validada contra o recuperado; citação fabricada pelo LLM é **descartada**.
  - **(B) orientação geral** (o que é uma contestação, que provas importam): a IA
    ajuda, **rotulado como apoio**, sem citar dispositivo concreto (isso seria
    afirmação → exige fonte).
  - **(C) sem fonte:** resposta **transparente e útil** — diz o que não pode afirmar,
    oferece orientação geral e **dispositivos próximos que existem** no acervo, e como
    conferir na fonte. Nunca "não encontrei" seco; nunca citação fabricada.
- **Transparência:** a resposta sempre separa **citação real** (com fonte do corpus)
  de **orientação geral**; nunca apresenta norma como vigente sem o status do corpus.

### Ingestão do corpus (passo de OPS — você roda)

Carrega a legislação real no corpus do RAG. **Roteiro de ponta a ponta:**

**1. Pré-requisito — migrações `0018` + `0019` aplicadas** (`0018` cria `pgvector` +
`corpus_normas`/`corpus_trechos`; `0019` adiciona os metadados de sync e
`corpus_sync_runs`). Aplique e confirme que as tabelas/colunas existem:

```bash
supabase db push        # aplica as migrações pendentes (entre elas 0018 e 0019)
```

Confirmação rápida (SQL Editor do Supabase ou `psql`):

```sql
select to_regclass('public.corpus_normas')  as normas,
       to_regclass('public.corpus_trechos') as trechos,
       to_regclass('public.corpus_sync_runs') as sync_runs;  -- todas != null
select extname from pg_extension where extname = 'vector';    -- 1 linha
```

**2. Variáveis no `.env`** (a ingestão lê do ambiente; nada vai para o git):

```ini
# Embeddings (provedor próprio — a Anthropic não tem)
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_MODEL=text-embedding-3-small      # 1536 dims (a coluna é vector(1536))
EMBEDDINGS_API_KEY=sk-...                     # OpenAI Platform
RAG_MIN_SIMILARITY=0.3                         # limiar p/ um trecho virar "fonte"

# Banco — aponte para o Supabase via POOLER (modo transaction, porta 6543)
DATABASE_URL=postgresql://USER.PROJECT-ref:PASSWORD@aws-REGION.pooler.supabase.com:6543/postgres
```

> A ingestão **grava** — pode usar a role do pooler (passa pelo RLS; a política de
> escrita do corpus é de back-office). Não use `service_role` no caminho de assinante.

**3. Rodar:**

```bash
npm run ingest:corpus
```

A ingestão é o **mesmo motor** da sincronização (`syncCorpus`), aqui com `--force`
(reconstrói todas). Escopo curado = `src/adapters/source/legislacao/manifest.ts`
(**6 normas** — CF/88, CC, CPC, CLT, CDC, Lei 8.213/91). Para cada norma: baixa o
texto oficial do Planalto → **chunking por artigo** → embeda (lotes de 64) → grava.
Ordem de grandeza: **alguns milhares de trechos** no total (um artigo ≈ um trecho);
poucos minutos; **poucos centavos** de embeddings (uma vez). Termina com uma linha de
resumo: `Ingestão (sucesso): verificadas=6 atualizadas=6 revogadas=0 avisos/erros=0`.

**4. Conferir no banco** que os trechos foram gravados **com embedding**:

```sql
select n.identificador,
       count(t.id)                                  as trechos,
       count(t.embedding)                           as com_embedding
from corpus_normas n
left join corpus_trechos t on t.norma_id = n.id
group by n.identificador
order by n.identificador;
-- trechos > 0 e trechos == com_embedding para cada norma
```

### Sincronização automática do corpus (8B)

O corpus é **local** (Supabase + pgvector) e se mantém **fresco** por um job de
sincronização com a fonte oficial — sem depender de API externa por pergunta (frescor
+ velocidade + garantias de citação). Decisão de fonte registrada em
`docs/spike-8b-fonte-legislacao.md` (Planalto como fonte; LexML não entrega vigência
legível por máquina nem harvest incremental de forma estável — o slot de metadados
externos fica pronto para o futuro).

**Como funciona** (`npm run sync:corpus`, mesmo motor da ingestão, sem `--force`):
para cada norma do escopo curado → baixa o texto → normaliza → **hash SHA-256** →
compara com o armazenado (**igual = pula**, idempotente; **diferente/nova = re-chunk
+ re-embed só dela**) → detecta **revogação** por marcador textual (defensivo: só
marca revogada com sinal forte; nunca ressuscita em silêncio) → grava
`ultima_sincronizacao`/`fonte_hash`/`revogada_em`. **Resiliente:** falha de uma norma
(ex.: fonte offline) **não corrompe** o corpus existente nem aborta as demais; o erro
fica no `corpus_sync_runs` e é re-tentado na próxima cadência. Serializado por
advisory lock (não roda concorrente). Back-office: grava via pool, **sem
`service_role`**; o caminho de mensagem do assinante não é afetado.

**Cadência — Railway Cron Job (semanal).** Configure no Railway um **Cron Job**
(processo SEPARADO do web server) com schedule semanal (ex.: `0 4 * * 1`) e comando:

```bash
npm run sync:corpus
```

Pause sem remover o agendamento com `CORPUS_SYNC_ENABLED=false`. (`CORPUS_SYNC_CRON`
no `.env.example` é só documentação da cadência; quem agenda é o Railway.) Legislação
muda devagar → semanal basta; **jurisprudência** muda rápido e virá pelo agregador
pago (stub pronto), na cadência dele.

**Sync manual / por norma:**

```bash
npm run sync:corpus                              # todas (incremental)
npm run sync:corpus -- --norma "Lei nº 8.078/1990"   # só uma
npm run sync:corpus -- --force                   # reconstrói tudo (= ingestão)
```

**Confirmar que uma norma foi atualizada/revogada** (SQL):

```sql
-- estado de sync por norma
select identificador, vigencia_status, ultima_sincronizacao, revogada_em
from corpus_normas order by identificador;

-- último run (auditoria): contagens + avisos/erros
select status, normas_verificadas, normas_atualizadas, normas_revogadas, erros,
       iniciado_em, finalizado_em
from corpus_sync_runs order by iniciado_em desc limit 1;
```

Uma norma **vigente** tem `vigencia_status='vigente'` e `revogada_em` nulo; uma
**revogada** tem `vigencia_status='revogada'` + `revogada_em` preenchido e **nunca**
é citada como base vigente (no máximo aparece como aviso "REVOGADA").

### Idempotência e nova norma

Rodar a sincronização (ou a ingestão) duas vezes **sem mudança na fonte = nenhum
re-embed e nenhuma duplicação** (skip por `fonte_hash` igual; e `replaceTrechos`
substitui de forma atômica quando muda). **Adicionar uma norma:** acrescente um item
em `src/adapters/source/legislacao/manifest.ts` (`sigla`, `titulo`, `identificador`
único, `fonteUrl` oficial, `dataPublicacao`) e rode `npm run sync:corpus` — as já
presentes são puladas (hash igual) e **só a nova entra**.

## Memória de conversa (Passo 9)

O assessor mantém o **fio do assunto** entre mensagens: resolve referências como
*"e o prazo dela?"* ou *"e o artigo seguinte?"* e percebe quando o usuário **muda de
assunto**. Princípios:

- **A memória interpreta, NUNCA é fonte.** Ela só ajuda a montar a consulta; a
  resposta jurídica continua vindo do corpus, com **citação validada** — sem fonte,
  recusa. (Demonstrado: ao pedir "o artigo seguinte" sem o texto no acervo, o sistema
  **recusa** em vez de inventar.)
- **Privacidade por construção:** guarda só **intenção + citações públicas** (ex.:
  `art. 335 do CPC`) por assinante — **nenhum texto livre do usuário**, logo sem PII.
- **Isolamento por tenant** (RLS force), **janela curta** (`CONVERSA_MEMORIA_TURNOS`,
  6) e **expiração por silêncio** (`CONVERSA_MEMORIA_TTL_MIN`, 30 min). Liga/desliga
  por `CONVERSA_MEMORIA_ENABLED`.
- **Heurística que falha para o lado seguro:** só injeta contexto quando a mensagem é
  follow-up curto/anafórico **sem** norma própria; se nomeia outra lei (ex.: *"e na
  CLT…"*), trata como **novo foco** — nunca contamina com o assunto anterior.

### Validar o RAG pela CLI (sem WhatsApp)

`scripts/ask-rag.ts` roda **exatamente o mesmo pipeline** do `Cerebro2Handler` (não é
cópia: instancia o próprio handler com as mesmas dependências do servidor) — embed →
recuperar → gerar → validar citação → recusar — e imprime a resposta + as **fontes
validadas**. Precisa de `LLM_*`, `EMBEDDINGS_*` e `DATABASE_URL`:

```bash
# pergunta isolada (sem memória)
npm run ask:rag -- "qual o prazo de contestação no CPC?"

# modo conversa (testa a MEMÓRIA — continuidade e mudança de assunto)
npm run ask:rag -- --conversa "qual o prazo de contestação no CPC?" "e o artigo seguinte?"
npm run ask:rag -- --conversa "qual o prazo de contestação no CPC?" "e na CLT, qual a duração das férias?"
```

#### Roteiro de validação manual (após a ingestão)

Rode cada exemplo e compare com o **resultado esperado**:

**(A) Afirmação com fonte** — deve **citar o artigo real e correto**:

```bash
npm run ask:rag -- "qual o prazo para contestação no processo civil?"
npm run ask:rag -- "o consumidor tem direito de desistir de compra feita pela internet?"
npm run ask:rag -- "qual a carência para auxílio-doença na Lei 8.213/91?"
```

- Esperado (A): resposta no bloco **📚 Com base no acervo**, com **Fontes** listando o
  dispositivo certo — ex.: prazo de contestação → **art. 335 do CPC** (15 dias);
  arrependimento do consumidor → **art. 49 do CDC** (7 dias); carência → **art. 25 da
  Lei 8.213/91**. As fontes impressas batem com o que o texto afirma. Nenhuma citação
  fora da lista de fontes (citação fabricada é **descartada** na fronteira).

**(B) Orientação geral** — útil, **rotulada como orientação**, sem inventar dispositivo:

```bash
npm run ask:rag -- "o que eu costumo precisar para organizar um caso trabalhista?"
```

- Esperado (B): resposta marcada como **orientação geral** (apoio), conceitual
  (documentos, provas, prazos a observar), **sem** afirmar "art. X" como base legal.
  `Fontes citadas: nenhuma`. Se mencionar um dispositivo concreto, ele vem do acervo
  com citação ou remete a conferir na fonte.

**(C) Sem fonte / armadilha** — **recusa transparente**, sem inventar número:

```bash
npm run ask:rag -- "o que diz a Súmula 999 do STF sobre home office?"
npm run ask:rag -- "qual o artigo da Lei 99.999/2030 sobre criptomoedas?"
```

- Esperado (C): **não** afirma o dispositivo inexistente nem inventa número/súmula. Diz
  com transparência o que **não pode** confirmar, oferece **orientação geral** e, se
  houver, **dispositivos próximos que existem** no acervo, sugerindo conferir na fonte.
  `Fontes citadas: nenhuma`. Nunca um "não encontrei" seco.

Depois (quando houver chip), a mesma validação A/B/C vale **pelo WhatsApp**.

## Lembrete proativo (Passo 10)

Um **job agendado** avisa o advogado **antes** de audiências/prazos. Os instantes
(24h e 1h antes) já são gravados pelo Cérebro 1 em `compromissos.lembrete_em`; este
job faz o **disparo**.

- **Job separado** (Railway Cron a cada **15 min**): `npm run send:lembretes`. Schedule
  sugerido: `*/15 * * * *`. Liga/desliga por `LEMBRETES_ENABLED`.
- **Seleção** (`app.lembretes_due`, SECURITY DEFINER, sem `service_role`): pega os
  devidos na janela **[agora − `LEMBRETES_GRACE_MIN`, agora]**, **ignorando** futuros,
  compromissos **já passados** e os **já enviados**.
- **Idempotência:** marca como enviado **só após sucesso** (`app.marcar_lembrete_enviado`,
  `unique (compromisso_id, lembrete_em)`); falha no envio **não marca** → re-tenta. Rodar
  duas vezes = **1 envio**. Advisory lock serializa as rodadas.
- **Fuso:** comparação em **UTC**; o texto exibe a hora em **`LEMBRETES_TIMEZONE`**
  (BRT) — "amanhã às 14:00".
- **Proativo → TEMPLATE:** envia pelo `lembrete_generico`. **A aprovação do template na
  Meta e o envio real pelo WhatsApp são validação manual PENDENTE (dependem do chip);**
  o código já está pronto para o template.
- **Resiliência:** falha de um lembrete não aborta os outros nem o marca.

### Dry-run (validar a lógica SEM chip)

Roda **a mesma seleção e composição** do envio real, só que **não envia e NÃO marca**
nada (pode rodar quantas vezes quiser) e **lista** o que enviaria. Precisa só de
`SUPABASE_*` + `DATABASE_URL` (não precisa de WhatsApp):

```bash
# o que seria enviado AGORA
npm run send:lembretes -- --dry-run

# simulando um "agora" (ex.: como se já fossem 16:05 UTC de 01/07) — para testar a
# seleção sem esperar o horário real chegar
npm run send:lembretes -- --dry-run --now "2026-07-01T16:05:00Z"
```

Saída: para cada lembrete devido, **para quem** iria, **qual compromisso**, **o
horário de disparo** e o **texto final** (em horário de Brasília).

## Gestão de documentos (Passo 12A)

Primeira vez que o assessor lida com **arquivos**. Ao receber um documento, decide
(com o usuário) se **resume, salva ou ambos**; e **sempre que salva** extrai e guarda
**informações-chave** (tipo, partes, números, datas, assunto, resumo) — é o que vai
permitir **encontrá-lo depois** (a busca é o 12B).

- **Decisão:** legenda com ação ("resuma", "salva", "resume e guarda") → executa
  direto; sem ação → pergunta **1 Resumir / 2 Salvar / 3 Resumir e salvar** (estado
  por tenant = a linha em `aguardando_decisao`); resposta inválida → re-pergunta. Só
  resumir = mostra e **não guarda** (apaga o staging).
- **Formatos:** `.txt`, **PDF com texto**, `.docx`. **PDF-imagem/foto** → avisa que não
  dá para ler (OCR futuro) e, se guardar, marca `sem_texto` e avisa que o documento
  **não poderá ser achado por conteúdo** (só por nome/data). Planilhas: fora por ora.
- **Informações-chave:** extraídas por LLM, **sem inventar** (campo ausente fica
  vazio); guardadas em `chaves` (jsonb) + `busca_texto` (para o 12B).
- **Resumo:** documento longo é resumido em partes e consolidado (map-reduce).
- **Armazenamento (sigilo):** arquivo em **bucket privado** no caminho
  `${assinanteId}/${docId}/…` (prefixo da identidade); metadados na tabela
  `documentos` (**RLS force**, via `withTenant`). A chave privilegiada do Storage só
  toca o **arquivo**; **de quem é o documento** é decidido na tabela (RLS) — a URL
  assinada (curta) só é gerada para refs do próprio dono.
- **Vínculo a processo:** "guarda no processo <CNJ>" resolve por tenant; inexistente
  → guarda solto, com aviso.

### Testar pela CLI (sem chip)

Pré-requisitos: bucket privado `documentos` criado no Supabase; `.env` com
`SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `LLM_*`; um assinante de
teste (`npm run seed:assinante -- <telefone>`).

```bash
# resume e guarda (default) um arquivo local, como o dono <telefone>
npm run doc:process -- ./contrato.pdf --telefone 5511999990001
# só resumir (não guarda)
npm run doc:process -- ./peticao.docx --telefone 5511999990001 --acao resumir
# salvar vinculando a um processo já cadastrado
npm run doc:process -- ./intimacao.pdf --telefone 5511999990001 --acao salvar --processo 0001234-55.2024.8.26.0100
```

> O **download da mídia do WhatsApp** (receber o arquivo pelo Zap) depende do chip —
> o código está pronto (`MediaDownloader`), validação manual pendente.

## Busca de documentos (Passo 12B)

Encontrar um documento guardado **sem lembrar o nome do arquivo** — por referência
**exata** (número de protocolo/processo, nome de pessoa, trecho) **ou vaga** (assunto,
"aquele contrato de aluguel"). A busca **acha e lista** (devolve o documento com link);
não re-resume nem reprocessa.

- **Duas buscas combinadas:**
  1. **Exata** — `ILIKE` dos termos da referência em `busca_texto`/`nome` (casa
     fragmentos de número, ex.: parte de um protocolo).
  2. **Semântica** — embedding da referência comparado aos embeddings dos documentos
     **do próprio assinante** (pgvector, distância de cosseno). Exige `EMBEDDINGS_*`;
     sem ela, funciona só a exata.
  Combina com **prioridade da exata**, deduplica e devolve o **Top N**
  (`DOCUMENTOS_BUSCA_TOPN`, default 5). A semântica tem **piso de similaridade**
  (`DOCUMENTOS_BUSCA_MIN_SIM`) para não trazer "qualquer coisa parecida".
- **Embedding do documento:** gerado do `busca_texto` **na guarda** (12A). Documento
  escaneado/sem texto fica **sem embedding** (achável só pela exata) e entra na contagem
  de **ponto cego**, avisada nos resultados. Backfill de acervo antigo: `doc:reindex`.
- **Isolamento (sigilo):** o `assinante_id` vem **sempre da identidade** (telefone
  autenticado), nunca do texto/IA. O filtro `where assinante_id = <identidade>` faz parte
  da **própria query** (exata **e** semântica), aplicado **antes** do `ILIKE`/operador
  vetorial — o vetor de outro assinante **nunca** é sequer comparado. **RLS force** é o
  backstop. A **URL assinada** só é gerada para documentos que vieram da query escopada
  (dono confirmado); nunca a partir de um `id`/`storage_ref` solto.

### Testar pela CLI (sem chip)

Pré-requisitos: como no 12A (bucket privado, `.env`, assinante de teste). Para a
**semântica**, também `EMBEDDINGS_*`. Antes da primeira busca em acervo já existente,
rode o backfill de embeddings:

```bash
# (1) Backfill: gera o embedding dos documentos que ainda não têm (idempotente).
npm run doc:reindex
# ou em lotes maiores:
npm run doc:reindex -- --lote 50

# (2) Buscar como o dono <telefone> (roda o handler real: exata + semântica + link).
npm run doc:search -- --telefone 5511999990001 "contrato de aluguel do João"
npm run doc:search -- --telefone 5511999990001 "5551"   # fragmento de protocolo
```

> **Validar o isolamento sem chip:** processe documentos para **dois** assinantes
> (`doc:process` com telefones diferentes) e rode `doc:search` com cada telefone — cada
> um só enxerga os próprios documentos; a referência de um **nunca** traz o do outro.

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

## Onboarding (cadastro enxuto) + trial de 3 dias

Barreira de entrada baixa: serve para advogados, estudantes e curiosos. Quando um
número **não cadastrado** escreve, o `OnboardingHandler` (máquina de estados
determinística, sobrevive entre mensagens) conduz:

`intro acolhedora → nome → e-mail → termo de uso de IA (aceite em 1 toque) →
criação do assinante (trial 3 dias) → boas-vindas`.

- **Só pede nome e e-mail** (e-mail validado; re-pergunta se inválido). O telefone
  do WhatsApp é o identificador. **Sem OAB e sem CPF/CNPJ** no fluxo (colunas
  agora nulas; informar OAB depois fica para o futuro).
- **Robustez:** `cancelar`/`recomeçar` reinicia; mensagem fora do roteiro ou só
  mídia → re-explica e permanece na etapa (nunca pula validação).
- **Criação:** ponto único `app.create_assinante_onboarding` (SECURITY DEFINER,
  **sem service_role no caminho da mensagem**) — cria o assinante, grava o
  consentimento (versão + timestamp) e cria a **assinatura `trial` com
  `trial_fim = now() + 3 dias`**, atomicamente.
- **Auditoria pré-tenant** (`onboarding_eventos`, tabela travada): funil com o
  **telefone em hash** (sem dado sensível em claro).

### Porteiro de acesso (bloqueio após o trial) — fail-closed

A **cada mensagem** de um assinante, o orquestrador consulta o porteiro **antes**
de rotear (lê `status` + `trial_fim` da `assinaturas` via `withTenant`):

- **Libera** só com confirmação positiva: assinatura `ativa` **ou** `trial` dentro
  do prazo.
- **Bloqueia** (e desvia TUDO para o fluxo de pagamento) em qualquer outro caso —
  trial vencido, `trial_fim` nulo, sem assinatura, status inesperado, **ou erro ao
  ler** (mesmo princípio do RLS fail-closed). Onboarding e o próprio pagamento
  seguem acessíveis.
- Bloqueado → o handler de pagamento gera/reenvia o **link real do Asaas**
  (idempotente; ver abaixo). Sem Asaas configurado, cai num placeholder honesto.

## Pagamento (Asaas, sandbox) — cobrança e desbloqueio

Quando o trial vence, o porteiro desvia para o `AsaasPaymentHandler`:
- **Idempotente:** se já há cobrança aberta (`cobranca_url`), reenvia o **mesmo**
  link; senão cria a assinatura no Asaas (Pix/cartão; `externalReference =
  assinante_id`), salva o link e transita `trial → aguardando_pagamento`.
- **Webhook `/webhooks/asaas`** (processa-antes-do-ack, como o do WhatsApp):
  autenticado pelo header **`asaas-access-token`** (timing-safe vs
  `ASAAS_WEBHOOK_SECRET`), **idempotente** por id do evento (`pagamento_eventos`,
  via `SECURITY DEFINER`), **confirma o status no Asaas antes de ativar** (nunca
  confia no payload). Mapeamento: `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED → ativa`
  (**desbloqueia**); `PAYMENT_OVERDUE → inadimplente`; `PAYMENT_REFUNDED`/
  `PAYMENT_DELETED → aguardando_pagamento`; evento desconhecido → ignora com
  segurança (**nunca ativa**).
- **Máquina de estados:** `trial → aguardando_pagamento → ativa → inadimplente →
  suspensa → cancelada`; pagamento confirmado reativa → `ativa` e o porteiro
  volta a liberar.
- **Segurança:** nunca armazena dado de cartão (tokenização/checkout do Asaas);
  segredos só em variáveis de ambiente; `service_role` fora do caminho da mensagem.
- **PENDENTE (validação manual):** conta/checagem real no Asaas e **aprovação dos
  templates de cobrança na Meta** (avisos fora da janela de 24h). Pix Automático
  fino (autorização recorrente no banco) é refinamento futuro; hoje o checkout
  oferece Pix e cartão.

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

**6) Testar o trial de 3 dias e o BLOQUEIO** (sem esperar 3 dias):
   - Aplique as migrações no Supabase: `supabase db push` (inclui `0015` e `0016`).
   - Faça o onboarding (passo 4) → conta em trial → converse normalmente.
   - **Force o fim do trial:** `npm run trial:expire -- 5511999990001` — coloca
     `trial_fim` no passado. A **próxima mensagem** é bloqueada e desviada para o
     fluxo de pagamento (link do Asaas se configurado; senão placeholder honesto).
   - Para voltar a testar do zero: `npm run reset:assinante -- <telefone>`.

### Configurar o Asaas (sandbox) — fazer por ÚLTIMO, após o deploy

A rota `/webhooks/asaas` só existe depois deste passo no ar. Ordem:

1. **Conta sandbox:** crie em `https://sandbox.asaas.com`. Em *Configurações ›
   Integrações › Chave de API*, copie a chave (sandbox começa com `$aact_hmlg_`).
2. **Variáveis no Railway:** `ASAAS_ENV=sandbox`, `ASAAS_API_KEY=<a chave>`,
   `ASAAS_WEBHOOK_SECRET=<um token que você inventa>`. Faça o redeploy → o log
   mostra "Asaas habilitado (sandbox)".
3. **Webhook no Asaas** (*Configurações › Notificações/Webhooks › Adicionar*):
   - **Nome:** livre (ex.: "Assessor Juridico - Pagamentos").
   - **URL:** `https://SEU-DOMINIO/webhooks/asaas`.
   - **Versão da API:** `v3` (não muda depois).
   - **Token de autenticação:** **exatamente** o mesmo valor de
     `ASAAS_WEBHOOK_SECRET` (vira o header `asaas-access-token`).
   - **Tipo de envio:** Sequencial. **Fila de sincronização:** ativada.
   - **Eventos:** marque só `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
     `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED` (e os `SUBSCRIPTION_*` se quiser sincronia).
4. **Simulação ponta a ponta (sandbox):** número novo → onboarding → trial →
   `npm run trial:expire -- <tel>` → mande uma mensagem → **recebe o link** →
   pague no checkout sandbox → o Asaas dispara `PAYMENT_CONFIRMED` →
   `/webhooks/asaas` confirma e ativa → mande outra mensagem → **acesso liberado**.

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

## Tabelas (migrações 0001–0023)

`assinantes`, `clientes`, `processos`, `movimentacoes`, `compromissos`,
`documentos`, `lancamentos_financeiros`, `assinaturas` + `pagamento_eventos`
(idempotência por `gateway_event_id`), `interacoes_log` (imutável),
`consentimentos_ia`. Toda tabela de assinante tem RLS habilitado, política por
tenant e índices nas FKs e colunas de filtro. A `0013` adiciona as tabelas
travadas do webhook (`whatsapp_mensagens_processadas`, `whatsapp_contatos_janela`)
e a `0014` as do onboarding (`onboarding_estado`, `onboarding_eventos`) —
manipuladas só por funções `SECURITY DEFINER`. A `0015` torna OAB/documento
opcionais e cria a assinatura `trial` (com `trial_fim`) no cadastro. A `0016`
adiciona a cobrança (`cobranca_url`, `gateway_customer_id`) e a aplicação
idempotente de eventos do Asaas (`app.apply_asaas_event`). A `0017` adiciona
`compromissos.descricao` e `acoes_pendentes` (confirmar-antes-de-gravar, por tenant).
A `0018` cria o **corpus compartilhado** do RAG (`corpus_normas`/`corpus_trechos`,
pgvector + HNSW), com leitura pública e sem tenant. A `0019` adiciona os **metadados
de sincronização** (`fonte_hash`, `fonte_versao`, `ultima_sincronizacao`,
`revogada_em`) e a auditoria `corpus_sync_runs` (back-office, RLS sem leitura pública).
A `0020` cria `conversa_memoria` (memória de conversa **por tenant**, RLS force) —
janela curta com só intenção + citações públicas; nunca é fonte jurídica. A `0021`
cria `lembretes_enviados` (idempotência do lembrete proativo, RLS force) + as funções
SECURITY DEFINER `app.lembretes_due` (seleção dos devidos) e
`app.marcar_lembrete_enviado` (marcação atômica). A `0022` concede `delete` em
`lembretes_enviados` a `authenticated` (limpar a marcação ao remarcar; a policy por
tenant mantém o isolamento) — base do editar/remover do Cérebro 1. A `0023` evolui
`documentos` (Passo 12A): `processo_id` opcional (doc solto) + `chaves` (jsonb),
`resumo`, `extracao_status`, `busca_texto`, `status`, `legenda` — RLS force já existente.

## PENDENTE (fora do escopo atual)

Nada de mock que finja funcionar — o que não foi implementado está explícito:

- **Pagamento — validação manual (sandbox):** o adapter Asaas, o link, o webhook
  idempotente e a máquina de estados estão **implementados**; falta a **validação
  real no sandbox** (conta/chaves/webhook) e a **aprovação dos templates de
  cobrança na Meta**. Pix Automático fino é refinamento futuro.
- **Adapters externos** (`src/adapters/{courts,storage}` e a fonte de
  **jurisprudência**): **stubs que lançam `NotImplementedError`**. (Os adapters de
  `classifier`, `interaction-log`, `whatsapp`, `llm`, **`payment` (Asaas)** e a
  **fonte de legislação (Planalto)** já são reais.)
- **Cérebro 2 — validação + corpus:** o motor do RAG e a **sincronização** estão
  prontos (8A+8B); falta **rodar a ingestão/sync** (`npm run ingest:corpus` /
  `npm run sync:corpus`) e **validar** — já dá para validar **sem WhatsApp** pela CLI
  (`npm run ask:rag -- "..."`, mesmo pipeline do handler); depois pelo WhatsApp.
  **Jurisprudência** (agregador pago) é o próximo encaixe da mesma sincronização.
- **Embeddings:** `EmbeddingsPort` (OpenAI) implementado; precisa de `EMBEDDINGS_*`.
- **WhatsApp — validação manual e mídia:** o adapter é real, mas o handshake/
  entrega reais com a Meta e o template aprovado exigem **verificação manual**
  (passo a passo acima). **Download de mídia + Storage** ficam PENDENTE.
- **Durabilidade do webhook:** hoje processa-antes-do-ack (sem perda). Uma **fila
  durável** permitiria ack cedo com segurança — melhoria futura.
- **Onboarding — verificação real da OAB:** o cadastro valida o **formato** da OAB
  (número + UF), mas a **conferência da inscrição contra fonte externa** é PENDENTE.
- **Anonimização:** implementada e usada nas leituras do Cérebro 1 (mascara nome
  de cliente/parte; campos estruturais e notas livres não). Captura de
  `entrada`/`saida` no `interacoes_log` segue fora.
- **Cérebro 3 (tribunais)** segue placeholder. **C1** (NL→SQL) e **C2** (RAG
  jurídico — legislação) estão ligados; **jurisprudência** é o **8B** (agregador pago).
- **Pagamento, lembretes proativos, painel admin** — fases seguintes.
- **Storage**: buckets privados e políticas por tenant — fase de documentos.
- **Provisionamento Supabase**: projeto, pooler, role sem `BYPASSRLS`,
  backups/PITR — operação.

## Convenções

- Camadas: domínio não conhece gateway/agregador/WhatsApp/LLM/Storage; tudo via
  port. Adapters trocáveis.
- Migrações versionadas (Supabase CLI); nada de schema improvisado.
- Erros tratados explicitamente, nunca silenciados.

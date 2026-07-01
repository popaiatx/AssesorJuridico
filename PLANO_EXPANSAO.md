# PLANO DE EXPANSÃO — estagiárIA (uma conta, dois canais)

> **Status: PROPOSTA — nada aqui foi implementado.** Documento para revisão com o
> sócio antes de aprovar qualquer fase. Escrito em 2026-07-01, com o projeto no
> estado pós-Passo 13 (OCR local; 320 testes verdes; validações do WhatsApp
> pendentes do chip). Fonte do estado técnico: [`ESTADO_DO_PROJETO.md`](ESTADO_DO_PROJETO.md).

---

## 0. Sumário executivo

Quatro decisões de produto, uma consequência de arquitetura:

1. **Renomeação:** o produto passa a se chamar **estagiárIA** (IA maiúsculo).
2. **Uma conta, dois canais:** WhatsApp e dashboard web são duas portas para os
   **mesmos dados** (mesmo `assinante_id`). Unificação de contas **só com prova
   de posse do telefone** — inegociável.
3. **Ficha do processo:** cada processo vira uma "pasta" que agrega tudo
   (dados, honorários com parcelas, documentos, agenda, prazos). O WhatsApp
   ganha isso **antes** do dashboard existir.
4. **Dashboard web com chat:** gestão visual + o MESMO orquestrador/cérebros
   via web.

A consequência de arquitetura: quase tudo que o dashboard precisa **já existe no
núcleo** (ports & adapters pagou-se: o orquestrador já é agnóstico de canal — "o
envio é responsabilidade do canal"). O plano organiza o trabalho em três fases —
**A: núcleo** (serve os dois canais; WhatsApp ganha já) → **B: ponte**
(autenticação + vinculação + API) → **C: interface** (dashboard + chat web) — e
uma trilha transversal (renomeação, documentação, riscos).

Descobertas do schema atual que **encolhem** o trabalho:

- `processos` **já tem** `comarca`, `vara`, `area`, `parte_contraria`,
  `valor_causa`, `segredo_justica` (migração 0005). Falta pouco (fase, instância).
- `lancamentos_financeiros` **já existe desde a fundação** (0009): tipo
  custo/honorário, valor, vencimento, status e até `lembrete_cobranca_em` — o
  financeiro é "completar e ativar", não "criar do zero".
- A memória de conversa (0020) é **por tenant, não por canal** — compartilhá-la
  entre WhatsApp e web é o comportamento natural, não um retrabalho.
- O que **não** está pronto e a Fase B evolui: `assinantes.telefone` é
  `NOT NULL UNIQUE` (o cadastro web-first exige telefone opcional até a
  verificação) e não há vínculo com `auth.users`.

---

## 1. O que NÃO muda (inegociáveis reafirmados)

Nenhuma fase deste plano afrouxa:

- **Isolamento por tenant.** `assinante_id` vem SEMPRE da identidade
  autenticada (telefone verificado no WhatsApp; sessão autenticada na web) —
  nunca do texto da mensagem, nunca do LLM, nunca de parâmetro do cliente.
  Filtro embutido na query + **RLS force como backstop**, nos dois canais.
- **`service_role` fora do caminho do usuário** (só back-office/migrações; no
  Storage, só o arquivo — a posse é decidida na tabela via RLS).
- **Antialucinação do Cérebro 2.** Só afirma com fonte recuperada e citação
  validada; sem fonte → recusa. Memória interpreta, nunca é fonte. Vale
  idêntico no chat web.
- **Confirmação antes de gravar/remover.** Toda escrita do Cérebro 1 confirma
  antes; remoção com confirmação reforçada; ambíguo pergunta (desambiguação
  numerada), nunca adivinha. O dashboard segue a mesma disciplina (ações
  destrutivas com confirmação explícita na UI).
- **Sigilo dos documentos.** Bucket privado, caminho `${assinante}/${id}/…`,
  URL assinada curta só para o dono; OCR local; chaves nunca inventadas.
- **Método de trabalho.** Plano → aprovação → passos pequenos e testáveis →
  typecheck/lint/test/build verdes → commit → push → documentação viva
  atualizada (ESTADO/GUIA/MANUAL).

---

## 2. TRANSVERSAL — Renomeação para estagiárIA

### 2.1 Alcance (o que muda vs o que fica)

**Muda (texto voltado ao usuário / produto):**

| Onde | O quê |
|---|---|
| Mensagens do assistente | Boas-vindas do onboarding, ajuda, placeholders honestos, avisos ("seu assessor" → "sua estagiárIA"), assinatura do lembrete proativo |
| `MANUAL_DA_ESTAGIARIA.md` | Título e corpo (DECIDIDO na revisão: arquivo renomeado de `MANUAL_DO_ASSESSOR.md`; links em ESTADO/GUIA/README acompanham) |
| README / GUIA / ESTADO | Referências de produto (não as técnicas) |
| Templates Meta (futuros) | O template `lembrete_generico` ainda NÃO foi submetido — submeter já com o nome novo (economiza uma re-aprovação) |
| Dashboard (Fase C) | Nasce já com a marca |

**NÃO muda (interno/técnico — mudar seria risco sem valor):**

- Nome do repositório (`AssesorJuridico`), `package.json`, nomes de pastas.
- Tabelas, migrações, tipos, variáveis, código — nenhum identificador técnico.
- `CLAUDE.md` e skills (referências técnicas; ganham só uma linha de contexto
  "nome comercial: estagiárIA").
- Histórico do git (obviamente).

### 2.2 Momento certo

**Primeiro passo da sequência (Passo 14), antes de tudo.** Motivos: (a) é
barato agora e encarece a cada texto novo escrito com o nome antigo; (b) o
template da Meta ainda não foi submetido — submeter uma vez só, já certo; (c) o
dashboard e a API nascem com a marca; (d) é um passo pequeno, sem risco, bom
para retomar o ritmo depois do planejamento.

Grafia canônica a fixar no passo: **estagiárIA** (minúsculo no início, "IA"
maiúsculo), inclusive em início de frase. Registrar no CLAUDE.md.

---

## 3. FASE A — Ficha do processo + financeiro no núcleo

> Serve aos dois canais. O WhatsApp ganha tudo isto ANTES do dashboard existir.
> Nenhuma dependência externa: 100% testável sem chip (testes + CLIs).

### 3.1 Ficha do processo: consulta agregada, não tabela nova

A "pasta" do processo é uma **visão agregada**, não uma entidade nova. Os dados
já moram nas tabelas certas (`processos`, `compromissos`, `documentos`,
`lancamentos_financeiros`, `movimentacoes`), todas já amarradas por FK composta
`(id, assinante_id)` e RLS. Criar uma "tabela ficha" duplicaria estado.

**Evolução de esquema (migração 0025, aditiva e pequena):**

- `processos.fase text` — fase processual (conhecimento, recurso, execução…),
  livre, sem enum (fases variam por área; enum engessaria).
- `processos.instancia text` — 1º grau / 2º grau / superior (opcional).
- **Não adicionar `juizo`:** `vara` + `comarca` já expressam o juízo no uso
  forense corrente; um terceiro campo confundiria o preenchimento por conversa.

**Serviço `FichaProcesso` (application):** dado um processo (resolvido por
seletor escopado ao tenant, MESMO mecanismo do Passo 11), monta em UMA passada:
dados do processo + cliente, compromissos futuros (e últimos passados),
documentos vinculados (nome, status de leitura, "lido por OCR" quando for),
parcelas de honorários (pagas/pendentes/vencidas + totais), últimas
movimentações. Leitura formatada para WhatsApp (e depois JSON para a API — o
mesmo serviço serve os dois).

**Ações novas do Cérebro 1:** `consultar_ficha` (leitura, com anonimização ao
passar pelo LLM como nas demais leituras) e extensão de `editar_processo` para
os campos novos (fase, instância). Confirmação antes de gravar, como sempre.

### 3.2 Honorários com parcelas (completa a tabela que já existe)

**Decisão de modelo: cada parcela = uma linha em `lancamentos_financeiros`**
(tipo `honorario`), agrupadas por um acordo. Não criar tabela de "contrato de
honorários" agora — o agrupamento leve resolve e o schema atual já tem 80%.

**Evolução de esquema (migração 0026, aditiva):**

- `descricao text` — "honorários contratuais", "êxito", "custas de perícia"…
- `parcela int` / `total_parcelas int` — "3/10" (nulos para lançamento avulso).
- `acordo_id uuid` — agrupa as parcelas geradas juntas (gerado pelo sistema no
  registro; sem tabela própria por ora).
- `pago_em timestamptz` — data efetiva do pagamento (status já existe).

**Ações novas do Cérebro 1** (todas com confirmar-antes-de-gravar; alvo por
seletor escopado; desambiguação numerada; id re-verificado por tenant):

- `registrar_honorario` — "registra honorário de 10 mil em 5 parcelas a partir
  de agosto no processo do João" → o sistema calcula as parcelas (valor/N,
  vencimentos mensais), mostra o plano completo na confirmação, grava as N
  linhas atomicamente.
- `registrar_custo` — lançamento avulso de custo.
- `marcar_parcela_paga` — "a parcela de setembro do João foi paga" → confirma
  mostrando a parcela real → status `pago` + `pago_em`.
- `consultar_financeiro` — "quanto o processo X me deve?", "o que vence este
  mês?" — leitura agregada (por processo ou geral), anonimizada ao LLM.
- `editar_parcela` / `cancelar_lancamento` — mesma disciplina do Passo 11
  (confirmação reforçada no cancelamento; cancelar = status `cancelado`, nunca
  delete).

### 3.3 Lembrete de cobrança: reusar o motor do Passo 10 (sim, reusa bem)

Avaliação: o motor do Passo 10 tem três partes — **seleção** (função SQL
`app.lembretes_due`, SECURITY DEFINER), **envio com marca-após-sucesso**
(idempotente, resiliente por item, advisory lock, dry-run) e **formatação**. A
segunda e a terceira são genéricas; só a seleção é específica de compromissos.

**Proposta:** generalizar o runner (`send-lembretes`) para aceitar mais de uma
FONTE de lembretes devidos:

- Migração 0027: `app.cobrancas_due(p_agora, p_grace_min)` — seleciona parcelas
  `pendente` com `lembrete_cobranca_em` na janela (campo já existe na 0009!) —
  e `cobranca_lembretes_enviados` (mesmo padrão da 0021: unique por
  (lancamento, instante), marca-após-sucesso via SECURITY DEFINER).
- `registrar_honorario` grava `lembrete_cobranca_em` (ex.: 3 dias antes do
  vencimento, configurável `COBRANCA_LEMBRETE_DIAS`).
- O MESMO job/Cron processa os dois tipos (um processo, duas seleções);
  dry-run cobre ambos. Texto: "💰 Lembrete: parcela 3/10 do cliente X (R$ …)
  vence em 05/09".
- **Escopo claro:** isto é lembrete AO ADVOGADO (mesmo destinatário dos
  lembretes de agenda — template já previsto). Cobrança AO CLIENTE FINAL do
  advogado fica FORA (é outra relação de consentimento/opt-in — registrado como
  ideia futura no manual).

### 3.4 Documentos em pastas (refinamento do 12A/12B)

O modelo já suporta: `documentos.processo_id` opcional = "na pasta do processo"
ou "avulso". O refinamento é comportamento, não schema (**sem migração**):

**(a) Sugerir a pasta certa.** O 12A já extrai chaves (números de processo
inclusive) de todo documento guardado. Novo passo determinístico no fluxo de
guarda: cruzar números/CNJ extraídos (e a legenda) com os processos DO TENANT
(query escopada). Achou exatamente 1 e o usuário não indicou pasta → **sugerir,
nunca decidir**: "Esse documento menciona o processo 0001234-…, do cliente
João. Guardo na pasta dele? (sim / não, deixa avulso)". Vários candidatos →
lista numerada. Nenhum → guarda avulso (comportamento atual). A decisão do
usuário é sempre a palavra final; a sugestão é match determinístico de
número (o LLM não escolhe a pasta).

**(b) Mover documento.** Ação nova `mover_documento` no Cérebro 1: "move o
contrato do João para a pasta do processo 12345" / "tira esse documento da
pasta". Alvo resolvido pela MESMA busca do 12B (escopada); destino resolvido
pelo MESMO seletor de processo do Passo 11; ambíguo → desambigua; confirmação
mostra documento real + pasta origem → destino; `update` de `processo_id` por
tenant com id re-verificado. A FK composta com `processos(id, assinante_id)`
**garante no banco** que ninguém move documento para pasta de processo de outro
tenant, mesmo se toda camada acima falhar.

**(c) Busca acha tudo e informa a pasta.** A busca do 12B já varre o acervo
inteiro do tenant (vinculados e avulsos). Refinamento: o resultado passa a
exibir a pasta ("📁 processo 0001234-… / João" ou "📁 avulso"). Junção leve na
query já escopada; e um filtro opcional "buscar só na pasta do processo X"
quando o pedido mencionar a pasta.

---

## 4. FASE B — Autenticação web + unificação de conta + API (a ponte)

> Sem interface ainda: entregue via API + testes + CLIs. Testável sem chip em
> quase tudo (a exceção honesta está em 4.4).

### 4.1 Autenticação web: Supabase Auth (e-mail/senha + magic link)

**Recomendação: usar Supabase Auth.** Justificativa: já estamos no Supabase
(zero infra nova); resolve armazenamento seguro de credenciais, verificação de
e-mail, reset de senha, rate-limit e sessões/refresh sem escrevermos código de
autenticação (que é exatamente o tipo de código que não se deve escrever à
mão); emite JWT verificável no backend. **E-mail/senha E magic link** ambos
habilitados — advogado escolhe; o magic link de quebra funciona como
verificação de posse do e-mail.

**Decisão de arquitetura (importante): o front NUNCA fala direto com o banco.**
Supabase Auth serve SÓ para identidade (login/sessão). Todos os dados passam
pela nossa API Fastify. Motivos:

1. Nossa RLS é por GUC `app.current_assinante_id()` + `withTenant`, não por
   `auth.uid()`. Abrir acesso direto do browser exigiria REESCREVER as
   políticas de todas as tabelas para um segundo modelo — dobra a superfície do
   mecanismo mais crítico do sistema, para economizar uma camada fina de API.
2. A API é onde vivem as regras que o banco não expressa: anonimização ao LLM,
   confirmação-antes-de-gravar, log de interações, porteiro de assinatura.
3. Um caminho único de dados = um lugar para auditar. (Prioridade do projeto:
   confiabilidade > velocidade.)

### 4.2 Sessão web → `assinante_id` → `withTenant` (idêntico ao WhatsApp)

Espelho exato do caminho pré-tenant por telefone:

1. Request chega com `Authorization: Bearer <JWT do Supabase Auth>`.
2. Fastify **verifica assinatura/expiração** do JWT (JWKS do projeto Supabase,
   cacheado) — sem chamada de rede por request.
3. Extrai `sub` (= `auth.users.id`) **do token verificado** — nunca de header
   ou body.
4. Resolve `auth_user_id → assinante_id` por função SECURITY DEFINER
   `app.resolve_assinante_by_auth_user(uuid)` — retorna só o id, mesmo contrato
   do `app.resolve_assinante_by_phone` (0003).
5. Daí em diante, **código idêntico ao WhatsApp**: porteiro fail-closed
   (trial/ativa) → `withTenant(assinante_id, …)` → RLS atuando.

Os dois canais convergem no mesmo funil: só muda COMO a identidade é provada
(posse do telefone vs sessão Auth); de `assinante_id` em diante é um caminho só.

**Evolução de esquema (migração 0028):**

- `assinantes.auth_user_id uuid unique` (nullable — conta só-WhatsApp não tem).
- `assinantes.telefone` passa a **nullable** + unique parcial
  (`where telefone is not null`) — conta web-first ainda não verificada não tem
  telefone. O caminho WhatsApp não muda (telefone continua a identidade lá).
- `assinantes.telefone_verificado_em timestamptz` — no fluxo WhatsApp-first é
  preenchido na criação (a posse é intrínseca: a mensagem veio do número); no
  web-first, só após a verificação (4.4).
- Tabela `vinculacao_codigos`: código **em hash**, `assinante_id` (conta web
  que pediu), telefone alvo, expiração (TTL 10 min), `usado_em`, tentativas
  (rate limit). Uso único.

### 4.3 Os dois fluxos de entrada

**Fluxo (a) — começou no WhatsApp (hoje):** onboarding atual intocado (nome +
e-mail + consentimento + trial). Para acessar o dashboard: "criar acesso web" →
Supabase Auth signup com **o e-mail que quiser** → o vínculo com a conta
WhatsApp segue a regra única de unificação (4.4) — **e-mail igual NÃO basta**,
porque o e-mail informado no onboarding do WhatsApp não é verificado hoje.
Alguém que conheça o e-mail de um advogado não pode capturar a conta dele: sem
prova de posse do telefone, nada se une.

**Fluxo (b) — começou no dashboard:** signup web (Supabase Auth) → cria
assinante **sem telefone** (trial 3 dias — MESMA fonte de verdade,
`assinaturas`, mesmo porteiro) → usa o dashboard normalmente. Informar um
telefone no cadastro **não vincula nada** — fica registrado apenas como
"pendente de verificação". Quando quiser o WhatsApp, roda a verificação (4.4).

### 4.4 PONTO CRÍTICO — prova de posse do telefone (regra única de unificação)

**Regra:** contas só se unificam com prova de posse do telefone. Sem exceção.
Enquanto não provado: **contas permanecem separadas, nada é unificado, nenhum
dado cruza** — cada uma continua um tenant isolado e funcional.

**Mecanismo recomendado: código reverso (a pessoa envia PELO WhatsApp).**

1. No dashboard (logado), a pessoa pede "conectar meu WhatsApp".
2. O sistema gera um código curto (ex.: `VINCULAR 483-921`), mostra NA TELA,
   com TTL de 10 minutos, uso único, hash no banco, rate limit por conta e por
   telefone.
3. A pessoa envia essa mensagem **do próprio WhatsApp** para o número do
   produto.
4. O webhook (fluxo normal de mensagem) reconhece o padrão `VINCULAR <código>`
   ANTES da classificação de intenção, valida (hash + TTL + não usado) e
   executa a vinculação **transacional** via função SECURITY DEFINER dedicada
   (mesmo padrão do onboarding), com auditoria em log imutável.

**Por que reverso e não "enviamos um código para o seu WhatsApp":** (a) prova
de posse mais forte — a mensagem ORIGINA do número, com a identidade que o
próprio canal WhatsApp autentica (mesma identidade de todo o resto do sistema);
(b) mensagem iniciada pelo usuário abre a janela de 24h — **não depende de
template aprovado na Meta** nem de mensagem proativa; (c) é o mesmo caminho de
webhook já construído e testado. O envio ativo de código fica registrado como
alternativa futura (exigiria template aprovado).

**Matriz de casos na validação do código:**

| Situação do telefone | Ação |
|---|---|
| Não existe assinante com esse telefone | Vincula o telefone à conta web (passa a ser a identidade WhatsApp dela). Caso simples do fluxo (b). |
| Existe assinante WhatsApp com esse telefone e a conta web **não tem dados próprios** (recém-criada, acervo vazio) | **Une**: `auth_user_id` passa a apontar para o assinante WhatsApp (a conta rica sobrevive; a casca web é descartada). Caso comum do fluxo (a). |
| Existe assinante WhatsApp com esse telefone E a conta web **tem dados próprios** (processos/docs/financeiro nos dois lados) | **v1 NÃO funde automaticamente.** Informa com clareza e oferece unificação assistida (back-office auditado, com o titular). Merge automático de dois acervos é o passo mais arriscado de todo o plano — não se faz sem ferramenta de auditoria e reversão. |

Em todos os casos: operação transacional, auditada (log pré-tenant com telefone
em hash, como no onboarding), e o código é queimado mesmo em falha posterior.

**Honestidade sobre teste:** a lógica inteira (código, TTL, hash, matriz de
casos, transação) é testável sem chip (testes + simulação de webhook, como já
fazemos). A validação PONTA A PONTA real do passo 3 (mensagem de verdade) entra
na fila do chip, junto com as demais validações pendentes.

### 4.5 API REST mínima (consumida pela Fase C)

Todos os endpoints: JWT verificado → porteiro → `withTenant`. Sem endpoint
"admin". Paginação simples desde o início. Rotas v1:

- `GET /api/me` — perfil + status da assinatura + estado de vinculação.
- `GET /api/processos` / `GET /api/processos/:id/ficha` (o serviço 3.1).
- `POST/PATCH /api/processos` (validação idêntica ao C1; a API não tem caminho
  privilegiado).
- `GET /api/agenda` (compromissos por período).
- `GET /api/financeiro` (parcelas por status/período) + `PATCH` marcar paga.
- `GET /api/documentos?busca=` (motor do 12B) + `GET /:id/url` (URL assinada
  curta, posse re-verificada) + `POST /api/documentos` (upload → MESMO fluxo do
  12A: extração → chaves → OCR se preciso → embedding) + `PATCH /:id/pasta`
  (mover, 3.4b).
- `POST /api/chat` (Fase C — ver 5.3).
- Vinculação: `POST /api/vinculacao/codigo` (gera código; o resto acontece pelo
  WhatsApp).

---

## 5. FASE C — Dashboard web (interface + chat)

### 5.1 Stack do front: Vite + React + TS, SPA servida pelo próprio Fastify

**Recomendação:** SPA **React + Vite + TypeScript**, buildada para estático e
servida pelo Fastify (`@fastify/static`) **no mesmo serviço Railway**. Com
**TanStack Query** (dados/cache/revalidação) e **Tailwind CSS** (produtivo, sem
design system pesado). Sem Redux (Query cobre o estado de servidor, que é quase
todo o estado).

**Justificativa (vs Next.js):** o dashboard vive atrás de login — SEO/SSR são
irrelevantes. Next.js traria um segundo servidor Node, segundo deploy, segunda
superfície de config/segredos e o acoplamento a um framework full-stack cujo
lado servidor não usaríamos (a API já existe no Fastify). A SPA estática no
mesmo processo: um deploy só, mesma origem (sem CORS em produção), zero infra
nova, e o time é pequeno — sustentabilidade vale mais que moda. Se um dia
precisarmos de site público/landing com SEO, isso é outro artefato (estático),
não motivo para SSR no dashboard. TypeScript compartilhado: tipos da API num
pacote comum (`src/types` exportado) para o front consumir os mesmos contratos.

### 5.2 Escopo MÍNIMO da v1 (disciplina anti-inchaço)

**Entra na v1:**

1. Login/signup (Supabase Auth: e-mail/senha + magic link) + tela "conectar
   WhatsApp" (código reverso, 4.4).
2. **Lista de processos → ficha do processo** (a visão 3.1: dados, agenda,
   documentos, financeiro do processo) — leitura primeiro.
3. **Upload de documento direto na ficha** (cai no fluxo 12A completo) e na
   "pasta avulsa"; mover documento entre pastas (select simples, com
   confirmação — sem drag-and-drop na v1).
4. **Agenda** (lista por período; criar/editar com confirmação).
5. **Financeiro** (parcelas pendentes/vencidas/pagas; marcar paga com
   confirmação; registrar honorário parcelado pela ficha).
6. **Chat com a estagiárIA** (5.3) — o atalho universal para tudo que a UI
   ainda não faz.

**Fica explicitamente para DEPOIS:** relatórios/gráficos; drag-and-drop;
notificações in-app; painel do dono do produto (assinantes/churn); plano
escritório (multi-advogado); edição rica de documentos; tema/branding
configurável; app mobile. Qualquer item destes só entra por decisão explícita,
não por "já que estamos aqui".

### 5.3 Chat web: mesmo orquestrador, mesma memória (proposta: compartilhada)

- `POST /api/chat` monta o MESMO `InboundMessage` e chama o MESMO
  `Orchestrator.handleInboundMessage` — com `assinante_id` já resolvido pela
  sessão (o orquestrador ganha a entrada "identidade já resolvida", que o
  caminho WhatsApp não usa). **Zero lógica de negócio nova**: intenções,
  cérebros, porteiro, confirmações e logs idênticos. A resposta volta no corpo
  (síncrono) — a janela de 24h é regra DO CANAL WhatsApp e não se aplica à web.
- Diferença de canal honesta: no chat web não há mídia na v1 (upload tem botão
  próprio, que usa o fluxo 12A); "confirmar antes de gravar" na web é responder
  "sim" no chat, como no WhatsApp.
- **Memória de conversa: COMPARTILHADA entre canais (proposta).** Fundamentos:
  a memória já é por tenant (0020), não por canal; a conta é UMA, e o cenário
  real é começar no WhatsApp na rua e continuar no dashboard no escritório — a
  continuidade é o produto funcionando como prometido. O risco é baixo
  porque a memória **interpreta e nunca é fonte** (inegociável mantido) e
  guarda só intenção + citações públicas (sem PII). Janela/TTL atuais (6
  turnos/30 min) já limitam contaminação entre contextos. Ajuste pequeno: cada
  turno ganha marca de canal (`origem: whatsapp|web`) — não muda o
  comportamento, serve para depuração e para decisões futuras (ex.: se na
  prática o cruzamento confundir, dá para segmentar depois sem migração de
  dados históricos).

---

## 6. Impacto no que existe

| Área | Impacto |
|---|---|
| Migrações | Novas 0025–0028+ (aditivas; nenhuma quebra o schema atual). A mudança mais sensível é `assinantes.telefone` → nullable (0028): o caminho WhatsApp não muda (sempre tem telefone), mas os testes de onboarding/identidade ganham casos de conta sem telefone. |
| Orquestrador | Ganha entrada com identidade já resolvida (web) ao lado da resolução por telefone; interceptação `VINCULAR <código>` pré-classificação. Roteamento/cérebros intocados. |
| Cérebro 1 | Novas ações tipadas (ficha, honorários/parcelas, mover documento) no MESMO padrão do Passo 11 (seletor escopado, desambiguação, confirmação, id re-verificado). |
| Motor de lembretes | Generalização para 2ª fonte (cobranças) — seleção nova, runner/idempotência/dry-run reusados. |
| Documentos 12A/12B | Sugestão de pasta no fluxo de guarda; pasta exibida na busca; ação mover. Sem migração. |
| Config | Novas variáveis no `.env.example` PRIMEIRO, como sempre (SUPABASE_JWT/JWKS, COBRANCA_LEMBRETE_DIAS, VINCULACAO_*, DASHBOARD_*). |
| Docs vivos | ESTADO/GUIA a cada passo; MANUAL nos passos com cara de produto (renomeação, ficha, financeiro, dashboard). |

## 7. Riscos honestos

1. **Vinculação de contas é o passo mais delicado do plano.** Um erro aqui é
   exatamente o desastre que o projeto inteiro evita: dado de um advogado
   visível para outro. Mitigações: prova de posse única e forte (código
   reverso), nada unifica antes dela, merge automático de dois acervos com
   dados FORA da v1, transação + auditoria, e testes adversariais dedicados
   (tentar vincular telefone alheio, código expirado/reusado/forjado, corrida
   entre dois códigos).
2. **Escopo do dashboard tende a crescer.** Mitigação: a lista fechada da 5.2,
   e o chat web como válvula de escape ("a UI não faz X ainda, o chat faz").
3. **Validações do WhatsApp continuam pendentes do chip** — este plano NÃO as
   destrava; adiciona a validação real do código reverso à mesma fila. O que já
   está pendente (C1, RAG, lembretes, mídia, template) permanece explícito.
4. **Superfície de segurança nova (API pública na internet).** O WhatsApp tinha
   a Meta na frente; a API não. Mitigação: JWT verificado por assinatura, rate
   limit, CORS restrito, headers de segurança, porteiro fail-closed, e RLS como
   sempre — e a API não tem caminho privilegiado (mesmos serviços do domínio).
5. **Fusão assistida vira trabalho operacional** (quando os dois lados têm
   dados). Aceito conscientemente na v1: raro no início, e a alternativa
   (merge automático) é onde mora o perigo.
6. **Duas frentes de deploy no mesmo serviço** (API + estático): risco baixo,
   mas o build do front entra no pipeline (build quebrado de front não pode
   derrubar a API — build separado, deploy conjunto).

## 8. SEQUÊNCIA NUMERADA (passos incrementais, um por vez)

> Estilo de sempre: cada passo cabe em commits pequenos, termina com
> typecheck/lint/test/build verdes, push e docs vivos atualizados. "Chip?"
> indica se a validação REAL depende do chip (o desenvolvimento e os testes,
> nunca).

**FASE A — núcleo (o WhatsApp ganha já):**

| Passo | Entrega | Testável sem chip? |
|---|---|---|
| **14** | **Renomeação estagiárIA** — textos de produto + MANUAL/README/GUIA + grafia canônica no CLAUDE.md | ✅ total |
| **15** | **Ficha do processo** — migração 0025 (fase/instância), serviço `FichaProcesso`, ações `consultar_ficha` + editar campos novos, CLI `ficha:show` | ✅ total |
| **16** | **Honorários/parcelas** — migração 0026, ações registrar/consultar/marcar-paga/editar/cancelar, CLI `fin:*` | ✅ total |
| **17** | **Lembrete de cobrança** — migração 0027 (`cobrancas_due` + enviados), generalização do runner, dry-run cobrindo os 2 tipos | ✅ (envio real: chip, como o Passo 10) |
| **18** | **Documentos em pastas** — sugestão de pasta na guarda, ação `mover_documento`, pasta na busca | ✅ total |

**FASE B — a ponte:**

| Passo | Entrega | Testável sem chip? |
|---|---|---|
| **19** | **Supabase Auth + resolução web** — migração 0028 (auth_user_id, telefone nullable, telefone_verificado_em), verificação JWT/JWKS no Fastify, `resolve_assinante_by_auth_user`, `GET /api/me`, signup web-first (trial) | ✅ total |
| **20** | **Vinculação com prova de posse** — tabela de códigos, geração na API, interceptação `VINCULAR` no webhook, matriz de casos, testes adversariais | ✅ lógica total (mensagem real: chip) |
| **21** | **API REST v1** — processos/ficha/agenda/financeiro/documentos (reusando os serviços das fases A e 12A/12B), rate limit + CORS + headers | ✅ total |

**FASE C — a interface:**

| Passo | Entrega | Testável sem chip? |
|---|---|---|
| **22** | **Esqueleto do dashboard** — Vite+React servido pelo Fastify, login/sessão, lista de processos → ficha (leitura) | ✅ total |
| **23** | **Ações no dashboard** — upload na ficha/avulso, mover documento, agenda, financeiro (com confirmações) | ✅ total |
| **24** | **Chat web** — `POST /api/chat` → mesmo orquestrador; memória compartilhada com marca de canal; tela "conectar WhatsApp" | ✅ total |

Dependências: 15→16→17 em ordem; 18 pode trocar de lugar dentro da Fase A;
19→20→21 em ordem; 22→23→24 em ordem. Entre fases, a ordem A→B→C é a proposta
(valor primeiro no canal que já existe), mas B pode começar em paralelo ao fim
de A se quisermos acelerar — decisão de gestão, não técnica.

## 9. O que preciso de vocês (decisões em aberto para a revisão)

> **REVISADO em 2026-07-01 (advogada + sócio): itens 1–5 APROVADOS como propostos.**
> Detalhes: memória compartilhada COM marca de canal; manual renomeado; fusão de
> contas sempre assistida/auditada, e o fluxo detalhado do que o usuário vê será
> apresentado para aprovação antes de implementar essa parte (Fase B). E-mail
> igual JAMAIS unifica contas; código reverso é o mecanismo de prova de posse.

1. **Aprovação da estrutura A→B→C** e do corte da v1 do dashboard (5.2).
2. **Memória compartilhada entre canais** (5.3) — recomendo sim; confirmar.
3. **Stack do front** (5.1: Vite+React servido pelo Fastify) — confirmar.
4. **Renomeação:** manter arquivo `MANUAL_DO_ASSESSOR.md` (título muda dentro)
   ou renomear para `MANUAL_DA_ESTAGIARIA.md`? **DECIDIDO: renomeado.**
5. **Política de fusão assistida** (4.4, caso "ambos com dados") — confirmar
   que fica fora do automático na v1.
6. Nada deste plano será implementado sem o "aprovado" por fase.

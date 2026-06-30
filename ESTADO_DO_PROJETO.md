# Estado do projeto — Assistente Jurídico no WhatsApp

> Documento vivo (convenção C do `CLAUDE.md`). Resumo do estado atual para
> retomar o trabalho a qualquer momento. **Não é changelog** — o histórico está
> no git. Atualizado ao final de cada passo, antes do push.
>
> Mapa prático de módulos e como testar: [`GUIA.md`](GUIA.md). Roteiros de
> ingestão/sync e validação A/B/C: [`README.md`](README.md). Visão de produto em
> linguagem simples (uso + roadmap): [`MANUAL_DO_ASSESSOR.md`](MANUAL_DO_ASSESSOR.md).

## Fase atual

- **Fase 2 (Inteligência).** Concluídos o **Passo 8A — Cérebro 2 (RAG jurídico)** e o
  **Passo 8B — fontes pluggáveis + sincronização automática do corpus**: corpus
  LOCAL (Supabase+pgvector) que se mantém fresco por job de sync com a fonte oficial
  (Planalto), detectando novo/alterado/revogado, re-embedando só o que muda, com
  vigência na busca (revogada nunca afirma) — tudo sem afrouxar o antialucinação.
  Corpus carregado e validado pela CLI. Concluído também o **Passo 9 — Memória de
  conversa**: o assessor mantém o fio do assunto entre mensagens (resolve "dela"/"o
  artigo seguinte") e percebe mudança de assunto, **sem a memória virar fonte** e sem
  afrouxar isolamento/antialucinação. Concluído também o **Passo 10 — Lembrete
  proativo**: job agendado (Railway Cron) que avisa o advogado antes de
  audiências/prazos, idempotente, no fuso de Brasília, via template — validável por
  **dry-run** sem chip. Concluído também o **Passo 11 — editar/remover no Cérebro 1**
  (editar/cancelar compromisso, editar/arquivar processo) com resolução de alvo
  escopada por tenant, desambiguação numerada, confirmação reforçada na remoção e
  recálculo de lembretes na remarcação. Concluído também o **Passo 12A — documentos**
  (receber/decidir/ler/resumir/guardar com informações-chave; bucket privado isolado
  por tenant; validável pela CLI `doc:process`). Concluído também o **Passo 12B — busca
  de documentos** (achar por referência exata e/ou semântica, sem lembrar o nome do
  arquivo; embedding-on-write + backfill `doc:reindex`; isolamento por tenant embutido
  na query — exata e semântica — com RLS de backstop; validável pelas CLIs `doc:reindex`
  + `doc:search`). Falta **agendar os Crons no Railway** (sync semanal + lembretes 15
  min), **aprovar o template `lembrete_generico` na Meta**, **criar o bucket
  `documentos`** e **validar pelo WhatsApp** (download de mídia, chip).
  Próximo: **jurisprudência** ou **Cérebro 3 (tribunais)**.
  Pendências de validação acumuladas: Cérebro 1, pagamento sandbox (6B) — pelo chip.

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
- **Robustez de ingestão (correções de campo):** User-Agent de navegador no fetch do
  Planalto (WAF resetava sem ele); gravação de trechos em LOTE (unnest) + logs de
  progresso; retry com backoff nos embeddings (429/5xx); subdivisão de trecho > limite
  de tokens; RAG robusto a JSON truncado (degrada com segurança); **`RAG_TOP_K`
  ajustável (default 8)**. **Corpus REAL carregado: 6 normas, todos os trechos com
  embedding** (CF, CC, CPC, CLT, CDC, 8.213). Bateria A/B/C validada pela CLI.
- **Passo 9 — Memória de conversa.** Estado curto **por tenant** (`conversa_memoria`,
  RLS force, migração 0020) com **só intenção + citações públicas** (sem PII; nunca
  texto livre do usuário). Política pura (`isWarm`/`trimTurnos`); janela
  `CONVERSA_MEMORIA_TURNOS`=6, TTL `CONVERSA_MEMORIA_TTL_MIN`=30, flag
  `CONVERSA_MEMORIA_ENABLED`. O orquestrador carrega a cauda quente → passa como
  `recentContext` (opcional) ao classificador e ao Cérebro 2 → anexa o turno após
  responder; memória fria (TTL) é limpa. **Heurística conservadora** (`follow-up.ts`):
  só injeta contexto em follow-up curto/anafórico SEM norma própria; senão, novo foco
  (adversarial "e na CLT…" não contamina). A memória **só interpreta** — a citação
  segue validada contra o corpus; sem fonte, recusa (validado: "artigo seguinte" sem
  texto no acervo → recusa, não inventa). Modo `ask:rag -- --conversa` para validar
  sem chip. **207 testes verdes.**
- **Passo 10 — Lembrete proativo.** Job agendado (`npm run send:lembretes`, Railway
  Cron 15 min, processo separado) que avisa o advogado **antes** de audiências/prazos.
  Os instantes (24h e 1h antes) já vêm do Cérebro 1 (`compromissos.lembrete_em`).
  Migração 0021: `lembretes_enviados` (RLS force) + funções SECURITY DEFINER
  `app.lembretes_due` (seleção dos devidos na janela `[agora-grace, agora]`, ignora
  futuros/passados/já enviados) e `app.marcar_lembrete_enviado` (atômica, idempotente).
  Motor `send-lembretes` (marca-após-sucesso; resiliência por lembrete; advisory lock);
  `format.ts` (texto + fuso BR). **Dry-run fiel** (`--dry-run [--now ISO]`) que NÃO
  envia nem marca. Envio proativo via template `lembrete_generico`. **217 testes verdes.**
- **Passo 11 — editar/remover no Cérebro 1.** 4 ações tipadas (`editar_compromisso`,
  `cancelar_compromisso`, `editar_processo`, `arquivar_processo`), sem `assinante_id`
  no schema. O alvo é resolvido por **seletor** (processo/tipo/dia ou cnj/cliente/parte)
  **escopado por tenant**; ambíguo → **desambiguação numerada** (fase `desambiguando`);
  0 → resposta clara. Confirmação montada com o **registro real** (REFORÇADA na
  remoção); id **re-verificado por tenant** na confirmação e execução. Remarcar
  **recalcula `lembrete_em`** (24h/1h da nova data, filtra ao futuro) e **limpa
  `lembretes_enviados`** (migração 0022 = grant delete). Remover compromisso = delete
  real (cascade limpa enviados); processo = **arquivar** (status='arquivado', sem
  exclusão destrutiva). **235 testes verdes.**
- **Passo 12A — gestão de documentos (receber/decidir/ler/resumir/guardar).** Migração
  0023 (documentos: `processo_id` opcional + `chaves` jsonb/`resumo`/`extracao_status`/
  `busca_texto`/`status`/`legenda`). Decisão por legenda ("resume"/"salva") ou pergunta
  1/2/3 (estado = linha `aguardando_decisao`). Extractors `.txt`/PDF-texto/`.docx`
  (pdf-parse/mammoth); PDF-imagem/foto → `sem_texto` + aviso (sem OCR). Ao guardar,
  **sempre** extrai chaves (LLM, **sem inventar**: ausente fica vazio) + `busca_texto`
  (alimenta o 12B); resumo map-reduce p/ doc longo. Storage real (bucket privado,
  caminho `${assinante}/${id}/…`, URL assinada curta); **isolamento do arquivo**: posse
  decidida na tabela (RLS), service_role só toca o arquivo. CLI `npm run doc:process`.
  `MediaDownloader` (WhatsApp) pronto — download depende do chip. **265 testes verdes.**
- **Passo 12B — busca de documentos (achar sem lembrar o nome do arquivo).** Migração
  0024 (coluna `embedding vector(1536)` + índice HNSW cosine). **Duas buscas
  combinadas**: EXATA (`ILIKE` por token em `busca_texto`/`nome`, casa fragmento de
  número) + SEMÂNTICA (embedding da referência × embeddings dos docs do tenant, pgvector
  `<=>`), com **prioridade da exata**, dedup e **Top N=5** (`DOCUMENTOS_BUSCA_TOPN`);
  semântica com piso `DOCUMENTOS_BUSCA_MIN_SIM=0.3` (vizinho irrelevante fora) e
  resiliente (sem embeddings/erro → só exata). **Embedding-on-write**: gerado do
  `busca_texto` na guarda (12A); falha não perde o doc (loga, guarda sem vetor).
  **Backfill** `doc:reindex` (idempotente, back-office via pool) para acervo antigo.
  Handler do intent `documento` (texto) gera **URL assinada só de doc que veio da query
  escopada** (dono confirmado). **ISOLAMENTO**: `assinante_id` SEMPRE da identidade;
  filtro `where assinante_id` **embutido na query** (exata e semântica), antes do
  `ILIKE`/`<=>`; **RLS force** backstop. CLIs `npm run doc:reindex` + `npm run
  doc:search`. Isolamento provado por testes (2 tenants) **e em Postgres real (RLS,
  pgvector)**. Validado **ponta a ponta de verdade** (não só fakes) contra Supabase
  real: adicionar (PDF/DOCX → chaves+embedding; imagem → sem_texto, sem inventar),
  backfill idempotente, busca exata/nome/semântica e isolamento A×B (A nunca vê B,
  nem por assunto parecido nem por número só-de-B; acesso por id de outro dono
  barrado via RLS → URL nunca gerada). Robustez: limite de tamanho
  (`DOCUMENTOS_MAX_MB`, recusa antes de subir), formato não suportado/escaneado
  guardado com aviso de ponto cego, e mensagens claras de pré-requisito (bucket
  ausente etc.). Ferramentas: `doc:doctor` (diagnóstico) e `doc:bucket` (cria o
  bucket privado). **284 testes verdes.**
- **Fix Node 20 / WebSocket.** O `@supabase/supabase-js` construía um RealtimeClient
  que exigia WebSocket nativo (só no Node 22+), quebrando todos os scripts de banco
  no Node 20. `admin.ts` passou a desligar o Realtime (transport no-op) — roda no
  Node 20.18+ e 22+, sem nova dependência. Ver README › "Versão do Node".

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
- **Editar/remover (caminho destrutivo) seguro:** alvo resolvido por seletor
  escopado por tenant; **ambíguo nunca adivinha** (desambiguação numerada); confirma
  com o **registro real** (reforçado na remoção); id **re-verificado por tenant** na
  execução. Compromisso = delete real; processo = **arquivar** (sem exclusão).
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
- **Memória de conversa interpreta, não é fonte:** resolve referências p/ montar a
  consulta; afirmação jurídica segue do corpus com citação validada. Guarda só
  intenção + citações públicas (sem PII), por tenant (RLS), janela + TTL. Heurística
  **falha p/ novo foco** (na dúvida, não injeta) e a mensagem atual domina a busca.
- **Lembrete proativo = job back-office idempotente:** seleção cross-tenant por
  SECURITY DEFINER (sem service_role), **marca-após-sucesso** + `unique` + advisory
  lock (rodar 2x = 1 envio). Compara em **UTC**, exibe em **BRT**; não dispara passado;
  grace recupera downtime. Proativo → **template** (envio real depende de aprovação).
- **Documentos: isolamento do ARQUIVO por construção.** A posse é decidida na tabela
  `documentos` (RLS, withTenant); só com a linha do dono se obtém o `storageRef` →
  só então se baixa/gera URL. service_role toca **só o arquivo**; caminho é sempre
  `${assinante}/${id}/…` (identidade, nunca do usuário). **Chaves nunca inventadas**
  (ausente = vazio); sem texto (escaneado) → guarda e avisa o ponto cego da busca.

## PENDENTE (explícito)

- **Pagamento — validação manual (sandbox):** criar conta/chaves Asaas,
  configurar o webhook (por último), simular pagar→desbloquear. Aprovação dos
  **templates de cobrança na Meta** (avisos fora da janela 24h). Pix Automático
  fino = refinamento futuro.
- Adapters reais ainda stubs: `courts`, `storage`, **fonte de jurisprudência**.
  (`whatsapp`, `llm`, `payment`/Asaas, `embeddings` e **fonte de legislação/Planalto**
  já são reais.)
- **Cérebro 2 — corpus carregado e validado pela CLI (feito); falta:** **agendar o
  Railway Cron semanal** e **validar pelo WhatsApp** (depende do chip). Carga/sync via
  `npm run ingest:corpus`/`sync:corpus`; confirmar via `corpus_sync_runs`/`corpus_normas`.
- **Memória de conversa — FEITA (Passo 9)** e validada pela CLI; falta só validar
  pelo WhatsApp (chip). Próxima evolução possível (registrada): passo dedicado de
  "reescrever para pergunta autônoma" se a resolução por embedding se mostrar ambígua
  (ex.: "o artigo seguinte" hoje é resolvido como referência, mas a recuperação do
  artigo exato é fraca → recusa em vez de inventar).
- **Lembrete proativo — FEITO (Passo 10), validável por dry-run.** PENDENTE (chip):
  **aprovar o template `lembrete_generico` na Meta**, **agendar o Railway Cron** (15 min)
  e **validar o envio real** pelo WhatsApp. O código já usa o template; só o envio real
  espera o chip + aprovação.
- **Jurisprudência — agregador pago:** plugar adapter real no `SourcePort` (stub
  pronto), respeitando os termos de uso; usa a MESMA sincronização. Ampliar o
  manifesto de legislação conforme necessário.
- **Validar em produção** (acumulado): Cérebro 1, pagamento sandbox (6B), RAG.
- **Onboarding — verificação real da inscrição na OAB** contra fonte externa
  (removida do fluxo obrigatório; pode virar opção futura).
- **Documentos:** **busca (12B) — FEITA e validada de ponta a ponta** (`doc:doctor` →
  `doc:bucket` → `doc:process` → `doc:reindex` → `doc:search`). O **bucket** se cria com
  `npm run doc:bucket` (já criado no projeto atual). PENDENTE: **OCR** de imagem/PDF
  escaneado (ponto cego da busca); **download de mídia pelo WhatsApp** (código pronto,
  valida com o chip). Eventual: repedir o resumo a partir de um resultado da busca.
- **WhatsApp:** **download de mídia** (mídia recebida hoje → placeholder até o chip);
  template aprovado na Meta.
- **Fila durável do webhook** (ack rápido + worker) — caminho de escala.
- **Cérebro 3 (tribunais)** — agregador (próximo dos cérebros).
- **Cérebro 1 — incrementos restantes:** custos/honorários (financeiro). Editar/
  remover compromisso e editar/arquivar processo já FEITOS (Passo 11); exclusão
  destrutiva de processo deixada de fora de propósito (arquivar é o seguro).
- Captura de `entrada`/`saida` no log (hoje `null`): só após estender a anonimização.
- Provisionamento Supabase (projeto, pooler, role sem BYPASSRLS, backups/PITR).
- **Pruning** das linhas antigas de `whatsapp_mensagens_processadas` e
  `onboarding_estado` abandonados (operação).
- **Dunning/lembretes** de cobrança (pré-vencimento, suspensão) e conciliação
  periódica com o Asaas — fase de operação do pagamento.

## Próximos passos previstos

1. **Agendar os Railway Crons** (sync semanal + lembretes 15 min), **aprovar o template
   na Meta**, **criar o bucket `documentos`** e **validar pelo WhatsApp** (memória, C1,
   RAG, lembrete, documentos) quando houver chip; pagamento sandbox (6B).
2. **Jurisprudência — agregador pago** ou **Cérebro 3 (tribunais)**.
3. Financeiro (honorários/custos); **OCR** de documentos (fecha o ponto cego da busca).

## Como rodar

Ver [`README.md`](./README.md). Resumo: `npm install` → preencher `.env` (base em
`.env.example`) → banco via Supabase CLI → `npm run dev` → `GET /health`.

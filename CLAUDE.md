# CLAUDE.md

Regras e contexto para o Claude Code trabalhar neste repositório. **Leia também `PLANEJAMENTO.md`** (visão, arquitetura e modelo de dados completos) e as skills em `.claude/skills/`.

## Contexto

Assessor jurídico pessoal que funciona pelo WhatsApp. Advogados conversam em linguagem natural; o sistema executa ações (processos, prazos, financeiro) e responde dúvidas jurídicas **sempre com fonte verificável (RAG)**. Público: advogados autônomos e escritórios pequenos/médios.

**Prioridade absoluta deste projeto:** confiabilidade, robustez e segurança dos dados e das fontes — acima de velocidade e custo. Em qualquer dúvida de design, escolha a opção mais segura e auditável.

## Arquitetura — os três cérebros (NUNCA misturar)

O orquestrador classifica a intenção da mensagem e roteia para **um** cérebro:

1. **Dados do advogado** — processos/prazos/financeiro. Linguagem natural → consulta estruturada (SQL) no Postgres. Só lê/grava registros reais. *Não* usar embeddings aqui.
2. **Conhecimento jurídico (RAG)** — leis e jurisprudência reais, corpus curado. Recupera primeiro, responde depois, sempre com citação. Sem fonte → recusa.
3. **Tribunais** — andamento via agregador (adapter). Consulta ao vivo + webhook.

Mantenha **geração de texto** separada de **recuperação de dados**. Ver a skill `rag-juridico-confiavel`.

## Regras inegociáveis de IA

- **Nunca invente** lei, artigo, súmula ou jurisprudência. Sem fonte recuperada → responda que não encontrou.
- **Toda afirmação jurídica leva citação** (lei + artigo, ou identificação do precedente). Valide a citação contra a fonte antes de exibir.
- **A IA não decide nada juridicamente.** Saídas que viram peça/petição levam aviso de revisão obrigatória pelo advogado.
- **Contexto mínimo ao LLM.** Envie só o necessário; nunca despeje o banco inteiro no prompt.

## Segurança e dados (ver skill `seguranca-dados-sigilo`)

- Dado de cliente é **sensível**. Minimize e **anonimize/pseudonimize antes de enviar ao LLM** quando possível.
- **Isolamento por assinante**: toda query filtra por `assinante_id`, validado a partir da identidade autenticada (não de valor vindo na mensagem). Um assinante nunca vê dado de outro. Use **RLS do Supabase** como garantia além do filtro na aplicação — ver skill `banco-supabase`. A chave `service_role` **ignora o RLS**: use-a só em back-office/migrações, nunca no fluxo normal de um assinante.
- **Segredos fora do código** (variáveis de ambiente / secret manager). Nunca commitar chaves, tokens ou credenciais.
- **Criptografia** em trânsito (TLS) e em repouso para dados sensíveis.
- **Logs imutáveis** de cada interação: intenção, entrada, cérebro usado, fontes citadas, saída — sem dado sensível em claro.
- Provedor de LLM deve ter **política de não-treinamento** sobre nossos dados.

## Banco de dados (Supabase)

Ver a skill `banco-supabase` para os detalhes. Em resumo:

- **RLS é a base do isolamento multi-tenant.** Toda tabela com dado de assinante tem RLS habilitado e política por tenant. RLS é a garantia; o filtro na aplicação é a primeira linha.
- **`service_role` ignora RLS** — restrito a back-office e migrações; nunca no caminho de um assinante.
- **pgvector** guarda o corpus do RAG (Cérebro 2), separado dos dados de tenant.
- **Storage** privado para documentos, com URLs assinadas (sigilo).
- **Alto volume:** use o **pooler de conexões** (Supavisor, modo transaction); crie índices nas FKs (`assinante_id`, `processo_id`) e nas colunas de filtro.

## Pagamentos

- Use a **camada de abstração de pagamento** (adapter); não acople o código ao gateway específico.
- **Webhooks idempotentes**: trate reentrega e duplicação; cada evento processado uma única vez.
- A notificação de vencimento respeita a janela do Pix Automático (cancelamento até 24h antes do débito).
- Nunca confie em valor/status vindo do cliente; confirme no gateway.

## WhatsApp

- Mensagem proativa (cobrança, lembrete) **só por template aprovado**.
- Conversa livre só dentro da **janela de 24h** após o usuário escrever.
- Trate o número de telefone como identidade do assinante.

## Convenções de código

- **Camadas (ports & adapters):** o domínio não conhece detalhes de gateway/agregador/WhatsApp/LLM; tudo via interface.
- Adapters trocáveis: `payment`, `courts`, `whatsapp`, `storage`, `llm`.
- Funções pequenas, nomeadas pela intenção de negócio. Erros tratados explicitamente, nunca silenciados.
- **Testes** para: classificação de intenção, NL→SQL (Cérebro 1), recusa-sem-fonte e citação (Cérebro 2), idempotência de webhook, isolamento por assinante.
- Migrações de banco versionadas (Supabase CLI). Nada de schema improvisado em produção. O tráfego da aplicação usa o **pooler de conexões** do Supabase (modo transaction); `pgvector` para o RAG; **Storage** privado para documentos.

## Como trabalhar neste repo

- Antes de uma mudança grande, releia `PLANEJAMENTO.md` e a skill relevante; descreva o plano antes de implementar.
- Respeite a fase atual do roadmap; não construa funcionalidade de fase futura sem combinar.
- Ao criar um novo cérebro/adapter, documente a interface.
- Atualize `PLANEJAMENTO.md` quando uma decisão de fundação mudar.

## NUNCA

- Misturar os três cérebros num prompt único.
- Exibir conteúdo jurídico sem fonte verificada.
- Enviar dado de cliente identificável ao LLM sem necessidade / sem anonimizar.
- Commitar segredo.
- Processar pagamento sem idempotência.
- Deixar query sem filtro por `assinante_id`.
- Usar a chave `service_role` do Supabase em operação de um assinante (ela ignora o RLS).
- Deixar tabela com dado de assinante sem RLS habilitado.

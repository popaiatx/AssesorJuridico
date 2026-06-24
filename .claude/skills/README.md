# Skills do projeto

Skills são módulos de instruções que o Claude Code carrega **sob demanda** para tarefas recorrentes e sensíveis deste projeto. No repositório, ficam em `.claude/skills/` (cada skill numa pasta com seu `SKILL.md`).

Diferença para o `CLAUDE.md`: o `CLAUDE.md` é lido **sempre** (regras gerais); uma skill é lida **quando a tarefa correspondente aparece** (instruções detalhadas).

## Onde colocar no repositório

```
seu-projeto/
├── CLAUDE.md                          ← raiz do repositório
├── PLANEJAMENTO.md                    ← raiz do repositório
└── .claude/
    └── skills/
        ├── banco-supabase/
        │   └── SKILL.md
        ├── rag-juridico-confiavel/
        │   └── SKILL.md
        ├── seguranca-dados-sigilo/
        │   └── SKILL.md
        ├── whatsapp-orquestracao/
        │   └── SKILL.md
        ├── nl-para-sql/
        │   └── SKILL.md
        ├── integracao-tribunais/
        │   └── SKILL.md
        ├── pagamento-recorrente/
        │   └── SKILL.md
        └── prazos-processuais/
            └── SKILL.md
```

## Skills atuais

**Fundação técnica e segurança**
- **banco-supabase** — como usar o Supabase de forma escalável, segura e confiável: RLS para isolamento multi-tenant, pgvector para o RAG, Storage para documentos, pooler de conexões para alto volume, migrações e índices.
- **seguranca-dados-sigilo** — tratamento de dados de clientes com segurança e conformidade (LGPD, OAB): anonimização antes do LLM, isolamento por assinante, criptografia, logs, direitos do titular.

**Os três cérebros**
- **nl-para-sql** — Cérebro 1: transformar linguagem natural em leituras/escritas seguras dos dados do próprio advogado, sempre com escopo de tenant.
- **rag-juridico-confiavel** — Cérebro 2: RAG jurídico confiável — recuperar antes de responder, citação obrigatória, recusa sem fonte, validação de citação.
- **integracao-tribunais** — Cérebro 3: adapter do agregador de tribunais, monitoramento por webhook, normalização e controle de custo.

**Canal e fluxos de negócio**
- **whatsapp-orquestracao** — porta de entrada: classificação de intenção, roteamento para um único cérebro, janela de 24h, templates e onboarding conversacional.
- **pagamento-recorrente** — assinatura via Pix Automático + cartão, idempotência de webhook, máquina de estados, cobrança/suspensão e conciliação.
- **prazos-processuais** — cadastro de compromissos/prazos por linguagem natural, lembretes e cálculo assistido (sempre com aviso de conferência obrigatória).

## Como adicionar uma skill

1. Crie `.claude/skills/<nome>/SKILL.md`.
2. No topo, frontmatter YAML com `name` e `description`. A `description` é o gatilho — diga **o que faz** e **quando usar**.
3. Corpo em markdown, instruções no imperativo, explicando o **porquê** (não só o "o quê").
4. Mantenha abaixo de ~500 linhas; conteúdo extenso vai para uma subpasta `references/` dentro da skill.

# Migrações via Supabase CLI (Windows)

Referência curta para manter o schema **sempre versionado e aplicado pelo CLI** —
nunca mais SQL à mão. Estado canônico do projeto: `ESTADO_DO_PROJETO.md`.

## Princípio

- As migrações vivem em `supabase/migrations/` (`0001…0019`), em ordem.
- **Elas não são idempotentes** (`create table`/`create policy` sem `if not exists`):
  re-aplicar um arquivo já presente **falha** com "already exists". Por isso o CLI
  controla o que já foi aplicado numa tabela de tracking
  (`supabase_migrations.schema_migrations`) e só aplica o que falta.
- Regra de ouro: **nunca** rode SQL de schema direto no painel. Sempre
  `supabase migration new` → escreva o SQL → `supabase db push`.

## Setup (uma vez)

```powershell
# Instalar o CLI (Scoop é o caminho oficial no Windows)
irm get.scoop.sh | iex
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
supabase --version            # confirma a instalação

supabase login                # abre o navegador, cola o token
supabase link --project-ref <PROJECT_REF>   # ref: Dashboard > Project Settings > General
```

> `npm i -g supabase` **não** é suportado — use Scoop (ou o binário das releases).

## Fluxo do dia a dia (criar e aplicar migração)

```powershell
supabase migration new minha_mudanca     # cria supabase/migrations/<ts>_minha_mudanca.sql
# edite o arquivo com o SQL
supabase db push                          # aplica no remoto o que falta
supabase migration list                   # confere: Local == Remote
```

Encerramento de cada passo do projeto continua: atualizar `ESTADO_DO_PROJETO.md` →
commit → push (convenção C do `CLAUDE.md`).

## Reconciliar um banco em estado parcial (aplicado à mão)

Ver o guia completo no histórico do chat. Resumo:

1. `supabase migration list` — ver o que o tracking conhece.
2. Inspecionar os objetos REAIS no banco (query em `docs/` / chat).
3. Para cada migração cujos objetos **já existem por inteiro**:
   `supabase migration repair --status applied <versao>` (marca aplicada **sem**
   reexecutar). Ex.: `supabase migration repair --status applied 0001 0002 ... 0018`.
4. `supabase db push` aplica só o que falta (ex.: `0019`).
5. `supabase migration list` deve mostrar Local == Remote e `db push` rodar limpo.

**Alternativa limpa (só com dados descartáveis):** `supabase db reset --linked`
**APAGA o banco remoto** e reaplica todas as migrações do zero — termina garantidamente
consistente. Use apenas se não houver dados a preservar.

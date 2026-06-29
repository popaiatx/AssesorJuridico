# Spike 8B — Fonte de legislação (LexML vs Planalto-only)

> **Tipo:** decisão de arquitetura (não é código de produção).
> **Data do spike:** 2026-06-29. **Método:** sondagem empírica dos endpoints reais
> (curl), com normas do conjunto inicial (CDC 8.078/1990, CPC 13.105/2015, e o
> Código Civil de 1916 — sabidamente revogado — como caso de revogação).

## Pergunta do spike

Para a sincronização automática do corpus (8B) precisamos de uma fonte que entregue,
de forma **legível por máquina e confiável**:

1. **vigência/revogação** (nunca servir norma revogada como vigente);
2. **detecção de mudança** ("o que mudou desde a data X" / harvest incremental);
3. **texto consolidado citável** para chunk + embed.

Dois caminhos a decidir:
- **(a)** LexML (metadados/vigência) + Planalto (texto) — o ideal, *se* o LexML
  entregar vigência e harvest incremental de forma utilizável;
- **(b)** Planalto-only com detecção de mudança por **hash de conteúdo** — fallback
  robusto, *se* o LexML não entregar.

## O que a fonte realmente devolve (evidência)

### LexML — resolvedor de URN (`/urn/...`)
- `GET https://www.lexml.gov.br/urn/urn:lex:br:federal:lei:1990-09-11;8078` → **HTTP 200**,
  porém **HTML orientado a humano** (framework XTF, ~386 KB).
- **Sem JSON-LD, sem Schema.org/Legislation, sem Dublin Core/`dcterms`.** A negociação
  de conteúdo `Accept: application/rdf+xml` é **ignorada** (devolve o mesmo HTML).
- Metadado "estruturado" disponível = apenas a meta `KEYWORDS`:
  `Código de Defesa do Consumidor (1990), Legislação::Lei, 8078/1990, 11/09/1990, Federal, Brasil`.
- **Vigência/alteração aparecem só como TEXTO LIVRE**, ex.:
  `"alterada pela medida provisória 1930, de 29 de novembro de 1999, e d..."` — não é
  campo legível por máquina; exigiria parsing frágil de prosa.

### LexML — serviços de API/harvest (SRU / OAI-PMH)
- `robots.txt` **anuncia** `Allow: /sru` e `Allow: /urn`, mas na prática:
  - `GET /sru?operation=explain` → **HTTP 404** (nginx).
  - `GET /busca/SRU?operation=searchRetrieve...` → **HTTP 404** (3/3 tentativas).
  - `GET /busca/oai?verb=Identify` → **HTTP 404**.
- Ou seja, **o serviço de busca/harvest documentado não responde** nos caminhos
  conhecidos. Sem SRU/OAI não há **harvest incremental** ("mudou desde X").

### Portal moderno `normas.leg.br`
- `GET https://normas.leg.br/` → **HTTP 200** (`<title>Normas.leg.br: Legislação Federal</title>`),
  mas é **SPA Angular** (`main.<hash>.js`, `polyfills`, `runtime`); a API é **interna**
  (backend Spring — `GET /api/` devolve 404 no formato `{"timestamp","status","error","path"}`).
- Não há **contrato público documentado**; consumir exigiria engenharia reversa de
  bundle minificado e dependeria de endpoint interno **sujeito a mudar sem aviso**.

### Senado Dados Abertos
- Base `/dadosabertos` resolve, mas a API "matéria" trata do **processo legislativo**,
  não do **texto consolidado/vigência** das normas. Não serve ao nosso caso.

### Planalto — texto consolidado (o que o 8A já usa)
- HTML estável em URL conhecida por norma (latin1). Marca revogação de forma
  **detectável**:
  - **Norma inteira revogada** (CC/1916, `l3071.htm`): cabeçalho com
    `"... Revogada pela Lei nº ..."`.
  - **Revogação por artigo** (CC/2002, `l10406compilada.htm`): **85** marcadores
    `(Revogado)` / `(Revogado pela Lei nº ...)` inline no texto consolidado.
  - **Código ativo** (CDC, `l8078compilado.htm`): **0** marcadores `(Revogado)` —
    coerente (é vigente).

## Conclusão dos fatos

| Requisito | LexML hoje | Planalto |
|---|---|---|
| Vigência/revogação **legível por máquina** | ❌ só texto livre no `/urn`; SRU/OAI 404 | ⚠️ via marcador textual estável no HTML consolidado (norma e artigo) |
| **Harvest incremental** ("mudou desde X") | ❌ SRU/OAI indisponíveis | ➖ não há feed; resolvido por **hash de conteúdo** por norma |
| **Texto consolidado citável** | ❌ não hospeda o consolidado de forma estável | ✅ é a fonte consolidada oficial |
| **Robustez/contrato estável** | ❌ resolvedor humano + API interna de SPA | ✅ URLs estáveis, já em uso no 8A |

A premissa que justificaria o caminho (a) — **metadado de vigência legível por
máquina + harvest incremental** — **não é obtível hoje** pela interface pública do
LexML. Apoiar o adapter no HTML do `/urn` (prosa) ou na API interna do `normas.leg.br`
seria *scraping frágil disfarçado de metadado*, em conflito direto com a prioridade do
projeto (confiabilidade/robustez acima de tudo).

## Recomendação

**Seguir pelo caminho (b): Planalto-only com detecção de mudança por hash de
conteúdo — agora**, mantendo o **`SourcePort` provider-agnostic** para plugar, no
futuro, um adapter de metadados (LexML/`normas.leg.br`) **ou** um agregador pago,
**se e quando** uma fonte de vigência legível por máquina e estável for confirmada.

Isto **não** é um downgrade: é exatamente o fallback robusto pré-aprovado, e o spike
mostra que é a escolha sólida, não um compromisso.

### Como o caminho (b) cobre os 3 requisitos

- **Mudança:** `fonte_hash` = SHA-256 do **texto normalizado** por norma. Igual → skip
  (idempotente, custo zero de embedding); diferente → re-chunk + re-embed só dela.
  Determinístico, sem depender de API de metadados.
- **Revogação:** detector textual no Planalto —
  - *norma inteira*: marcador `Revogad[ao] (pela|por)` no cabeçalho/ementa →
    `vigencia_status = 'revogada'` + `revogada_em`;
  - *artigo*: `(Revogado...)` já vem **no texto do chunk**, então o trecho carrega a
    própria marca; e a norma revogada inteira **nunca entra no allowlist de afirmação**
    (regra de vigência na busca, aditiva ao 8A).
- **Texto citável:** o consolidado do Planalto, como no 8A — citação preservada
  (`identificador` + `fonte_url` + `vigencia_status`).

### Impacto no plano (inalterado no essencial)

- `SourcePort` continua provider-agnostic; o adapter concreto agora é
  `PlanaltoLegislacaoSource` (texto + detecção de revogação por marcador); o slot de
  metadados externos (LexML/normas) fica como **interface pronta, não implementada**,
  ao lado do **stub de jurisprudência** (agregador pago futuro).
- Migração 0019, motor de sync reutilizável, cadência semanal + sync manual, vigência
  na busca, resiliência por norma — **tudo como planejado**.

## Próximo passo

Aguardando confirmação do caminho **(b)** para seguir aos Commits 2–6.

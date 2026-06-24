---
name: integracao-tribunais
description: Como construir o Cérebro 3 — integração com dados de tribunais via agregador pago, com adapter, consulta processual, monitoramento de movimentações por webhook, normalização e controle de custo. Use SEMPRE que for integrar consulta/andamento processual, escrever o adapter do agregador (Judit/Escavador/Codilo/Digesto), tratar webhooks de movimentação, ou usar o DataJud como fonte complementar.
---

# Cérebro 3 — integração com tribunais

O Cérebro 3 traz dados vivos dos tribunais: andamento processual e movimentações. A fonte é um **agregador pago** (Judit, Escavador, Codilo, Digesto) atrás de um adapter; o **DataJud (CNJ)** entra como complemento gratuito (metadados, sem conteúdo sigiloso). O foco é confiabilidade do dado, robustez frente a instabilidade do provedor e controle do custo (consultas são cobradas).

## Princípio central

**O domínio nunca fala com o SDK do provedor direto.** Tudo passa por uma interface (`courts` port), com um adapter concreto por provedor. Trocar de agregador deve ser trocar o adapter, não reescrever o sistema.

## Interface do provedor (port)

Defina uma interface estável, por exemplo:

- `consultarProcesso(numeroCnj)` — dados atuais da capa e movimentações.
- `monitorarProcesso(numeroCnj)` — registrar acompanhamento contínuo.
- `pararMonitoramento(numeroCnj)`.
- recepção de **webhook de movimentação** — o provedor avisa quando algo anda.

Cada agregador retorna formatos diferentes; o adapter converte para o nosso modelo.

## Monitoramento por webhook (preferir a polling)

- Registre os processos do assinante para monitoramento e **receba movimentações por webhook** — é mais barato e mais rápido que ficar consultando.
- **Verifique a assinatura** do webhook (autenticidade).
- **Idempotência:** deduplique por id/hash da movimentação; processe cada uma uma única vez.
- Persista a movimentação **normalizada** e **notifique o advogado** pelo WhatsApp (respeitando a janela de 24h/template — ver `whatsapp-orquestracao`).

## Normalização

- Converta a resposta de cada provedor para o modelo `Movimentação` (data, descrição, fonte, hash) e para os campos de capa do `Processo`. A aplicação enxerga sempre o mesmo formato, não importa o provedor.

## Robustez e custo

- **Retentativas com backoff** nas consultas; trate indisponibilidade do provedor sem derrubar o fluxo (enfileire/retente).
- **Cache** consultas recentes e **deduplique** pedidos para não pagar duas vezes pela mesma informação.
- Respeite **rate limits** do provedor.
- Prefira **monitoramento** a varredura periódica para reduzir custo e latência.

## Cuidado com os dados

- Dados de tribunal trazem **dados pessoais das partes** → tratamento sob LGPD (ver `seguranca-dados-sigilo`).
- **Segredo de justiça:** tratamento reforçado; não exponha conteúdo a serviços externos por padrão. O DataJud já resguarda processos sigilosos; respeite o mesmo no agregador.
- Exponha ao advogado só o necessário, de forma clara.

## Exemplos

**Adapter trocável**
A aplicação chama `courts.consultarProcesso(...)`; por trás está o adapter do agregador atual. Trocar de provedor = novo adapter implementando a mesma interface.

**Webhook idempotente**
Chega movimentação já recebida (reentrega) → detecta pelo hash, ignora a duplicata, não notifica de novo.

**Controle de custo**
Duas consultas iguais ao mesmo processo em minutos → a segunda usa o cache, sem nova cobrança.

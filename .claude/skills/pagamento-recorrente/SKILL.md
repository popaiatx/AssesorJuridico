---
name: pagamento-recorrente
description: Como construir o ciclo de assinatura e cobrança do produto — Pix Automático e cartão recorrente via adapter de pagamento, idempotência de webhook, máquina de estados da assinatura, lembretes de vencimento, suspensão por inadimplência e conciliação. Use SEMPRE que for trabalhar em assinatura, cobrança, gateway, webhook de pagamento, renovação, inadimplência ou status financeiro da conta.
---

# Pagamento recorrente e ciclo de assinatura

Este módulo cuida do dinheiro do negócio: cobrar a assinatura de forma confiável, sem cobrança duplicada e sem ativar conta que não pagou. A forma principal é **Pix Automático**; cartão recorrente como alternativa. Tudo atrás de um adapter de pagamento (default Asaas).

## Princípio central

**O gateway é a fonte da verdade do pagamento; nunca o cliente.** Confirme valor e status sempre no provedor, e trate cada evento de webhook de forma **idempotente**.

## Adapter de pagamento (port)

Defina uma interface estável: `criarAssinatura`, `criarCobranca`, `cancelarAssinatura`, `consultarStatus`, recepção de **webhook**. O domínio não acopla ao SDK do gateway — trocar de provedor é trocar o adapter.

## Pix Automático

- O cliente **autoriza a recorrência uma única vez** no app do banco (definindo valor máximo e periodicidade); depois os débitos ocorrem automaticamente. Não exige convênio bancário.
- **Regra que afeta o produto:** o cancelamento da autorização ocorre até **24h antes** do débito. Os lembretes de renovação devem ser enviados **antes** dessa janela.
- Ofereça **cartão recorrente como alternativa** pelo mesmo adapter.

## Idempotência de webhook (crítico)

- Webhooks de pagamento podem ser **reentregues**. Deduplique por **id do evento**; processe cada evento uma única vez.
- **Verifique a assinatura** do webhook.
- Atualize o status da assinatura de forma **transacional**. Nunca ative duas vezes, nunca cobre duas vezes.

## Máquina de estados da assinatura

Modele transições explícitas: `trial` → `ativo` → `inadimplente` → `suspenso` → `cancelado` (com reativação a partir de pagamento). Defina o que cada estado libera:

- `ativo`: acesso pleno.
- `inadimplente`: após falha de cobrança, ainda com tentativas/lembretes.
- `suspenso`: acesso bloqueado após esgotar as tentativas.
- reativação: pagamento confirmado volta para `ativo`.

## Lembretes e cobrança (dunning)

- Sequência de avisos pelo WhatsApp (via **template**, pois normalmente fora da janela de 24h — ver `whatsapp-orquestracao`): pré-vencimento → vencimento → pós-vencimento (retentativa) → aviso de suspensão.
- Mensagens claras e sem expor dados sensíveis.

## Conciliação

- Rode **conciliação periódica** entre os registros do gateway e os nossos — é a rede que pega webhooks perdidos e divergências.

## Segurança

- **Nunca armazene dados de cartão** (PCI). Use tokenização do gateway.
- Segredos do gateway só no servidor (ver `seguranca-dados-sigilo` e `banco-supabase`).

## Exemplos

**Webhook idempotente**
Chega confirmação de pagamento já processada → detecta pelo id do evento, ignora, não reativa de novo.

**Renovação respeitando a janela do Pix**
Débito previsto para o dia 10 → lembrete enviado com antecedência suficiente para o cliente agir antes das 24h que precedem o débito.

**Inadimplência**
Cobrança falha → estado vai para `inadimplente`, dispara sequência de lembretes; esgotadas as tentativas, vai para `suspenso` e bloqueia o acesso; pagamento posterior reativa.

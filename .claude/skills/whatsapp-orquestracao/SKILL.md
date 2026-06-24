---
name: whatsapp-orquestracao
description: Como construir a porta de entrada do produto no WhatsApp: receber/enviar mensagens, classificar a intenção, rotear para um único cérebro, respeitar a janela de 24h, usar templates aprovados e conduzir o onboarding conversacional. Use SEMPRE que for trabalhar no webhook do WhatsApp, classificação de intenção, roteamento, envio de notificações proativas, templates ou no fluxo de cadastro de novos usuários.
---

# Orquestração do WhatsApp

Esta é a porta de entrada. Cada mensagem do advogado passa por aqui: o orquestrador entende a intenção, escolhe **um** cérebro (nunca mistura — ver `CLAUDE.md`), executa e devolve a resposta. É também onde mora a regra de mensageria do WhatsApp, que tem restrições próprias.

## Fluxo de cada mensagem

1. **Receber** o webhook do WhatsApp e responder rápido (ack), processando em seguida.
2. **Identificar o assinante** pelo número de telefone → resolver para `assinante_id`. Número desconhecido → fluxo de onboarding.
3. **Classificar a intenção** da mensagem.
4. **Rotear** para o cérebro/módulo correspondente.
5. **Formatar** a resposta para o WhatsApp e **enviar**.
6. **Registrar** a interação (log imutável; ver `seguranca-dados-sigilo`).

## Classificação de intenção

Mapeie a mensagem para um conjunto pequeno e claro de intenções, por exemplo:

- `onboarding` — número novo ou cadastro incompleto.
- `consulta_dados` — dados do próprio advogado (Cérebro 1).
- `duvida_juridica` — pergunta sobre lei/jurisprudência (Cérebro 2).
- `consulta_andamento` — andamento processual (Cérebro 3).
- `agendar` — audiência/compromisso/prazo.
- `financeiro` — custos, honorários, cobranças.
- `documento` — enviar/buscar arquivo.
- `assinatura` — pagamento, plano, situação da conta.
- `ajuda` / `outro` — fallback.

Se a intenção estiver ambígua, **pergunte** em vez de adivinhar. Um chute errado quebra a confiança.

## Roteamento: um cérebro por mensagem

- Cada mensagem aciona **um** cérebro. Não monte um prompt que mistura dados do advogado com conhecimento jurídico.
- Quando o pedido exige dois (ex.: "qual a base legal do meu processo X?"), faça em **etapas orquestradas**: Cérebro 1 busca o processo → Cérebro 2 responde a parte jurídica com citação. Cada etapa com sua fonte.

## Janela de 24h e templates (regra do WhatsApp)

- **Resposta livre** (texto à vontade) só dentro de **24h** desde a última mensagem do usuário. Rastreie essa janela por contato.
- **Mensagem proativa** fora da janela (lembrete de prazo, cobrança, renovação) exige **template aprovado** pela Meta.
- Mantenha um **registro de templates** (nome, categoria, parâmetros). Lembretes e avisos transacionais entram como categoria utilitária; conteúdo promocional é outra categoria e tem regras próprias.

## Onboarding conversacional

Conduza como uma **máquina de estados**, um passo por vez: boas-vindas → coleta de dados (nome, OAB, documento, e-mail) → validação da inscrição na OAB → apresentação do termo de consentimento de uso de IA → criação da assinatura (ver `pagamento-recorrente`) → ativação → tutorial curto. Salve o estado para retomar de onde parou.

## Robustez

- **Idempotência:** a Meta pode reentregar webhooks. Deduplique por id da mensagem; processe cada uma uma única vez.
- **Mídia:** mensagens com arquivo → enviar para o Storage e vincular ao processo (ver `banco-supabase`).
- **Limites e falhas:** respeite limites de envio; trate erros sem expor detalhes internos ao usuário; em caso de falha, responda algo útil e registre o erro.
- **Nunca** envie conteúdo jurídico sem passar pelo Cérebro 2; nunca devolva stack trace ou mensagem técnica crua ao advogado.

## Exemplos

**Pedido combinado (duas etapas)**
Entrada: "Me diz o prazo de recurso do meu processo 0001234-..."
Comportamento: Cérebro 1 confirma o processo e o tipo → Cérebro 2 responde a regra de prazo com citação (e, se virar cálculo, aplica `prazos-processuais` com aviso de conferência).

**Fora da janela de 24h**
Lembrete de honorário a vencer amanhã, mas o advogado não escreve há 3 dias → enviar via template aprovado, não como texto livre.

**Intenção ambígua**
Entrada: "e aquele caso?"
Comportamento: pedir esclarecimento (qual processo/cliente) antes de acionar qualquer cérebro.

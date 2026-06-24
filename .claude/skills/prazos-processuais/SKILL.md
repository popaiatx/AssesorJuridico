---
name: prazos-processuais
description: Como construir o cadastro de compromissos e prazos por linguagem natural, os lembretes proativos e o cálculo assistido de prazos — sempre com aviso de conferência obrigatória pelo advogado. Use SEMPRE que a intenção envolver agendar audiência/reunião/prazo, calcular prazo processual, ou programar lembretes. Nunca apresente um prazo calculado como definitivo.
---

# Prazos e compromissos processuais

Prazo é a área de maior risco para o advogado: perder um prazo tem consequência grave. Por isso este módulo registra e lembra com robustez, e trata cálculo de prazo como **assistência, nunca como autoridade**.

## Princípio central

**O advogado é o responsável pelo prazo.** Todo prazo calculado é uma sugestão acompanhada de um aviso explícito de conferência. O sistema nunca afirma um prazo como definitivo.

## Por que tanta cautela no cálculo

As regras de prazo no Brasil são complexas e variam: dias úteis no CPC, dias corridos em outras searas, feriados nacionais **e locais**, suspensões e recesso forense, regras de início pela intimação. Errar qualquer uma dessas variáveis muda a data. Logo:

- Calcule como **sugestão**, mostrando as **premissas** usadas (ex.: "considerando dias úteis, sem considerar feriados locais").
- Sempre acompanhe de aviso para o advogado **conferir** antes de confiar.
- Se a pergunta depende de **regra jurídica** (qual prazo a lei prevê para tal ato), encaminhe a parte jurídica ao **Cérebro 2 (RAG)** com citação — não afirme a regra "de memória" aqui (ver `rag-juridico-confiavel`).

## Cadastro por linguagem natural

- Extraia da mensagem: tipo (audiência/reunião/prazo), data, hora, local, processo/cliente.
- **Confirme antes de salvar:** "Confirmar: audiência dia 12/08 às 14h, fórum central, processo 0001234-...?"
- Vincule ao processo/cliente; valide datas (ver `nl-para-sql` para a escrita segura e escopo de tenant).

## Lembretes proativos

- Agende **múltiplos lembretes** (ex.: alguns dias antes, na véspera, no dia) — antecedência configurável.
- Envie pelo WhatsApp; fora da janela de 24h, use **template** (ver `whatsapp-orquestracao`).
- O lembrete deve ser claro e acionável (o que é, quando, qual processo).

## Nunca

- Apresentar prazo calculado como definitivo, sem aviso de conferência.
- Afirmar regra de prazo da lei sem passar pelo Cérebro 2 (citação).
- Salvar compromisso sem confirmação do usuário.

## Exemplos

**Cadastro**
Entrada: "marca uma audiência dia 12/08 às 14h no fórum central pro processo do João"
Comportamento: extrai os dados → confirma → salva → agenda lembretes.

**Cálculo assistido com ressalva**
Entrada: "qual o último dia pra contestar?"
Comportamento: a regra do prazo vem do Cérebro 2 com citação; o cálculo da data é apresentado como sugestão, com as premissas e o aviso: "confira, a contagem pode variar com feriados locais e a data da intimação".

**Lembrete fora da janela**
Audiência amanhã, advogado sem mensagens recentes → lembrete via template aprovado.

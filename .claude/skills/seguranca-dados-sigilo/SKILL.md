---
name: seguranca-dados-sigilo
description: Como tratar dados de clientes com segurança, sigilo profissional e conformidade (LGPD, Recomendação OAB 001/2024) neste projeto. Use SEMPRE que for lidar com dados de clientes/processos, enviar qualquer conteúdo a um LLM ou serviço externo, modelar/consultar o banco, escrever logs, implementar onboarding/consentimento, ou tratar processos em segredo de justiça. Use também ao revisar qualquer fluxo que mova dados pessoais, para garantir anonimização, isolamento por assinante e criptografia.
---

# Segurança de dados e sigilo profissional

Os dados aqui são especialmente sensíveis: envolvem clientes de advogados e podem estar sob sigilo profissional e segredo de justiça. Vazamento ou uso indevido pode configurar, ao mesmo tempo, infração à LGPD, ao Estatuto da OAB e potencialmente crime. Por isso, segurança não é etapa final — é condição de cada fluxo que toca dado pessoal.

> Este conteúdo orienta a implementação, mas não substitui validação por advogado/DPO. Confirme as exigências legais aplicáveis antes do lançamento.

## Papéis e base legal

- O **advogado/escritório é o controlador**; **nós somos operador**. É preciso contrato de tratamento de dados (DPA) com cada assinante e com o provedor de LLM.
- O uso de IA deve ser **consentido**: o assinante aceita um termo no onboarding (a Recomendação OAB 001/2024 pede formalização prévia; o termo também orienta o advogado a informar os clientes dele).

## Minimização e anonimização antes do LLM

- Envie ao LLM **apenas o necessário** para a tarefa. Nunca o banco inteiro, nunca campos irrelevantes.
- **Anonimize/pseudonimize** dados identificáveis (nomes de partes, documentos) antes de enviar a serviços externos sempre que a tarefa permitir. Reidentifique localmente ao devolver a resposta ao advogado, se necessário.
- Processos em **segredo de justiça**: tratamento reforçado; por padrão não exponha conteúdo a serviços externos.
- Use provedor de LLM com **política de não-treinamento** sobre nossos dados e cláusula de confidencialidade.

## Isolamento por assinante (multi-tenant)

- **Toda** leitura/escrita filtra por `assinante_id`. Um assinante nunca pode acessar dado de outro.
- Valide o `assinante_id` a partir da identidade autenticada (telefone/sessão), **nunca** a partir de valor enviado na mensagem.
- Em queries geradas a partir de linguagem natural (Cérebro 1), aplique o filtro de tenant no nível da aplicação; não confie no texto da mensagem.

## Criptografia e segredos

- TLS em todo trânsito. Criptografia em repouso para campos sensíveis e documentos.
- Segredos (chaves de gateway, tokens de WhatsApp, API do agregador, chave do LLM) **fora do código**, em secret manager / variáveis de ambiente. Nunca commitar.
- Rotação de credenciais prevista.

## Logs e auditoria

- Registre cada interação de forma **imutável**: quem, quando, intenção, cérebro usado, fontes citadas, resultado.
- **Não** registre dado sensível em claro nos logs (mascarar/anonimizar). Log serve para auditoria, não para vazar.

## Direitos do titular (LGPD)

- Tenha fluxo para **acesso, correção e eliminação** de dados pessoais.
- Defina **política de retenção e descarte** (não guardar para sempre o que não precisa).

## Checklist antes de mover dado pessoal

1. Esse dado precisa mesmo sair daqui? (minimização)
2. Dá para anonimizar antes? (sim → anonimize)
3. O destino tem DPA e não treina com o dado? (não → não envie)
4. A operação está filtrada por `assinante_id`?
5. O log vai ficar sem dado sensível em claro?
6. É processo em segredo de justiça? (sim → tratamento reforçado)

## Exemplos

**Resumir movimentação de um processo**
Envie ao LLM o texto da movimentação com nomes das partes pseudonimizados ("Parte A", "Parte B"); reidentifique ao montar a resposta para o advogado.

**Consulta "meus processos ativos"**
Gere a query sempre com `WHERE assinante_id = :id_autenticado`; ignore qualquer id que apareça no texto da mensagem.

**Pedido de exclusão de dados**
Acione o fluxo de direitos do titular; não trate como conversa comum.

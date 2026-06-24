---
name: nl-para-sql
description: Como construir o Cérebro 1 — transformar linguagem natural em leituras e escritas seguras dos dados do próprio advogado (processos, prazos, custos, honorários, documentos). Use SEMPRE que a intenção for consultar/cadastrar/atualizar dados do escritório, ao gerar consultas a partir de texto livre, ou ao revisar qualquer ponto em que o LLM toque o banco. Garanta escopo de tenant, parametrização e confirmação antes de escrever.
---

# Cérebro 1 — linguagem natural para o banco

O Cérebro 1 é o mais confiável do sistema: ele só lê e grava **registros reais** do próprio advogado. Não usa embeddings nem "conhecimento geral" — é o advogado consultando os dados dele. A confiabilidade vem de manter o LLM longe de decisões perigosas sobre o banco.

## Princípio central

**O LLM entende a intenção; o código executa a consulta.** Não deixe o modelo emitir SQL livre que vai direto ao banco. SQL gerado sem controle abre porta para injeção, junções erradas e vazamento entre tenants.

## Abordagem segura (preferida)

- Mapeie cada intenção para um **conjunto de operações pré-definidas e parametrizadas** (ou um query builder tipado): "listar processos ativos", "cadastrar processo", "lançar honorário", etc. O LLM escolhe a operação e extrai os parâmetros; o código roda a query.
- Se, ainda assim, gerar SQL com o LLM, o SQL precisa: usar **valores parametrizados** (nunca interpolar texto do usuário), ser validado contra uma **allowlist de tabelas/colunas**, ser **somente leitura** salvo intenção explícita de escrita, e ser **sempre escopado por tenant**.

## Escopo de tenant é inegociável

- Toda consulta filtra por `assinante_id`, vindo da **identidade autenticada** (resolvida do telefone), nunca de algo no texto da mensagem.
- No Supabase, confie no **RLS como rede de proteção** além do filtro na aplicação (ver `banco-supabase`). Não use `service_role` aqui.

## Leituras

- Traga só os campos necessários (minimização; ver `seguranca-dados-sigilo`).
- Pagine listas longas; ofereça refinar ("quer só os ativos?") em vez de despejar tudo.
- **Padrão ler-depois-formatar:** o código executa a query e obtém as linhas; o LLM, se usado, apenas redige a resposta a partir dessas linhas — não decide e busca de forma livre no mesmo passo.

## Escritas

- **Confirme antes de gravar** algo importante ou destrutivo: "Confirmar: cadastrar processo 0001234-... para o cliente João?" Só grava após o "sim".
- **Valide a entrada:** número CNJ no formato correto, datas válidas, campos obrigatórios. Dado ruim entra como erro tratado, com pedido de correção — nunca como registro quebrado.
- Operações que mexem em dinheiro/prazo seguem também as skills `pagamento-recorrente` e `prazos-processuais`.

## Nunca

- Mandar o banco inteiro (ou tabelas cruas) para o LLM.
- Executar SQL com texto do usuário interpolado.
- Rodar consulta sem filtro de tenant.
- Gravar sem validação e sem confirmação do usuário em ações relevantes.

## Exemplos

**Consulta**
Entrada: "quais processos do cliente Maria estão ativos?"
Comportamento: intenção `consulta_dados` → operação "listar processos por cliente e status", parametrizada e escopada por `assinante_id` → resposta com os campos relevantes.

**Escrita com confirmação**
Entrada: "cadastra um processo novo pro cliente Pedro, número 0008765-..."
Comportamento: extrai e valida os dados → pede confirmação → grava → confirma o cadastro.

**Tentativa fora do escopo**
Entrada que tente referenciar id de outro assinante: ignore o id do texto; o filtro de tenant vem sempre da identidade autenticada.

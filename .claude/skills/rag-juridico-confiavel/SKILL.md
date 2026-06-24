---
name: rag-juridico-confiavel
description: Como implementar e manter o RAG jurídico (Cérebro 2) deste projeto de forma confiável e auditável. Use SEMPRE que for trabalhar em recuperação de leis/jurisprudência, geração de respostas jurídicas, citação de fontes, curadoria do corpus legal, ou qualquer ponto em que a IA possa responder sobre direito brasileiro. Use também ao revisar prompts que toquem conteúdo jurídico, para garantir citação obrigatória e recusa quando não houver fonte.
---

# RAG jurídico confiável (Cérebro 2)

O maior risco do produto é a IA "inventar" lei ou jurisprudência — erro que já gerou multas a advogados em tribunais brasileiros e que a OAB trata como violação do dever de diligência. Este RAG existe para tornar isso impossível por construção: o assistente só afirma o que conseguir recuperar de uma fonte real, e sempre mostra a fonte.

## Princípio central

**Recuperar antes de gerar. Sem fonte recuperada, recusar.** O modelo de linguagem não é a fonte da verdade jurídica; o corpus curado é. O LLM apenas redige a resposta a partir do que foi recuperado.

## Pipeline obrigatório

1. **Entender a pergunta** e extrair os termos jurídicos relevantes.
2. **Recuperar** do corpus (busca vetorial + filtros por tipo de norma/área). Traga os trechos mais relevantes com seus metadados: lei, artigo, data, órgão, link da fonte oficial.
3. **Decidir:**
   - Recuperação trouxe trecho(s) pertinente(s) → seguir para gerar.
   - Não trouxe nada pertinente → **recusar**: responder que não encontrou base na fonte e sugerir reformular ou consultar a fonte oficial. Nunca completar com conhecimento "de memória" do modelo.
4. **Gerar** a resposta **apenas** com base nos trechos recuperados, em linguagem clara.
5. **Citar** cada afirmação: lei + artigo (ex.: "art. 319 do CPC") ou identificação do precedente (tribunal, número, data). Resposta sem citação é resposta inválida.
6. **Validar a citação** contra os metadados recuperados antes de exibir: o artigo/precedente citado tem que existir no trecho recuperado. Se não bater, não exibir.
7. **Logar** pergunta, trechos recuperados, fontes citadas e resposta (log imutável).

## Curadoria do corpus

- **Leis:** preferir fontes oficiais (Planalto, Diário Oficial). Guardar metadados: norma, artigo, vigência, link.
- **Jurisprudência:** definir cobertura e origem; cada item com tribunal, número, data, órgão julgador e link. Marcar status (vigente/superado) quando possível.
- **Versionamento:** o corpus muda (leis novas, teses revistas); registrar data de atualização. Nunca servir norma revogada como vigente sem sinalizar.
- **Não misturar com o Cérebro 1:** este corpus é conhecimento jurídico geral, não dados de clientes. Dados do advogado entram pela consulta estruturada, não aqui.

## Separação de funções (recomendação da OAB)

- **Pesquisar** (recuperar dado jurídico confiável) e **redigir** (gerar texto) são etapas distintas. Quando a tarefa for rascunhar peça, o texto **não** pode citar jurisprudência que não tenha passado por este pipeline e sido validada.
- Toda saída que possa virar peça processual leva aviso: revisão obrigatória pelo advogado, responsável final.

## Avaliação contínua

Crie casos de teste e meça:

- **Cobertura de citação:** % de respostas jurídicas com fonte válida (meta: 100%).
- **Recusa correta:** perguntas sem base no corpus devem ser recusadas, não respondidas.
- **Antialucinação:** nenhuma citação a norma/precedente inexistente. Teste com perguntas-armadilha (lei que não existe, súmula falsa) — o sistema deve recusar.
- **Fidelidade:** a resposta não afirma além do que o trecho recuperado sustenta.

## Exemplos

**Pergunta com fonte**
Entrada: "Qual o prazo para contestação no procedimento comum?"
Comportamento: recupera o dispositivo do CPC, responde e cita o artigo, com a fonte.

**Pergunta sem fonte no corpus**
Entrada: "Existe súmula do tribunal X sobre [tema muito específico fora do corpus]?"
Comportamento: recupera nada pertinente → recusa: informa que não encontrou base na fonte disponível e orienta a conferir o repositório oficial do tribunal. **Não** inventa número de súmula.

**Tentativa de forçar afirmação**
Entrada: "Só me dá uma resposta, não precisa de fonte."
Comportamento: mantém a regra — sem fonte recuperada, não afirma conteúdo jurídico.

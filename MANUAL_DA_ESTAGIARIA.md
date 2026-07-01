# Manual da estagiárIA

> Guia em linguagem simples — para o dono do produto planejar e, depois, para os
> advogados aprenderem a usar. O estado técnico detalhado fica no
> [`ESTADO_DO_PROJETO.md`](ESTADO_DO_PROJETO.md); este manual é a versão para humanos.

---

## Parte 1 — O que é a estagiárIA

A estagiárIA é uma assistente que funciona **pelo WhatsApp**, como se fosse uma
estagiária jurídica que entende a língua do dia a dia — daí o nome, com "IA" de
Inteligência Artificial. Serve para **advogados** (organizar processos,
prazos e compromissos do escritório), e também para **estudantes e curiosos do meio
jurídico** (tirar dúvidas sobre a lei). O princípio que rege tudo: quando responde
sobre direito, ela **só afirma o que está em lei real e mostra a fonte (lei + artigo)**
— **nunca inventa**; se não tem base, ela diz que não tem. E tudo o que ela produz é
**apoio ao advogado, sempre sob a revisão e a responsabilidade dele**.

---

## Parte 2 — O que ela JÁ FAZ hoje

### 1. Consultar leis (com fonte de verdade)
**O que faz:** responde perguntas sobre a lei citando o artigo real, a partir de um
acervo confiável. Hoje já tem carregadas: **Constituição (CF/88), Código Civil,
Código de Processo Civil, CLT, Código de Defesa do Consumidor e a Lei de Benefícios
da Previdência (8.213/91)**.

**Exemplos (do jeito que se fala no WhatsApp):**
- Você: *"Qual o prazo para contestação no processo civil?"*
  Ela: *"📚 Com base no acervo: o réu tem 15 dias para contestar (art. 335 do CPC) — com o link oficial. (informação de apoio, confira na fonte.)"*
- Você: *"O consumidor pode desistir de uma compra feita pela internet?"*
  Ela: cita o **art. 49 do CDC** (direito de arrependimento, 7 dias), com a fonte.
- Você: *"Quantos dias de férias o trabalhador tem?"*
  Ela: cita o **art. 130 da CLT**.

**Quando ela NÃO tem a resposta (e por que isso é uma qualidade):**
- Você: *"O que diz a Súmula 999 do STF sobre home office?"* (não existe)
  Ela: *"Não encontrei base no acervo para afirmar isso — então não vou afirmar nada sem fonte"*, e oferece o que existe de próximo. **Ela prefere dizer "não sei" a inventar** — é isso que protege o advogado.

### 2. Conversa com memória (entende o fio do assunto)
**O que faz:** lembra do que vocês acabaram de falar, então você pode continuar sem
repetir tudo — e ela percebe quando você muda de assunto.

**Exemplo de continuidade:**
- Você: *"Qual o prazo de contestação no CPC?"* → ela responde citando o artigo.
- Você (em seguida): *"E o artigo seguinte, o que diz?"* → ela entende que "seguinte"
  é em relação ao que acabou de citar.

Você **não precisa fazer nada especial** — é só conversar naturalmente. Importante: a
memória serve para ela **entender** a pergunta; a resposta jurídica continua saindo
**sempre da lei com citação** (se não houver base, ela recusa, como sempre).

### 3. Organizar o escritório (processos e compromissos)
**O que faz:** você fala em linguagem natural e ela cadastra/consulta seus processos
e compromissos — **sempre pedindo confirmação antes de gravar**.

**Exemplos:**
- Você: *"Registra a audiência do processo 12345 do cliente Gabriel Machado para 15/07 às 14h."*
  Ela: monta o compromisso e **pergunta**: *"Confirmo: audiência do processo 12345, cliente Gabriel Machado, 15/07 às 14:00?"* — só grava quando você responde **"sim"**.
- Você: *"Cadastra o processo 0001234-55.2024.8.26.0100 do cliente Maria Silva."* → confirma e grava.
- Você: *"Quais são meus processos?"* / *"Quais meus compromissos da semana?"* → ela lista **somente os seus** (os dados de cada advogado são isolados; ninguém vê os do outro).

**Editar e cancelar (novo):** você também corrige e remove pela conversa, sempre com confirmação:
- Você: *"Remarca a audiência do processo 12345 para sexta às 16h."* → ela mostra *"Vou alterar a audiência de 15/07 14:00 → 18/07 16:00. Responda SIM"* e, ao confirmar, **reprograma os lembretes** para a nova data automaticamente.
- Você: *"Cancela a reunião de amanhã."* → ela mostra **exatamente** o que vai apagar (*"⚠️ Vou REMOVER a reunião de … — definitivo"*) e só remove após o **"sim"**. Se houver **mais de uma** reunião amanhã, ela **pergunta qual** (lista numerada) — nunca apaga "no chute".
- Você: *"Muda o status do processo 12345 para suspenso."* / *"Arquiva o processo do cliente João."* → confirma e aplica. Processos são **arquivados** (somem da rotina, mas o histórico fica), nunca apagados de vez.

### 4. Lembretes automáticos
**O que faz:** ao registrar um compromisso, ela **já programa lembretes** — **24 horas
antes** e **1 hora antes** — que serão enviados sozinhos no seu WhatsApp, no horário de
Brasília. Ex.: *"🔔 Lembrete: audiência do processo 12345 (cliente Gabriel Machado)
amanhã às 14:00 — aviso automático da sua estagiárIA."* Você não precisa pedir; é
automático ao agendar.

### 5. Receber e organizar documentos
**O que faz:** você manda um arquivo (PDF, Word, texto) e ela **resume, guarda, ou os
dois** — e, ao guardar, sempre anota as **informações-chave** (tipo, partes, números,
datas, assunto) para você **encontrar o documento depois**.

**Exemplos:**
- Você manda um PDF com a legenda *"resume isso"* → ela responde com o resumo.
- Você manda um arquivo **sem dizer nada** → ela pergunta: *"O que você quer fazer? 1 - Resumir / 2 - Salvar / 3 - Resumir e salvar"* e age conforme a sua resposta.
- Você manda um contrato com *"guarda no processo 0001234-…"* → ela guarda vinculado ao processo.
- Se for **foto ou PDF escaneado**, ela agora **lê o texto por reconhecimento de imagem (OCR)** — tudo **dentro do nosso ambiente** (o documento não é enviado a terceiros). Assim ela consegue resumir e indexar até um documento escaneado. Como OCR pode errar (sobretudo números), ela **avisa** que aquele conteúdo veio de OCR e pede conferência. Se a imagem estiver ruim demais para ler com segurança, ela é honesta: guarda o arquivo, avisa que só leu parcialmente e **não registra dados incertos** (melhor vazio que errado).

**Bom saber:**
- **Tipos que ela lê:** PDF com texto, Word (.docx) e texto (.txt); e também **fotos e
  PDFs escaneados** (por OCR). Formatos fora disso ela guarda, mas avisa que não
  conseguiu ler o conteúdo.
- **Tamanho:** há um limite por arquivo (ajustável). Acima dele, ela avisa com
  clareza e pede uma versão menor — em vez de falhar sem explicar.

### 6. Encontrar um documento guardado (busca)
**O que faz:** você pede um documento **sem lembrar o nome do arquivo** — por um detalhe
**exato** (um número de protocolo/processo, o nome de uma pessoa, um trecho) **ou** por
algo **vago** (o assunto, *"aquele contrato de aluguel"*). Ela procura no **seu** acervo
de duas formas ao mesmo tempo — pelo **texto/número** e pelo **significado** — e devolve
os documentos mais prováveis com um **link para abrir**.

**Exemplos:**
- *"acha o contrato de aluguel do João"* → ela lista o(s) contrato(s) que batem, com link.
- *"me manda o documento do protocolo 5551"* → acha pelo pedaço do número.
- *"aquela procuração que guardei mês passado"* → acha pelo assunto, mesmo sem o nome.

**Importante:**
- A busca é **só sua**: ela nunca mostra documento de outra pessoa — cada conta enxerga
  apenas os próprios arquivos.
- Fotos e PDFs escaneados **também entram na busca** — ela lê o texto por OCR ao guardar.
  Fica de fora só o que o OCR **não conseguiu ler** (imagem ruim); nesse caso ela avisa
  quantos você tem assim e se oferece para procurar por nome ou data.
- Ela **acha e entrega** o documento; para o **resumo** de um deles, é só pedir (abaixo).

### 7. Resumir um documento guardado
**O que faz:** você pede o **resumo de um documento que já está no seu acervo**, sem
reenviar o arquivo. Pode se referir a ele logo depois de uma busca (*"resume o segundo"*),
pelo nome/número (*"resume o do João"*, *"resume o do protocolo 5551"*) ou pedir um resumo
com um foco específico.

**Exemplos:**
- *"me resume o contrato do João"* → devolve o resumo (na hora, se já existir).
- Depois de uma busca que listou vários: *"resume o segundo"* → resume o certo da lista.
- *"resume focando nos prazos"* ou *"faz um resumo mais detalhado"* → ela **relê** o
  documento e monta um resumo novo com esse foco.

**Importante:**
- Por padrão ela entrega o **resumo que já tem guardado** — rápido e sem custo. Se o
  documento foi só salvo (sem resumo ainda), ela lê e monta o resumo na hora — e guarda
  para as próximas vezes.
- Documento **escaneado/foto** lido por OCR pode ser resumido normalmente (com o aviso de
  que a base veio de OCR). Só quando o OCR **não conseguiu ler** (imagem ruim) é que ela
  avisa que não dá para resumir o conteúdo.
- Se a referência combinar com **vários**, ela pergunta qual; se não achar nenhum, ela diz
  com clareza. Todo resumo vem com o aviso de que é **apoio** — confira no documento.
- É **só seu**: ela nunca resume (nem lê) documento de outra pessoa.

### 8. Cadastro e acesso
**O que faz:** quem é novo simplesmente **manda a primeira mensagem** no WhatsApp. A
estagiárIA dá boas-vindas e faz um **cadastro rápido** (nome e e-mail). A pessoa ganha
**3 dias de teste grátis**. Depois do teste, para continuar usando é preciso
**assinar** — enquanto não assina, ela avisa e direciona para o pagamento.

### 9. A ficha do processo (tudo num só lugar)
**O que faz:** você pede a **ficha** de um processo e ela junta, numa resposta só, tudo
o que existe sobre ele: os dados (número, cliente, parte contrária, vara/comarca, área,
valor da causa, status, fase, instância), a **agenda** vinculada, os **documentos**
guardados nele e o **financeiro** (que será preenchido quando os honorários chegarem).
Você pode se referir ao processo do jeito que fala no dia a dia: pelo número completo,
por um **pedaço do número** ou pelo **nome do cliente**.

**Exemplos:**
- Você: *"mostra a ficha do processo 12345"* ou *"me dá um resumo do processo do Gabriel"*
  Ela responde algo assim:
  > 📁 *Ficha do processo*
  > nº 00012345620248260100
  > 👤 Cliente: Maria Silva · ⚖️ Contra: Empresa X
  > 🏛️ 2ª Vara Cível — São Paulo · área: cível · fase: conhecimento · status: ativo
  > 💵 Valor da causa: R$ 15.000,00
  > 📅 *Agenda* — audiência 15/07 14:00 — Instrução
  > 📎 *Documentos (1)* — contrato-maria.pdf
  > 💰 *Financeiro* — 1 pendente: R$ 1.000,00 · 1 pago: R$ 500,50
  > _Dados de apoio — confira nos autos._
- Se **mais de um** processo combinar com a referência, ela lista numerado e pergunta
  **qual** — nunca escolhe "no chute". Se nenhum combinar, ela diz com clareza.
- Você também pode atualizar a **fase** e a **instância**: *"muda a fase do processo
  12345 para execução"* — com confirmação antes de gravar, como sempre.

**Bom saber:** a ficha é honesta — seção sem conteúdo aparece como *"sem documentos
vinculados ainda"* (nada some em silêncio); documento lido por OCR mantém o aviso de
conferência; e processo em segredo de justiça vem marcado com 🔒. Como todo o resto,
a ficha é **só sua**: ela nunca mistura nem mostra dados de outra conta.

---

## Parte 3 — O que ela ainda NÃO faz (e o que vem por aí)

- **Entender áudios** (mensagem de voz) — *(planejado, deixado para o final)*
- **Jurisprudência** (decisões de tribunais, súmulas) no acervo de consulta — hoje só
  legislação; jurisprudência virá por um provedor especializado. *(em breve)*
- **Andamento processual** (acompanhar movimentações do processo nos tribunais e
  avisar quando algo anda) — *(planejado)*
- **Financeiro/honorários** (registrar custos e cobrar) — *(planejado)*

**Depende da ativação do WhatsApp (o número/chip):** o uso real pelo WhatsApp — tanto
as respostas quanto os lembretes automáticos — só acontece quando o número estiver
ativado. Hoje todas as funções acima já estão **prontas e testadas internamente**; o
que falta para a experiência real é ligar o WhatsApp (e, para os lembretes, aprovar o
modelo de mensagem junto à Meta).

---

## Parte 4 — Visão: o caminho para uma assistente jurídica completa

> Mapa para planejar a expansão. **✓ = já funciona · ▶ = planejado (já no roadmap) ·
> 💡 = ideia nova a avaliar.** Cada item traz, em uma linha, o valor para o advogado.

### Pesquisa jurídica
- ✓ **Consultar leis com citação real** — responde com segurança e fonte, sem risco de inventar.
- ▶ **Jurisprudência (decisões e súmulas)** — embasar peças e teses com precedentes reais.
- ▶ **Consulta combinada (seus dados + a lei)** — ex.: "qual o prazo deste meu processo?" cruzando o caso com a norma.
- 💡 **Modelos/checklists por tema** — ex.: "o que preciso para entrar com uma ação trabalhista".

### Gestão de agenda e prazos
- ✓ **Registrar compromissos por conversa** — agenda sem sair do WhatsApp.
- ✓ **Lembretes automáticos (24h e 1h antes)** — nunca perder uma audiência/prazo.
- ✓ **Editar/cancelar/remarcar compromissos** — manter a agenda viva e correta (remarcar reprograma os lembretes).
- ▶ **Cálculo assistido de prazos processuais** (com aviso de conferência) — reduzir erro de contagem.
- 💡 **Lembretes configuráveis** (escolher quando e quantos) — adaptar ao estilo de cada advogado.
- 💡 **Sincronizar com Google/Apple Calendar** — ver tudo na agenda que já usa.

### Gestão de processos e clientes
- ✓ **Cadastrar e consultar processos por conversa** — organização sem planilha.
- ✓ **Vincular processo ao cliente** — tudo conectado.
- ✓ **Editar/arquivar processos** — manter a base limpa (arquivar é reversível). *(editar/arquivar cliente: a seguir)*
- ✓ **Ficha do processo** — tudo do processo (dados, agenda, documentos, financeiro) numa resposta só, pedindo em linguagem natural.
- ▶ **Andamento processual (monitorar tribunais)** — ser avisado quando o processo anda.
- ▶ **Resumo da última movimentação** — entender o que aconteceu em uma frase.
- 💡 **Ficha do cliente** (histórico, contatos, processos) — visão 360º de cada cliente.

### Produção de documentos
- ✓ **Receber, ler e resumir documentos (PDF/Word/texto)** — extrair o essencial e guardar com informações-chave.
- ✓ **Encontrar documentos por conteúdo** (busca) — achar por número/nome/trecho ou por assunto, sem lembrar o nome do arquivo.
- ✓ **Resumir um documento guardado** — pedir o resumo de um documento do acervo (por "o segundo", nome/número ou com um foco), sem reenviar o arquivo.
- ✓ **OCR (ler imagens / PDF escaneado)** — lê o texto de escaneados/fotos localmente e marca "lido por OCR" (a conferir).
- ▶ **Sugerir prazo a partir de uma intimação** — da leitura à agenda, automático.
- ▶ **Rascunho de peças** (com revisão obrigatória, sem citar o que não foi verificado) — acelerar a redação.
- 💡 **Modelos de petições/contratos** preenchidos com os dados do caso — produtividade.

### Comunicação com clientes
- 💡 **Mensagens/atualizações ao cliente final** (ex.: "sua audiência foi marcada") — o advogado parece mais presente.
- 💡 **Coleta de documentos do cliente** por um link — menos vai-e-volta.
- 💡 **Respostas a dúvidas frequentes** do cliente, sob controle do advogado.

### Financeiro e honorários
- ▶ **Registrar custos e honorários por processo** — saber quanto cada caso rende/custa.
- ▶ **Lembrete de cobrança de honorário** — não esquecer de receber.
- ▶ **Relatório financeiro** — visão do mês/ano.
- 💡 **Gerar cobrança (Pix) para o cliente final** — receber mais rápido.

### Cadastro, acesso e operação
- ✓ **Cadastro simples + 3 dias de teste** — começar em segundos.
- ✓ **Assinatura para continuar após o teste** — modelo do negócio.
- ✓ **Respostas sempre com fonte** — confiança (nunca afirma sem citar a lei). *(entrar por áudio: ver "Entrada por voz")*
- 💡 **Plano para escritório (vários advogados)** — crescer para times.
- 💡 **Painel do dono do produto** (assinantes, uso, churn) — gestão do negócio.

### Entrada por voz (transversal)
- ▶ **Entender áudios (mensagens de voz)** — falar em vez de digitar. *(deixado para o final, por ser técnico-pesado)*

---

## Parte 5 — Resumo do estado

| Funcionalidade | Já funciona? | Precisa do WhatsApp ativo? | Observação |
|---|---|---|---|
| Consultar leis com citação real | ✅ Sim | Para uso real, sim | Validável agora pela ferramenta interna; 6 leis carregadas |
| Recusa quando não há fonte (não inventa) | ✅ Sim | — | É proteção, não limitação |
| Conversa com memória | ✅ Sim | Para uso real, sim | Validável internamente |
| Cadastrar/consultar processos e compromissos | ✅ Sim | Sim | Pede confirmação antes de gravar; dados isolados por advogado |
| Lembretes automáticos (24h e 1h) | ✅ Sim (lógica pronta) | **Sim** | Envio real depende do chip + aprovação do modelo na Meta |
| Cadastro + 3 dias de teste + assinatura | ✅ Sim | Sim | Fluxo real acontece pelo WhatsApp |
| Editar/cancelar compromissos; editar/arquivar processos | ✅ Sim | Sim | Confirma mostrando o registro real; remarcar reprograma lembretes; processo é arquivado, não apagado |
| Ficha do processo (dados + agenda + documentos + financeiro) | ✅ Sim | Para uso real, sim | Por número (ou trecho) ou cliente; seções vazias aparecem com clareza; validável internamente |
| Receber/ler/resumir/guardar documentos (PDF/Word/texto) | ✅ Sim | Recebimento pelo Zap depende do chip | Guarda com informações-chave; escaneado/foto é lido por OCR (linha abaixo) |
| Encontrar documentos por conteúdo (busca) | ✅ Sim | Para uso real, sim | Por número/nome/trecho ou por assunto; só os seus; validável internamente |
| Resumir um documento guardado | ✅ Sim | Para uso real, sim | Resumo salvo (na hora) ou novo com foco; só os seus; validável internamente |
| Ler escaneados/fotos por OCR (local) | ✅ Sim | Para uso real, sim | Documento não sai do ambiente; marca "lido por OCR"; baixa qualidade não é indexada |
| Entender áudios | ❌ Ainda não | — | Planejado (por último) |
| Jurisprudência (decisões/súmulas) | ❌ Ainda não | — | Em breve (provedor especializado) |
| Andamento processual (tribunais) | ❌ Ainda não | — | Planejado |
| Financeiro/honorários | ❌ Ainda não | — | Planejado |

> **Sobre o "precisa do WhatsApp ativo":** quase tudo já está construído e testado por
> dentro; o que falta para virar experiência real é ligar o número do WhatsApp (e, para
> os lembretes, aprovar o modelo de mensagem na Meta).

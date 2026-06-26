/**
 * Intenções da porta de entrada (ver skill whatsapp-orquestracao).
 * O orquestrador classifica a mensagem em UMA intenção e roteia para UM handler.
 */

export const INTENTS = [
  'onboarding', // número novo ou cadastro incompleto
  'consulta_dados', // dados do próprio advogado (Cérebro 1)
  'duvida_juridica', // pergunta sobre lei/jurisprudência (Cérebro 2)
  'consulta_andamento', // andamento processual (Cérebro 3)
  'agendar', // audiência/compromisso/prazo
  'financeiro', // custos, honorários, cobranças
  'documento', // enviar/buscar arquivo
  'assinatura', // pagamento, plano, situação da conta
  'ajuda', // pedido explícito de ajuda
  'outro', // fallback: não classificado
] as const;

export type Intent = (typeof INTENTS)[number];

/** Cérebro que a intenção acionaria (§4). NÃO é acionado neste passo. */
export type Cerebro = 'dados' | 'juridico_rag' | 'tribunais';

/**
 * Mapa intenção → cérebro, só para auditoria/futuro. Intenções de módulo
 * (onboarding, assinatura, ajuda, outro) não têm cérebro.
 */
export const INTENT_CEREBRO: Record<Intent, Cerebro | null> = {
  onboarding: null,
  consulta_dados: 'dados',
  duvida_juridica: 'juridico_rag',
  consulta_andamento: 'tribunais',
  agendar: 'dados',
  financeiro: 'dados',
  documento: 'dados',
  assinatura: null,
  ajuda: null,
  outro: null,
};

/**
 * Rótulo amigável em linguagem natural (R-A). Usado na desambiguação — NUNCA
 * exibir os nomes internos das intenções ao usuário. Lê bem em "Você quer X?".
 */
export const INTENT_LABEL: Record<Intent, string> = {
  onboarding: 'fazer seu cadastro',
  consulta_dados: 'consultar seus processos e dados',
  duvida_juridica: 'tirar uma dúvida jurídica',
  consulta_andamento: 'ver o andamento de um processo',
  agendar: 'agendar um compromisso ou prazo',
  financeiro: 'registrar custos ou honorários',
  documento: 'enviar ou buscar um documento',
  assinatura: 'tratar da sua assinatura ou plano',
  ajuda: 'ver o que eu posso fazer',
  outro: 'outra coisa',
};

/**
 * Porta da FICHA DO PROCESSO (Passo 15). A ficha é uma CONSULTA AGREGADA — não
 * uma tabela nova: junta processo + agenda + documentos + financeiro do MESMO
 * assinante, numa transação escopada por tenant.
 *
 * DESENHO PARA DOIS CONSUMIDORES: esta porta devolve DADOS ESTRUTURADOS (objeto
 * puro, sem string de apresentação). A formatação texto-WhatsApp mora em
 * `core/domain/cerebro1/ficha-format`; o dashboard (Fase C) consumirá o MESMO
 * objeto via API e formatará em tela.
 *
 * NENHUM tipo aqui carrega `assinante_id` vindo do modelo — o tenant é sempre
 * injetado pelo código na execução (identidade), nunca pelo texto/LLM.
 */

export interface FichaProcessoDados {
  id: string;
  numeroCnj: string | null;
  clienteNome: string | null;
  parteContraria: string | null;
  vara: string | null;
  comarca: string | null;
  area: string | null;
  /** numeric(15,2) vem como string do Postgres — dinheiro nunca vira float aqui. */
  valorCausa: string | null;
  status: string | null;
  fase: string | null;
  instancia: string | null;
  segredoJustica: boolean;
}

export interface FichaCompromisso {
  id: string;
  tipo: string;
  dataHora: string; // ISO
  descricao: string | null;
}

export interface FichaDocumento {
  id: string;
  nome: string;
  /** 'ok' | 'ok_ocr' | 'ok_ocr_parcial' | 'sem_texto' | 'falha' (Passos 12A/13). */
  extracaoStatus: string;
  enviadoEm: string; // ISO
}

export interface FichaLancamento {
  id: string;
  tipo: string; // 'custo' | 'honorario'
  valor: string; // numeric como string
  vencimento: string | null; // ISO date (YYYY-MM-DD)
  status: string; // 'pendente' | 'pago' | 'cancelado'
}

/** Dados BRUTOS da agregação (uma transação, 4 consultas escopadas por tenant). */
export interface FichaBruta {
  processo: FichaProcessoDados;
  /** Todos os compromissos do processo, em ordem cronológica. */
  compromissos: FichaCompromisso[];
  /** Documentos guardados vinculados, mais recentes primeiro. */
  documentos: FichaDocumento[];
  /** Slot financeiro — REAL desde o Passo 15; o Passo 16 passa a preenchê-lo. */
  lancamentos: FichaLancamento[];
}

/** Ficha estruturada final (o que os DOIS canais consomem). */
export interface FichaProcesso {
  processo: FichaProcessoDados;
  agenda: { futuros: FichaCompromisso[]; recentes: FichaCompromisso[] };
  documentos: FichaDocumento[];
  financeiro: {
    lancamentos: FichaLancamento[];
    /** Somas por status, em string decimal ("1234.56") — sem float em dinheiro. */
    totalPendente: string;
    totalPago: string;
  };
}

export interface FichaStore {
  /**
   * Agrega os dados de UM processo DO TENANT. Devolve null se o processo não
   * existe ou não pertence ao assinante (posse re-verificada na própria query).
   */
  getFichaBruta(assinanteId: string, processoId: string): Promise<FichaBruta | null>;
}

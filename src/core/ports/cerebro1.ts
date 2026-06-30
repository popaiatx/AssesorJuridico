/**
 * Portas do Cérebro 1 (dados do escritório). O domínio/aplicação dependem só
 * destas assinaturas; a infra implementa com queries parametrizadas e escopadas
 * por tenant (withTenant/RLS). NENHUM tipo aqui carrega `assinante_id` vindo do
 * modelo — o tenant é sempre injetado pelo código na execução.
 */

export interface PendingAction {
  acao: string;
  params: Record<string, unknown>;
  fase: 'coletando' | 'confirmando' | 'desambiguando';
  faltando: string[];
}

export interface NovoCompromisso {
  tipo: 'audiencia' | 'reuniao' | 'prazo';
  dataHora: string; // ISO
  descricao: string | null;
  processoId: string | null;
  lembreteEm: string[]; // ISO[]
}

export interface CompromissoRow {
  id: string;
  tipo: string;
  dataHora: string; // ISO
  descricao: string | null;
  local: string | null;
  processoId: string | null;
}

/** Compromisso com rótulos do processo/cliente — para resolver alvo e confirmar. */
export interface CompromissoAlvo {
  id: string;
  tipo: string;
  dataHora: string; // ISO
  descricao: string | null;
  processoId: string | null;
  processoNumero: string | null;
  clienteNome: string | null;
}

/** Seletor do compromisso alvo (linguagem natural → filtros), escopado por tenant. */
export interface CompromissoSelector {
  numeroCnj?: string | null;
  tipo?: 'audiencia' | 'reuniao' | 'prazo' | null;
  /** Dia referido (ISO date YYYY-MM-DD) — casa compromissos daquele dia (BRT). */
  dia?: string | null;
}

/** Campos alteráveis de um compromisso (date muda → recalcula lembretes). */
export interface CompromissoPatch {
  tipo?: 'audiencia' | 'reuniao' | 'prazo';
  dataHora?: string; // ISO
  descricao?: string | null;
  processoId?: string | null;
  /** Quando presente (data mudou): novos lembretes + limpa lembretes_enviados. */
  lembreteEm?: string[];
}

/** Seletor de processo alvo. */
export interface ProcessoSelector {
  numeroCnj?: string | null;
  clienteNome?: string | null;
  parte?: string | null;
}

/** Campos alteráveis de um processo. `clienteId` já resolvido pelo handler. */
export interface ProcessoPatch {
  status?: string | null;
  clienteId?: string | null;
  parteContraria?: string | null;
  area?: string | null;
}

export interface NovoProcesso {
  numeroCnj: string | null;
  clienteId: string | null;
  parteContraria: string | null;
  area: string | null;
  status: string | null;
}

export interface ProcessoRow {
  id: string;
  numeroCnj: string | null;
  clienteNome: string | null;
  parteContraria: string | null;
  area: string | null;
  status: string | null;
}

export interface Cerebro1Store {
  criarCompromisso(assinanteId: string, c: NovoCompromisso): Promise<CompromissoRow>;
  listarCompromissos(
    assinanteId: string,
    range: { fromISO: string | null; toISO: string | null },
  ): Promise<CompromissoRow[]>;
  resolveProcessoIdByCnj(assinanteId: string, numeroCnj: string): Promise<string | null>;
  upsertClienteByNome(assinanteId: string, nome: string): Promise<string>;
  cadastrarProcesso(assinanteId: string, p: NovoProcesso): Promise<ProcessoRow>;
  listarProcessos(
    assinanteId: string,
    filtro: { clienteNome: string | null; status: string | null },
  ): Promise<ProcessoRow[]>;
  consultarProcesso(
    assinanteId: string,
    filtro: { numeroCnj: string | null; parte: string | null },
  ): Promise<ProcessoRow[]>;

  // --- Passo 11: editar/remover (sempre escopado por tenant) ---
  /** Resolve candidatos do compromisso alvo (com rótulos de processo/cliente). */
  findCompromissos(assinanteId: string, sel: CompromissoSelector): Promise<CompromissoAlvo[]>;
  /** Busca um compromisso por id, RE-VERIFICANDO o tenant. */
  getCompromissoById(assinanteId: string, id: string): Promise<CompromissoAlvo | null>;
  /** Atualiza um compromisso do tenant. Se `lembreteEm` vier, grava e LIMPA
   *  lembretes_enviados do compromisso (atomicamente). Retorna se alterou 1 linha. */
  updateCompromisso(assinanteId: string, id: string, patch: CompromissoPatch): Promise<boolean>;
  /** Remove um compromisso do tenant (cascade limpa lembretes_enviados). */
  deleteCompromisso(assinanteId: string, id: string): Promise<boolean>;
  /** Resolve candidatos do processo alvo. */
  findProcessos(assinanteId: string, sel: ProcessoSelector): Promise<ProcessoRow[]>;
  /** Busca um processo por id, RE-VERIFICANDO o tenant. */
  getProcessoById(assinanteId: string, id: string): Promise<ProcessoRow | null>;
  /** Atualiza campos de um processo do tenant. Retorna se alterou 1 linha. */
  updateProcesso(assinanteId: string, id: string, patch: ProcessoPatch): Promise<boolean>;
  /** Arquiva (status='arquivado') um processo do tenant. Retorna se alterou. */
  arquivarProcesso(assinanteId: string, id: string): Promise<boolean>;
}

export interface PendingActionStore {
  get(assinanteId: string): Promise<PendingAction | null>;
  save(assinanteId: string, pending: PendingAction): Promise<void>;
  clear(assinanteId: string): Promise<void>;
}

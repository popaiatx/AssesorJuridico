/**
 * Portas do Cérebro 1 (dados do escritório). O domínio/aplicação dependem só
 * destas assinaturas; a infra implementa com queries parametrizadas e escopadas
 * por tenant (withTenant/RLS). NENHUM tipo aqui carrega `assinante_id` vindo do
 * modelo — o tenant é sempre injetado pelo código na execução.
 */

export interface PendingAction {
  acao: string;
  params: Record<string, unknown>;
  fase: 'coletando' | 'confirmando';
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
}

export interface PendingActionStore {
  get(assinanteId: string): Promise<PendingAction | null>;
  save(assinanteId: string, pending: PendingAction): Promise<void>;
  clear(assinanteId: string): Promise<void>;
}

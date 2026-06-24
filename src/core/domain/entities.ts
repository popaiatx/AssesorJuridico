/**
 * Tipos das entidades do domínio (§5 do PLANEJAMENTO.md).
 *
 * São os contratos de negócio, sem I/O e sem dependência de infraestrutura.
 * Espelham o schema das migrações (supabase/migrations). Datas como ISO string.
 *
 * NOTA: `assinante_id` está presente em toda entidade de tenant — o isolamento
 * é garantido pelo RLS (ver migrações), e o filtro na aplicação é a 1ª linha.
 */

export type UUID = string;
/** Timestamp em ISO-8601 (UTC). */
export type ISODateTime = string;

// --- Enums (espelham os tipos do Postgres) ---
export type AssinanteStatus = 'trial' | 'ativo' | 'inadimplente' | 'cancelado';
export type Plano = 'solo' | 'escritorio';
export type CompromissoTipo = 'audiencia' | 'reuniao' | 'prazo';
export type CompromissoOrigem = 'manual' | 'extraido';
export type LancamentoTipo = 'custo' | 'honorario';
export type LancamentoStatus = 'pendente' | 'pago' | 'cancelado';
export type PagamentoMetodo = 'pix_automatico' | 'cartao';
export type AssinaturaStatus =
  | 'trial'
  | 'ativa'
  | 'inadimplente'
  | 'suspensa'
  | 'cancelada';
export type ClassificacaoSigilo = 'normal' | 'sigiloso' | 'segredo_justica';
/** Cérebro que tratou a interação (§4). Nunca misturar num único prompt. */
export type CerebroUsado = 'dados' | 'juridico_rag' | 'tribunais';

export interface Assinante {
  id: UUID;
  nome: string;
  oabNumero: string;
  oabSeccional: string; // UF
  documento: string; // CPF/CNPJ
  telefone: string; // chave WhatsApp (identidade)
  email: string | null;
  status: AssinanteStatus;
  plano: Plano;
  criadoEm: ISODateTime;
  atualizadoEm: ISODateTime;
}

export interface Cliente {
  id: UUID;
  assinanteId: UUID;
  nome: string;
  documento: string | null;
  contato: string | null;
  criadoEm: ISODateTime;
  atualizadoEm: ISODateTime;
}

export interface Processo {
  id: UUID;
  assinanteId: UUID;
  clienteId: UUID | null;
  numeroCnj: string | null;
  comarca: string | null;
  vara: string | null;
  area: string | null;
  parteContraria: string | null;
  status: string | null;
  valorCausa: string | null; // numeric → string para não perder precisão
  segredoJustica: boolean;
  criadoEm: ISODateTime;
  atualizadoEm: ISODateTime;
}

export interface Movimentacao {
  id: UUID;
  assinanteId: UUID; // denormalizado (coincide com o do processo — R3)
  processoId: UUID;
  data: ISODateTime;
  descricao: string;
  fonte: string | null; // agregador
  hash: string | null; // dedupe de movimentação
  criadoEm: ISODateTime;
}

export interface Compromisso {
  id: UUID;
  assinanteId: UUID;
  processoId: UUID | null;
  tipo: CompromissoTipo;
  dataHora: ISODateTime;
  local: string | null;
  lembreteEm: ISODateTime[];
  origem: CompromissoOrigem;
  criadoEm: ISODateTime;
  atualizadoEm: ISODateTime;
}

export interface Documento {
  id: UUID;
  assinanteId: UUID; // denormalizado (R3)
  processoId: UUID;
  nome: string;
  tipo: string | null;
  storageRef: string; // referência no bucket privado
  classificacaoSigilo: ClassificacaoSigilo;
  enviadoEm: ISODateTime;
}

export interface LancamentoFinanceiro {
  id: UUID;
  assinanteId: UUID; // denormalizado (R3)
  processoId: UUID;
  tipo: LancamentoTipo;
  valor: string; // numeric → string
  vencimento: string | null; // date
  status: LancamentoStatus;
  lembreteCobrancaEm: ISODateTime | null;
  criadoEm: ISODateTime;
  atualizadoEm: ISODateTime;
}

export interface Assinatura {
  id: UUID;
  assinanteId: UUID;
  gatewayRef: string | null;
  metodo: PagamentoMetodo;
  status: AssinaturaStatus;
  proximoVencimento: string | null; // date
  criadoEm: ISODateTime;
  atualizadoEm: ISODateTime;
}

/** Evento de pagamento — processado uma única vez (idempotência via gatewayEventId). */
export interface PagamentoEvento {
  id: UUID;
  assinanteId: UUID;
  assinaturaId: UUID | null;
  gatewayEventId: string; // UNIQUE — chave de idempotência
  tipo: string;
  payload: unknown;
  recebidoEm: ISODateTime;
}

/** Log imutável de interação (§5). Nunca dado sensível em claro. */
export interface InteracaoLog {
  id: UUID;
  assinanteId: UUID;
  timestamp: ISODateTime;
  intencao: string | null;
  entrada: string | null;
  cerebroUsado: CerebroUsado | null;
  fontesCitadas: string[];
  saida: string | null;
  anonimizado: boolean;
}

export interface ConsentimentoIa {
  id: UUID;
  assinanteId: UUID;
  versaoTermo: string;
  aceitoEm: ISODateTime;
  canal: string | null;
}

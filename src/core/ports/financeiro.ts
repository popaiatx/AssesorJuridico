/**
 * Porta do FINANCEIRO (Passo 16) — honorários/custos por processo, cada parcela
 * uma linha em `lancamentos_financeiros`, agrupadas por `acordo_id`.
 *
 * NENHUM tipo carrega `assinante_id` vindo do modelo — o tenant é injetado pelo
 * código na execução. Valores trafegam como DECIMAL string do Postgres; a
 * aritmética é feita em centavos inteiros no domínio (nunca float).
 *
 * "Atrasada" é DERIVADA (pendente + vencimento < hoje BRT) — nunca gravada.
 */
import type { ProcessoSelector } from './cerebro1.js';

export interface NovaParcela {
  valorDecimal: string; // "1000.00"
  vencimento: string; // YYYY-MM-DD
  parcela: number;
  totalParcelas: number;
}

export interface NovoAcordoHonorario {
  processoId: string;
  acordoId: string;
  descricao: string | null;
  parcelas: NovaParcela[];
}

export interface ParcelaAlvo {
  id: string;
  acordoId: string | null;
  parcela: number | null;
  totalParcelas: number | null;
  valorDecimal: string;
  vencimento: string | null; // YYYY-MM-DD
  status: string; // pendente | pago | cancelado
  descricao: string | null;
  pagoEm: string | null; // ISO
  processoId: string;
  processoNumero: string | null;
  clienteNome: string | null;
}

/** Seletor de parcela: processo (como no Passo 15) + mês do vencimento / nº. */
export interface ParcelaSelector extends ProcessoSelector {
  /** Mês do vencimento (YYYY-MM). */
  mesAno?: string | null;
  /** Número da parcela ("a terceira"). */
  parcelaNum?: number | null;
  /** true (default) = só pendentes (pagar/editar/cancelar operam nelas). */
  apenasPendentes?: boolean;
}

export interface AcordoResumo {
  acordoId: string;
  processoId: string;
  processoNumero: string | null;
  clienteNome: string | null;
  descricao: string | null;
  totalParcelas: number;
  pendentes: number;
  pagas: number;
  somaPendenteDecimal: string;
}

export interface ParcelaPatch {
  valorDecimal?: string;
  vencimento?: string; // YYYY-MM-DD
}

export interface FinanceiroFiltro {
  processo?: ProcessoSelector | null;
  /** Janela do vencimento (YYYY-MM-DD, inclusivas). */
  de?: string | null;
  ate?: string | null;
}

export interface FinanceiroStore {
  /** Grava TODAS as parcelas do acordo atomicamente. Devolve quantas gravou. */
  criarHonorario(assinanteId: string, acordo: NovoAcordoHonorario): Promise<number>;
  /** Candidatas escopadas por tenant (join com processos/clientes p/ rótulo). */
  findParcelas(assinanteId: string, sel: ParcelaSelector): Promise<ParcelaAlvo[]>;
  /** Re-verifica a posse por tenant. */
  getParcelaById(assinanteId: string, id: string): Promise<ParcelaAlvo | null>;
  /** pendente → pago (+pago_em). false se não existe/não é do tenant/não pendente. */
  marcarParcelaPaga(assinanteId: string, id: string, pagoEmISO: string): Promise<boolean>;
  /** Edita valor/vencimento de parcela PENDENTE do tenant. */
  updateParcela(assinanteId: string, id: string, patch: ParcelaPatch): Promise<boolean>;
  /** pendente → cancelado (nunca delete). */
  cancelarParcela(assinanteId: string, id: string): Promise<boolean>;
  /** Acordos DO TENANT com parcelas pendentes, para o alvo de cancelar_acordo. */
  findAcordos(assinanteId: string, sel: ProcessoSelector): Promise<AcordoResumo[]>;
  getAcordoById(assinanteId: string, acordoId: string): Promise<AcordoResumo | null>;
  /** Cancela SÓ as pendentes do acordo; pagas ficam no histórico. */
  cancelarAcordoPendentes(
    assinanteId: string,
    acordoId: string,
  ): Promise<{ canceladas: number; somaDecimal: string }>;
  /** Pendentes do tenant no filtro (consulta "a receber"), por vencimento. */
  listarPendentes(assinanteId: string, filtro: FinanceiroFiltro): Promise<ParcelaAlvo[]>;
}

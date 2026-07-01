/**
 * Geração do PLANO DE PARCELAS (Passo 16) — puro, sem I/O.
 *
 * Regras EXPLÍCITAS (testadas nos casos de borda):
 *  - Arredondamento com SOMA EXATA: base = floor(total/N); a diferença vai na
 *    PRIMEIRA parcela (soma das parcelas === total, sempre).
 *  - Dia do mês inexistente: cai no ÚLTIMO dia do mês (31 → 28/29 fev), SEM ser
 *    sticky (no mês seguinte volta ao dia preferido).
 *  - Modo "10x de R$ 1.000" (valor DA parcela informado): sem arredondamento;
 *    total derivado.
 */
import { centavosParaDecimal } from './dinheiro.js';

export interface ParcelaPlano {
  parcela: number;
  totalParcelas: number;
  valorCentavos: number;
  valorDecimal: string;
  vencimento: string; // YYYY-MM-DD
}

export interface PlanoParcelas {
  parcelas: ParcelaPlano[];
  totalCentavos: number;
}

/** Divide centavos em N com soma EXATA; a diferença fica na PRIMEIRA parcela. */
export function dividirComSomaExata(totalCentavos: number, n: number): number[] {
  const base = Math.floor(totalCentavos / n);
  const primeira = totalCentavos - base * (n - 1);
  return [primeira, ...Array.from({ length: n - 1 }, () => base)];
}

function ultimoDiaDoMes(ano: number, mes1a12: number): number {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

/** N vencimentos mensais a partir de (ano, mês), no dia preferido com CLAMP não-sticky. */
export function vencimentosMensais(
  anoInicial: number,
  mesInicial1a12: number,
  diaPreferido: number,
  n: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const total = mesInicial1a12 - 1 + i;
    const ano = anoInicial + Math.floor(total / 12);
    const mes = (total % 12) + 1;
    const dia = Math.min(diaPreferido, ultimoDiaDoMes(ano, mes));
    out.push(`${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
  }
  return out;
}

export interface GerarPlanoInput {
  /** Total em centavos (modo total) — OU informe valorParcelaCentavos. */
  totalCentavos?: number;
  /** Valor de CADA parcela em centavos (modo "10x de R$ 1.000") — sem arredondamento. */
  valorParcelaCentavos?: number;
  numParcelas: number;
  /** Data do 1º vencimento (YYYY-MM-DD). Âncora do mês inicial. */
  primeiroVencimento: string;
  /** Dia preferido do mês (1–31). Default: o dia do 1º vencimento. */
  diaVencimento?: number;
}

export type GerarPlanoResult = { ok: true; plano: PlanoParcelas } | { ok: false; erro: string };

export function gerarPlano(input: GerarPlanoInput): GerarPlanoResult {
  const n = input.numParcelas;
  if (!Number.isInteger(n) || n < 1 || n > 120) {
    return { ok: false, erro: 'Número de parcelas inválido (1 a 120).' };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.primeiroVencimento);
  if (!m) return { ok: false, erro: 'Não entendi a data do primeiro vencimento.' };
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const diaAncora = Number(m[3]);
  if (mes < 1 || mes > 12 || diaAncora < 1 || diaAncora > 31) {
    return { ok: false, erro: 'Não entendi a data do primeiro vencimento.' };
  }
  const dia = input.diaVencimento ?? diaAncora;
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return { ok: false, erro: 'O dia do vencimento precisa estar entre 1 e 31.' };
  }

  let valores: number[];
  let totalCentavos: number;
  if (typeof input.valorParcelaCentavos === 'number') {
    if (input.valorParcelaCentavos < 1) return { ok: false, erro: 'O valor da parcela precisa ser positivo.' };
    valores = Array.from({ length: n }, () => input.valorParcelaCentavos!);
    totalCentavos = input.valorParcelaCentavos * n;
  } else if (typeof input.totalCentavos === 'number') {
    if (input.totalCentavos < n) {
      return { ok: false, erro: `O valor total não dá nem 1 centavo por parcela (${n} parcelas).` };
    }
    valores = dividirComSomaExata(input.totalCentavos, n);
    totalCentavos = input.totalCentavos;
  } else {
    return { ok: false, erro: 'Informe o valor total ou o valor da parcela.' };
  }

  const vencimentos = vencimentosMensais(ano, mes, dia, n);
  const parcelas: ParcelaPlano[] = valores.map((v, i) => ({
    parcela: i + 1,
    totalParcelas: n,
    valorCentavos: v,
    valorDecimal: centavosParaDecimal(v),
    vencimento: vencimentos[i]!,
  }));
  return { ok: true, plano: { parcelas, totalCentavos } };
}

/** Hoje (YYYY-MM-DD) no fuso de Brasília — para "atrasada" e validação de passado. */
export function hojeBRT(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

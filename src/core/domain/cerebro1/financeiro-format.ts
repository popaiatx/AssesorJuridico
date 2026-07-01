/**
 * Formatação do FINANCEIRO para WhatsApp (Passo 16) — pura. "Atrasada" é
 * DERIVADA aqui (pendente + vencimento < hoje BRT), nunca gravada no banco.
 */
import { decimalParaCentavos, formatarCentavos } from './dinheiro.js';
import type { ParcelaPlano } from './parcelas.js';
import type { ParcelaAlvo } from '../../ports/financeiro.js';

export function formatarDataBR(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}

export function valorParcela(p: ParcelaAlvo): string {
  const cent = decimalParaCentavos(p.valorDecimal);
  return cent === null ? `R$ ${p.valorDecimal}` : formatarCentavos(cent);
}

/** true = pendente com vencimento antes de hoje (BRT). */
export function estaAtrasada(p: ParcelaAlvo, hojeISO: string): boolean {
  return p.status === 'pendente' && p.vencimento !== null && p.vencimento < hojeISO;
}

function rotuloProc(p: ParcelaAlvo): string {
  const proc = p.processoNumero ? `proc ${p.processoNumero}` : 'processo';
  const cli = p.clienteNome ? `, ${p.clienteNome}` : '';
  return `${proc}${cli}`;
}

/** Rótulo curto para listas/desambiguação. */
export function labelParcela(p: ParcelaAlvo, hojeISO: string): string {
  const num = p.parcela && p.totalParcelas ? `${p.parcela}/${p.totalParcelas}` : 'única';
  const venc = p.vencimento ? ` · venc. ${formatarDataBR(p.vencimento)}` : '';
  const atras = estaAtrasada(p, hojeISO) ? ' ⚠️ atrasada' : '';
  return `${num}${venc} · ${valorParcela(p)} — ${rotuloProc(p)}${atras}`;
}

function somaCentavos(rows: ParcelaAlvo[]): number {
  return rows.reduce((acc, r) => acc + (decimalParaCentavos(r.valorDecimal) ?? 0), 0);
}

/** Descreve o plano de parcelas na CONFIRMAÇÃO (plano completo, sem paredão). */
export function descreverPlano(parcelas: ParcelaPlano[], totalCentavos: number): string {
  if (parcelas.length === 1) {
    const p = parcelas[0]!;
    return `${formatarCentavos(p.valorCentavos)} à vista, vencendo ${formatarDataBR(p.vencimento)}`;
  }
  const primeiro = parcelas[0]!;
  const ultimo = parcelas[parcelas.length - 1]!;
  const valoresIguais = parcelas.every((p) => p.valorCentavos === primeiro.valorCentavos);
  const valores = valoresIguais
    ? `${parcelas.length} parcelas de ${formatarCentavos(primeiro.valorCentavos)}`
    : `${parcelas.length} parcelas (1ª de ${formatarCentavos(primeiro.valorCentavos)}, demais de ${formatarCentavos(parcelas[1]!.valorCentavos)})`;
  const dia = Number(primeiro.vencimento.slice(8, 10));
  return (
    `${valores}, todo dia ${dia}, de ${formatarDataBR(primeiro.vencimento)} a ` +
    `${formatarDataBR(ultimo.vencimento)} (total ${formatarCentavos(totalCentavos)})`
  );
}

const MAX_LISTA = 5;

/** Resposta da consulta "o que tenho a receber" (leitura determinística). */
export function formatarConsultaFinanceiro(
  pendentes: ParcelaAlvo[],
  hojeISO: string,
  escopo: string | null,
): string {
  const onde = escopo ? ` ${escopo}` : '';
  if (pendentes.length === 0) {
    return `💰 Nada a receber${onde} por enquanto.`;
  }
  const atrasadas = pendentes.filter((p) => estaAtrasada(p, hojeISO));
  const linhas: string[] = [];
  linhas.push(
    `💰 A receber${onde}: ${formatarCentavos(somaCentavos(pendentes))} em ${pendentes.length} parcela(s)` +
      (atrasadas.length > 0
        ? ` — ${atrasadas.length} atrasada(s) ⚠️ (${formatarCentavos(somaCentavos(atrasadas))})`
        : ''),
  );
  for (const p of pendentes.slice(0, MAX_LISTA)) {
    linhas.push(`• ${labelParcela(p, hojeISO)}`);
  }
  if (pendentes.length > MAX_LISTA) {
    linhas.push(`… e mais ${pendentes.length - MAX_LISTA} — quer a lista completa?`);
  }
  linhas.push('_Valores registrados por você — confira antes de cobrar._');
  return linhas.join('\n');
}

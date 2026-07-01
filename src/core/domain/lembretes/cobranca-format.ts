/**
 * Texto do LEMBRETE DE COBRANÇA (Passo 16) — puro. O aviso é para o PRÓPRIO
 * advogado (o sistema NUNCA cobra o cliente final). Exibição em BRT.
 */
import { decimalParaCentavos, formatarCentavos } from '../cerebro1/dinheiro.js';
import { hojeBRT } from '../cerebro1/parcelas.js';
import type { DueCobranca } from '../../ports/reminders.js';

function diasEntre(deISO: string, ateISO: string): number {
  // Datas YYYY-MM-DD → diferença em dias inteiros (sem fuso: ambas são datas locais).
  const de = Date.UTC(Number(deISO.slice(0, 4)), Number(deISO.slice(5, 7)) - 1, Number(deISO.slice(8, 10)));
  const ate = Date.UTC(Number(ateISO.slice(0, 4)), Number(ateISO.slice(5, 7)) - 1, Number(ateISO.slice(8, 10)));
  return Math.round((ate - de) / 86400000);
}

function quandoVence(vencimento: string, hoje: string): string {
  const d = diasEntre(hoje, vencimento);
  const data = `${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}`;
  if (d === 0) return 'vence *hoje*';
  if (d === 1) return `vence *amanhã* (${data})`;
  if (d > 1) return `vence em ${d} dias (${data})`;
  if (d === -1) return `venceu *ontem* (${data})`;
  return `venceu há ${-d} dias (${data})`;
}

export function montarMensagemCobranca(r: DueCobranca, now: Date): string {
  const num = r.parcela && r.totalParcelas ? `parcela ${r.parcela}/${r.totalParcelas}` : 'parcela única';
  const proc = r.processoNumero ? ` do processo ${r.processoNumero}` : '';
  const cli = r.clienteNome ? ` (cliente ${r.clienteNome})` : '';
  const cent = decimalParaCentavos(r.valorDecimal);
  const valor = cent === null ? `R$ ${r.valorDecimal}` : formatarCentavos(cent);
  const quando = quandoVence(r.vencimento, hojeBRT(now));
  return `💰 Lembrete: ${num}${proc}${cli} ${quando} — ${valor}. Aviso automático da sua estagiárIA (só para você).`;
}

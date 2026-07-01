/**
 * Montagem PURA da ficha do processo (Passo 15): dados brutos da agregação →
 * objeto estruturado `FichaProcesso` (split futuros/recentes + totais).
 * Sem I/O e sem string de apresentação — formatação fica no ficha-format.
 */
import type { FichaBruta, FichaLancamento, FichaProcesso } from '../../ports/ficha.js';

/** Soma valores decimais ("1234.56") em CENTAVOS inteiros — dinheiro sem float. */
export function somarValores(valores: string[]): string {
  let centavos = 0;
  for (const v of valores) {
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
    if (!m) continue; // valor fora do formato numeric(15,2) não entra na soma
    const sinal = m[1] === '-' ? -1 : 1;
    const inteiro = Number.parseInt(m[2]!, 10);
    const frac = Number.parseInt((m[3] ?? '0').padEnd(2, '0'), 10);
    centavos += sinal * (inteiro * 100 + frac);
  }
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function somaPorStatus(lancamentos: FichaLancamento[], status: string): string {
  return somarValores(lancamentos.filter((l) => l.status === status).map((l) => l.valor));
}

export function montarFicha(bruta: FichaBruta, agora: Date): FichaProcesso {
  const t = agora.getTime();
  const futuros = bruta.compromissos.filter((c) => new Date(c.dataHora).getTime() >= t);
  // Recentes: os já ocorridos, do mais novo para o mais antigo.
  const recentes = bruta.compromissos
    .filter((c) => new Date(c.dataHora).getTime() < t)
    .reverse();
  return {
    processo: bruta.processo,
    agenda: { futuros, recentes },
    documentos: bruta.documentos,
    financeiro: {
      lancamentos: bruta.lancamentos,
      totalPendente: somaPorStatus(bruta.lancamentos, 'pendente'),
      totalPago: somaPorStatus(bruta.lancamentos, 'pago'),
    },
  };
}

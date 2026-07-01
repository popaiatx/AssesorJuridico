/**
 * Composição do texto do lembrete (puro/testável). Sem LLM: determinístico.
 *
 * Fuso: os instantes são UTC (timestamptz); aqui formatamos no fuso do usuário
 * (ex.: America/Sao_Paulo) para a hora exibida bater com a combinada ("14:00").
 * O lembrete vai para o PRÓPRIO dono (o advogado), sobre o cliente dele.
 */
import type { DueReminder } from '../../ports/reminders.js';

const TIPO_LABEL: Record<string, string> = {
  audiencia: 'audiência',
  reuniao: 'reunião',
  prazo: 'prazo',
};

function partsInTz(iso: string, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

/** "YYYY-MM-DD" no fuso dado (para comparar o dia-calendário). */
function diaInTz(iso: string, timeZone: string): string {
  const p = partsInTz(iso, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hora local "HH:MM" no fuso dado. */
function horaInTz(iso: string, timeZone: string): string {
  const p = partsInTz(iso, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** "hoje às 14:00" / "amanhã às 14:00" / "01/07 às 14:00" — relativo ao `now`. */
export function formatarQuando(dataHoraIso: string, timeZone: string, now: Date): string {
  const hora = horaInTz(dataHoraIso, timeZone);
  const alvo = diaInTz(dataHoraIso, timeZone);
  const hoje = diaInTz(now.toISOString(), timeZone);
  const amanha = diaInTz(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), timeZone);
  if (alvo === hoje) return `hoje às ${hora}`;
  if (alvo === amanha) return `amanhã às ${hora}`;
  const p = partsInTz(dataHoraIso, timeZone);
  return `${p.day}/${p.month} às ${hora}`;
}

/** Texto final do lembrete, claro e mínimo, com aviso de automático. */
export function montarMensagemLembrete(r: DueReminder, timeZone: string, now: Date): string {
  const tipo = TIPO_LABEL[r.tipo] ?? r.tipo;
  const quando = formatarQuando(r.dataHora, timeZone, now);
  const proc = r.processoNumero ? ` do processo ${r.processoNumero}` : '';
  const cli = r.clienteNome ? ` (cliente ${r.clienteNome})` : '';
  return `🔔 Lembrete: ${tipo}${proc}${cli} ${quando} — aviso automático da sua estagiárIA.`;
}

/**
 * Motor do LEMBRETE PROATIVO (Passo 10). Back-office, reutilizável e testável.
 *
 * Fluxo: seleciona os lembretes devidos (store, na janela [agora-grace, agora]) →
 * compõe a mensagem (fuso de Brasília) → envia pelo template → MARCA depois do
 * sucesso (idempotente). Resiliência POR LEMBRETE: falha de um não aborta os
 * outros nem marca como enviado (re-tenta na próxima rodada). `dryRun` simula
 * FIELMENTE: mesma seleção e composição, sem enviar e SEM marcar.
 */
import { montarMensagemLembrete } from '../../core/domain/lembretes/format.js';
import type { RemindersStore } from '../../core/ports/reminders.js';

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}
const noopLogger: Logger = { info: () => {}, error: () => {} };

/** Envio do lembrete (proativo → template). Abstrai o WhatsApp para testar. */
export interface LembreteSender {
  enviar(telefone: string, mensagem: string): Promise<void>;
}

export interface SendLembretesDeps {
  store: RemindersStore;
  sender: LembreteSender;
  now?: () => Date;
  timeZone?: string;
  graceMin?: number;
  logger?: Logger;
}

export interface SendLembretesOptions {
  dryRun?: boolean;
}

export interface LembretePreview {
  telefone: string;
  compromissoId: string;
  lembreteEm: string;
  mensagem: string;
}

export interface SendLembretesResult {
  status: 'sucesso' | 'parcial';
  dryRun: boolean;
  verificados: number;
  enviados: number;
  falhas: number;
  erros: Array<{ compromissoId: string; erro: string }>;
  /** No dry-run: o que SERIA enviado (para validar sem chip). */
  preview: LembretePreview[];
}

const DEFAULT_TZ = 'America/Sao_Paulo';
const DEFAULT_GRACE_MIN = 60;

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) return `${err.message} — ${cause.message}`;
    return err.message;
  }
  return String(err);
}

export async function sendLembretes(
  deps: SendLembretesDeps,
  opts: SendLembretesOptions = {},
): Promise<SendLembretesResult> {
  const now = (deps.now ?? (() => new Date()))();
  const timeZone = deps.timeZone ?? DEFAULT_TZ;
  const graceMin = deps.graceMin ?? DEFAULT_GRACE_MIN;
  const logger = deps.logger ?? noopLogger;
  const dryRun = Boolean(opts.dryRun);

  const result: SendLembretesResult = {
    status: 'sucesso',
    dryRun,
    verificados: 0,
    enviados: 0,
    falhas: 0,
    erros: [],
    preview: [],
  };

  const due = await deps.store.due(now.toISOString(), graceMin);
  result.verificados = due.length;

  for (const r of due) {
    const mensagem = montarMensagemLembrete(r, timeZone, now);

    if (dryRun) {
      // Simulação fiel: mesma seleção e composição, SEM enviar e SEM marcar.
      result.preview.push({
        telefone: r.telefone,
        compromissoId: r.compromissoId,
        lembreteEm: r.lembreteEm,
        mensagem,
      });
      logger.info({ telefone: r.telefone, compromissoId: r.compromissoId }, 'dry-run: enviaria');
      continue;
    }

    try {
      await deps.sender.enviar(r.telefone, mensagem); // proativo → template
      await deps.store.marcarEnviado(r.compromissoId, r.lembreteEm); // marca SÓ após sucesso
      result.enviados += 1;
      logger.info({ compromissoId: r.compromissoId }, 'lembrete enviado');
    } catch (err) {
      // Resiliência: não aborta os demais, não marca → re-tenta na próxima rodada.
      result.status = 'parcial';
      result.falhas += 1;
      result.erros.push({ compromissoId: r.compromissoId, erro: describeError(err) });
      logger.error({ compromissoId: r.compromissoId, err: describeError(err) }, 'falha no lembrete');
    }
  }

  return result;
}

/**
 * Motor do LEMBRETE DE COBRANÇA (Passo 16) — mesmo desenho do Passo 10:
 * seleciona as cobranças devidas → compõe a mensagem → envia pelo template →
 * MARCA após o sucesso (idempotente). Resiliência POR ITEM; `dryRun` fiel
 * (mesma seleção/composição, sem enviar e SEM marcar).
 *
 * O destinatário é SEMPRE o próprio advogado — nunca o cliente final.
 */
import { montarMensagemCobranca } from '../../core/domain/lembretes/cobranca-format.js';
import type { CobrancasStore, LembreteSender } from '../../core/ports/reminders.js';

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}
const noopLogger: Logger = { info: () => {}, error: () => {} };

export interface SendCobrancasDeps {
  store: CobrancasStore;
  sender: LembreteSender;
  now?: () => Date;
  graceMin?: number;
  logger?: Logger;
}

export interface CobrancaPreview {
  telefone: string;
  lancamentoId: string;
  lembreteEm: string;
  mensagem: string;
}

export interface SendCobrancasResult {
  status: 'sucesso' | 'parcial';
  dryRun: boolean;
  verificados: number;
  enviados: number;
  falhas: number;
  erros: Array<{ lancamentoId: string; erro: string }>;
  preview: CobrancaPreview[];
}

const DEFAULT_GRACE_MIN = 60;

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) return `${err.message} — ${cause.message}`;
    return err.message;
  }
  return String(err);
}

export async function sendCobrancas(
  deps: SendCobrancasDeps,
  opts: { dryRun?: boolean } = {},
): Promise<SendCobrancasResult> {
  const now = (deps.now ?? (() => new Date()))();
  const graceMin = deps.graceMin ?? DEFAULT_GRACE_MIN;
  const logger = deps.logger ?? noopLogger;
  const dryRun = Boolean(opts.dryRun);

  const result: SendCobrancasResult = {
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
    const mensagem = montarMensagemCobranca(r, now);

    if (dryRun) {
      result.preview.push({
        telefone: r.telefone,
        lancamentoId: r.lancamentoId,
        lembreteEm: r.lembreteEm,
        mensagem,
      });
      logger.info({ telefone: r.telefone, lancamentoId: r.lancamentoId }, 'dry-run: enviaria');
      continue;
    }

    try {
      await deps.sender.enviar(r.telefone, mensagem); // proativo → template
      await deps.store.marcarEnviada(r.lancamentoId, r.lembreteEm); // marca SÓ após sucesso
      result.enviados += 1;
      logger.info({ lancamentoId: r.lancamentoId }, 'cobrança avisada');
    } catch (err) {
      result.status = 'parcial';
      result.falhas += 1;
      result.erros.push({ lancamentoId: r.lancamentoId, erro: describeError(err) });
      logger.error({ lancamentoId: r.lancamentoId, err: describeError(err) }, 'falha no aviso de cobrança');
    }
  }

  return result;
}

/**
 * Adapter de TRIBUNAIS — STUB (PENDENTE).
 *
 * Implementa `CourtsPort`, mas NÃO funciona: cada método lança
 * NotImplementedError. O adapter real (agregador pago) será implementado no
 * Cérebro 3 (Fase 2).
 */
import { NotImplementedError } from '../../core/errors.js';
import type {
  CourtsPort,
  CourtsWebhookEvent,
  ProcessoConsulta,
} from '../../core/ports/courts.js';

const PENDENTE = 'Adapter de tribunais ainda não implementado (PENDENTE).';

export class StubCourtsAdapter implements CourtsPort {
  fetchProcesso(_numeroCnj: string): Promise<ProcessoConsulta> {
    throw new NotImplementedError(PENDENTE);
  }
  subscribeMovimentacoes(_numeroCnj: string): Promise<void> {
    throw new NotImplementedError(PENDENTE);
  }
  verifyWebhook(_rawBody: Buffer, _headers: Record<string, string>): Promise<boolean> {
    throw new NotImplementedError(PENDENTE);
  }
  parseWebhookEvent(_rawBody: Buffer): CourtsWebhookEvent {
    throw new NotImplementedError(PENDENTE);
  }
}

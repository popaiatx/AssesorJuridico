/**
 * Store do lembrete proativo (back-office) — chama as funções SECURITY DEFINER
 * via `pool`. Sem service_role: as funções encapsulam a seleção cross-tenant e a
 * marcação atômica (derivando o assinante do próprio compromisso).
 */
import { pool } from './pool.js';
import type { DueReminder, RemindersStore } from '../../core/ports/reminders.js';

interface DueRow {
  assinante_id: string;
  telefone: string;
  compromisso_id: string;
  lembrete_em: Date | string;
  data_hora: Date | string;
  tipo: string;
  descricao: string | null;
  processo_numero: string | null;
  cliente_nome: string | null;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export const remindersStore: RemindersStore = {
  async due(agoraIso: string, graceMin: number): Promise<DueReminder[]> {
    const rows = await pool<DueRow[]>`
      select * from app.lembretes_due(${agoraIso}::timestamptz, ${graceMin})
    `;
    return rows.map((r) => ({
      assinanteId: r.assinante_id,
      telefone: r.telefone,
      compromissoId: r.compromisso_id,
      lembreteEm: iso(r.lembrete_em),
      dataHora: iso(r.data_hora),
      tipo: r.tipo,
      descricao: r.descricao,
      processoNumero: r.processo_numero,
      clienteNome: r.cliente_nome,
    }));
  },

  async marcarEnviado(compromissoId: string, lembreteEmIso: string): Promise<boolean> {
    const rows = await pool<{ marcar_lembrete_enviado: boolean }[]>`
      select app.marcar_lembrete_enviado(${compromissoId}::uuid, ${lembreteEmIso}::timestamptz)
    `;
    return rows[0]?.marcar_lembrete_enviado === true;
  },
};

// Chave do advisory lock que serializa o job de lembretes (evita rodadas concorrentes).
const LEMBRETES_LOCK_KEY = 8202;

/** Roda `fn` segurando um advisory lock dedicado; se outra rodada está em
 *  andamento, NÃO roda e retorna `null` (mesmo padrão do sync do corpus). */
export async function withLembretesLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const reserved = await pool.reserve();
  try {
    const got = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${LEMBRETES_LOCK_KEY}) as locked
    `;
    if (!got[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await reserved`select pg_advisory_unlock(${LEMBRETES_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
}

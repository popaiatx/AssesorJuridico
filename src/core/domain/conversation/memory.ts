/**
 * Política PURA da memória de conversa (Passo 9). Sem I/O — testável isolado.
 *
 * Privacidade por construção: a memória guarda só INTENÇÃO + CITAÇÕES públicas
 * (ex.: "art. 335 do CPC"); nunca texto livre do usuário. Logo, nada de PII a
 * anonimizar e nada de conteúdo jurídico que pudesse virar "fonte" (as citações
 * são só âncoras para interpretar a próxima pergunta; o Cérebro 2 segue validando
 * contra o corpus).
 */
import type { ConversationTurn } from '../../ports/conversation-memory.js';

/** Cauda recente passada aos cérebros para interpretar a nova mensagem. */
export interface RecentContext {
  turnos: ConversationTurn[];
}

/** Memória está "quente"? (dentro do TTL desde a última atualização). */
export function isWarm(atualizadoEm: string | null, now: Date, ttlMin: number): boolean {
  if (!atualizadoEm) return false;
  const last = new Date(atualizadoEm).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last <= ttlMin * 60_000;
}

/** Mantém só os últimos `max` turnos (janela curta). */
export function trimTurnos(turnos: ConversationTurn[], max: number): ConversationTurn[] {
  if (max <= 0) return [];
  return turnos.length <= max ? turnos : turnos.slice(turnos.length - max);
}

/** Citações recentes (do assistente), mais novas primeiro, sem repetição. */
export function fontesRecentes(turnos: ConversationTurn[]): string[] {
  const out: string[] = [];
  for (let i = turnos.length - 1; i >= 0; i--) {
    for (const c of turnos[i]!.fontes ?? []) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Intenção mais recente registrada (para desambiguar follow-up curto). */
export function intentRecente(turnos: ConversationTurn[]): string | null {
  for (let i = turnos.length - 1; i >= 0; i--) {
    const it = turnos[i]!.intent;
    if (it) return it;
  }
  return null;
}

/**
 * Última lista de documentos exibida (Passo 12C), para resolver "resume o segundo".
 * Pega o `docIds` do turno do assistente mais recente que listou documentos. Vazio
 * se não houver lista recente (ex.: memória esfriou) — o handler então não adivinha.
 */
export function ultimaListaDocumentos(turnos: ConversationTurn[]): string[] {
  for (let i = turnos.length - 1; i >= 0; i--) {
    const ids = turnos[i]!.docIds;
    if (ids && ids.length > 0) return ids;
  }
  return [];
}

/** Último processo consultado/exibido (Passo 18: "guarda na pasta DELE"). */
export function ultimoProcessoConsultado(turnos: ConversationTurn[]): string | null {
  for (let i = turnos.length - 1; i >= 0; i--) {
    const ids = turnos[i]!.processoIds;
    if (ids && ids.length > 0) return ids[0]!;
  }
  return null;
}

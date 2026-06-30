/**
 * Memória de conversa (Passo 9) — estado curto por ASSINANTE para interpretar a
 * próxima mensagem (resolver referências). NUNCA é fonte de afirmação jurídica: o
 * Cérebro 2 continua recuperando e validando citação contra o corpus.
 *
 * Por tenant (RLS via withTenant). Conteúdo mínimo e anonimizado antes de ir ao LLM.
 */

export interface ConversationTurn {
  papel: 'user' | 'assistant';
  /** user: a pergunta anonimizada e curta. assistant: opcional. */
  texto?: string;
  /** assistant: intenção atendida (auditoria/contexto). */
  intent?: string;
  /** assistant: citações validadas (referências públicas — ex.: "art. 335 do CPC"). */
  fontes?: string[];
  /** ISO do momento do turno. */
  em: string;
}

/** Estado bruto lido do banco (o TTL/janela é política da aplicação). */
export interface StoredMemory {
  turnos: ConversationTurn[];
  /** ISO da última atualização (base do TTL) ou null se não existir. */
  atualizadoEm: string | null;
}

export interface ConversationMemoryStore {
  /** Lê o estado bruto da memória do assinante (turnos + atualizadoEm). */
  load(assinanteId: string): Promise<StoredMemory>;
  /** Sobrescreve a janela de turnos do assinante (upsert; toca atualizado_em). */
  save(assinanteId: string, turnos: ConversationTurn[]): Promise<void>;
  /** Limpa a memória do assinante (ex.: ao esfriar por TTL). */
  clear(assinanteId: string): Promise<void>;
}

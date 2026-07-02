/**
 * Store da memória de conversa — por TENANT, via `withTenant` (RLS/authenticated,
 * sem service_role). O `assinanteId` vem sempre da identidade autenticada, nunca de
 * texto do usuário. O isolamento entre assinantes é garantido pelo RLS (force).
 */
import { jsonbParse } from './jsonb.js';
import { withTenant } from './tenant.js';
import type {
  ConversationMemoryStore,
  ConversationTurn,
  StoredMemory,
} from '../../core/ports/conversation-memory.js';

export const conversationMemoryStore: ConversationMemoryStore = {
  load(assinanteId: string): Promise<StoredMemory> {
    return withTenant(assinanteId, async (tx) => {
      const rows = await tx<{ turnos: ConversationTurn[]; atualizado_em: Date | string }[]>`
        select turnos, atualizado_em from conversa_memoria where assinante_id = ${assinanteId}
      `;
      const r = rows[0];
      if (!r) return { turnos: [], atualizadoEm: null };
      return {
        turnos: jsonbParse<ConversationTurn[]>(r.turnos, []),
        atualizadoEm: new Date(r.atualizado_em).toISOString(),
      };
    });
  },

  save(assinanteId: string, turnos: ConversationTurn[]): Promise<void> {
    return withTenant(assinanteId, async (tx) => {
      await tx`
        insert into conversa_memoria (assinante_id, turnos)
        values (${assinanteId}, ${turnos as never}::jsonb)
        on conflict (assinante_id) do update set turnos = excluded.turnos
      `;
    });
  },

  clear(assinanteId: string): Promise<void> {
    return withTenant(assinanteId, async (tx) => {
      await tx`delete from conversa_memoria where assinante_id = ${assinanteId}`;
    });
  },
};

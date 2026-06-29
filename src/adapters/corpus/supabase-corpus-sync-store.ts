/**
 * Implementação do `CorpusSyncStore` (back-office) — grava o corpus via `pool`
 * (sem tenant, sem service_role). Usada pelo motor de sync, fora do caminho da
 * mensagem do assinante.
 */
import type { CorpusSyncStore } from '../../core/ports/corpus.js';
import {
  finishSyncRun,
  getNormaSyncState,
  replaceTrechos,
  startSyncRun,
  updateNormaSync,
  upsertNorma,
} from '../../infra/db/corpus-store.js';

export const supabaseCorpusSyncStore: CorpusSyncStore = {
  getNormaState: getNormaSyncState,
  upsertNorma,
  replaceTrechos,
  updateNormaSync,
  startRun: startSyncRun,
  finishRun: finishSyncRun,
};

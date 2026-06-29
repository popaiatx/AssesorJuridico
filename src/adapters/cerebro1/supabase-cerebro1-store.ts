/**
 * Implementações reais das portas do Cérebro 1, ligando às funções de
 * `infra/db/cerebro1-store` (queries parametrizadas via withTenant).
 */
import type { Cerebro1Store, PendingActionStore } from '../../core/ports/cerebro1.js';
import {
  cadastrarProcesso,
  clearPendingAction,
  consultarProcesso,
  criarCompromisso,
  getPendingAction,
  listarCompromissos,
  listarProcessos,
  resolveProcessoIdByCnj,
  savePendingAction,
  upsertClienteByNome,
} from '../../infra/db/cerebro1-store.js';

export const supabaseCerebro1Store: Cerebro1Store = {
  criarCompromisso,
  listarCompromissos,
  resolveProcessoIdByCnj,
  upsertClienteByNome,
  cadastrarProcesso,
  listarProcessos,
  consultarProcesso,
};

export const supabasePendingStore: PendingActionStore = {
  get: getPendingAction,
  save: savePendingAction,
  clear: clearPendingAction,
};

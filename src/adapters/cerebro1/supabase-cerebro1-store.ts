/**
 * Implementações reais das portas do Cérebro 1, ligando às funções de
 * `infra/db/cerebro1-store` (queries parametrizadas via withTenant).
 */
import type { Cerebro1Store, PendingActionStore } from '../../core/ports/cerebro1.js';
import {
  arquivarProcesso,
  cadastrarProcesso,
  clearPendingAction,
  consultarProcesso,
  criarCompromisso,
  deleteCompromisso,
  findCompromissos,
  findProcessos,
  getCompromissoById,
  getPendingAction,
  getProcessoById,
  listarCompromissos,
  listarProcessos,
  resolveProcessoIdByCnj,
  savePendingAction,
  updateCompromisso,
  updateProcesso,
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
  findCompromissos,
  getCompromissoById,
  updateCompromisso,
  deleteCompromisso,
  findProcessos,
  getProcessoById,
  updateProcesso,
  arquivarProcesso,
};

export const supabasePendingStore: PendingActionStore = {
  get: getPendingAction,
  save: savePendingAction,
  clear: clearPendingAction,
};

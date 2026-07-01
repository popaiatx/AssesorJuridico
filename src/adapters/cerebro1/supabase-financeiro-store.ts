/**
 * Implementação real da porta do financeiro (Passo 16), ligando às queries
 * escopadas por tenant de `infra/db/financeiro-store` (withTenant + RLS).
 */
import type { FinanceiroStore } from '../../core/ports/financeiro.js';
import {
  cancelarAcordoPendentes,
  cancelarParcela,
  criarHonorario,
  findAcordos,
  findParcelas,
  getAcordoById,
  getParcelaById,
  listarPendentes,
  marcarParcelaPaga,
  updateParcela,
} from '../../infra/db/financeiro-store.js';

export const supabaseFinanceiroStore: FinanceiroStore = {
  criarHonorario,
  findParcelas,
  getParcelaById,
  marcarParcelaPaga,
  updateParcela,
  cancelarParcela,
  findAcordos,
  getAcordoById,
  cancelarAcordoPendentes,
  listarPendentes,
};

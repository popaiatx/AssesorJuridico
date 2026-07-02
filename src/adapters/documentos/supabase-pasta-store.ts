/**
 * Implementação real da porta de PASTAS de documentos (Passo 18), ligando às
 * queries escopadas por tenant de `infra/db/documentos-store` (withTenant + RLS).
 */
import type { DocumentoPastaStore } from '../../core/ports/documentos.js';
import {
  findProcessosPorNumeros,
  getProcessoPastaById,
  listarDocumentosPorPasta,
  setDocumentoProcessoId,
} from '../../infra/db/documentos-store.js';

export const supabaseDocumentoPastaStore: DocumentoPastaStore = {
  findProcessosPorNumeros,
  getProcessoPastaById,
  setProcessoId: setDocumentoProcessoId,
  listarPorPasta: listarDocumentosPorPasta,
};

/**
 * Implementação do `CorpusStore` (busca pública via pool — corpus sem tenant).
 */
import type { CorpusStore } from '../../core/ports/corpus.js';
import { searchCorpus } from '../../infra/db/corpus-store.js';

export const supabaseCorpusStore: CorpusStore = {
  search: searchCorpus,
};

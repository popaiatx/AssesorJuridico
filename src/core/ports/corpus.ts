/**
 * Portas do corpus jurídico (Cérebro 2). Corpus é COMPARTILHADO (referência
 * pública, sem tenant); a busca é leitura pública. A ingestão (escrita) é
 * back-office, fora do caminho da mensagem.
 */

/** Trecho recuperado na busca vetorial. */
export interface CorpusTrecho {
  citacao: string;
  texto: string;
  fonteUrl: string | null;
  /** Similaridade cosseno (1 = idêntico). */
  similarity: number;
}

export interface CorpusStore {
  /** Busca os `k` trechos mais próximos do embedding (corpus inteiro, sem tenant). */
  search(embedding: number[], k: number): Promise<CorpusTrecho[]>;
}

// --- Tipos da ingestão (usados pelo script de back-office) ---

export interface NormaInput {
  tipo: 'legislacao' | 'jurisprudencia';
  titulo: string;
  identificador: string;
  dataPublicacao: string | null;
  vigenciaStatus: string | null;
  fonteUrl: string | null;
}

export interface TrechoInput {
  artigo: string | null;
  paragrafo: string | null;
  inciso: string | null;
  ordem: number;
  texto: string;
  citacao: string;
  fonteUrl: string | null;
  embedding: number[];
}

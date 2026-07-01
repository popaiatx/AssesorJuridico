/**
 * Port de OCR (driven) — reconhecimento de texto LOCAL (o documento nunca sai do
 * ambiente). Provider-agnostic: hoje tesseract.js (WASM), amanhã outro sem
 * reescrever quem usa. Só é chamado como SEGUNDA tentativa, quando a extração
 * nativa (pdf-parse/mammoth/txt) não achou texto aproveitável.
 */

export interface OcrResultado {
  /** Texto reconhecido (concatenado das páginas lidas). */
  texto: string;
  /** Confiança média 0–100 reportada pelo motor de OCR. */
  confianca: number;
  /** Total de páginas do documento (1 para imagem). */
  paginas: number;
  /** Páginas efetivamente lidas (≤ paginas; limitado por maxPaginas). */
  paginasLidas: number;
}

export interface OcrPort {
  /**
   * Reconhece o texto de uma imagem ou PDF escaneado. `maxPaginas` limita quantas
   * páginas do PDF são lidas (proteção de tempo/memória; a CLI de re-OCR pode
   * passar um limite maior). Imagens leem 1 "página".
   */
  reconhecer(
    bytes: Uint8Array,
    contentType: string | null,
    maxPaginas: number,
  ): Promise<OcrResultado>;
}

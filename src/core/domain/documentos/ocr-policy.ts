/**
 * Política PURA de confiança do OCR (Passo 13). Decide se o texto reconhecido é
 * confiável o bastante para virar conteúdo do documento — sem I/O, testável.
 *
 * Regra (conservadora — OCR não pode virar fonte de erro):
 *  - texto insignificante OU confiança < limiar → NÃO usa (sem_texto): melhor o
 *    documento ficar fora da busca do que registrar um número lido errado.
 *  - senão → ok_ocr; se leu menos páginas que o total → ok_ocr_parcial (cobertura
 *    parcial sinalizada, para não fingir que leu o documento inteiro).
 */
import { AVISO, avisoOcrParcial, isMeaningfulText } from './formato.js';
import type { ExtracaoStatus } from '../../ports/documentos.js';
import type { OcrResultado } from '../../ports/ocr.js';

export interface OcrVeredito {
  status: Extract<ExtracaoStatus, 'ok_ocr' | 'ok_ocr_parcial' | 'sem_texto'>;
  /** Texto a usar (vazio quando sem_texto). */
  texto: string;
  /** Aviso ao usuário (transparência: OCR/OCR parcial/baixa confiança). */
  aviso: string;
}

export function avaliarOcr(r: OcrResultado, minConfianca: number): OcrVeredito {
  const texto = (r.texto ?? '').trim();
  if (!isMeaningfulText(texto) || r.confianca < minConfianca) {
    return { status: 'sem_texto', texto: '', aviso: AVISO.ocrBaixaConfianca };
  }
  const parcial = r.paginasLidas < r.paginas;
  return parcial
    ? { status: 'ok_ocr_parcial', texto, aviso: avisoOcrParcial(r.paginasLidas, r.paginas) }
    : { status: 'ok_ocr', texto, aviso: AVISO.ocrConfira };
}

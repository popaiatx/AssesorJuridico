/**
 * Config do OCR local (Passo 13), no padrão dos demais adapters: o app sobe sem
 * OCR (e aí o escaneado continua `sem_texto`, como antes). Só ativa com OCR_ENABLED.
 */
import { config } from '../../infra/config/index.js';

export interface OcrConfig {
  idioma: string;
  minConfianca: number;
  maxPaginas: number;
  tessdataDir: string;
}

export function getOcrConfig(): OcrConfig | null {
  if (!config.OCR_ENABLED) return null;
  return {
    idioma: config.OCR_IDIOMA,
    minConfianca: config.OCR_MIN_CONFIANCA,
    maxPaginas: config.OCR_MAX_PAGINAS,
    tessdataDir: config.OCR_TESSDATA_DIR,
  };
}

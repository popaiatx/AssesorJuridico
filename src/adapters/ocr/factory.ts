/**
 * Seleção do adapter de OCR por config (provider-agnostic). Hoje só tesseract.js;
 * amanhã outro motor sem mexer em quem usa o OcrPort.
 */
import type { OcrConfig } from './config.js';
import { TesseractOcr } from './tesseract-ocr.js';

export function createOcrAdapter(cfg: OcrConfig): TesseractOcr {
  return new TesseractOcr(cfg);
}

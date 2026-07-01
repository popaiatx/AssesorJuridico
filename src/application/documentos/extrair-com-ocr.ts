/**
 * Extração de texto com OCR como SEGUNDA tentativa (Passo 13). Roda a extração
 * nativa (pdf-parse/mammoth/txt); se ela não achou texto e o formato é imagem/PDF,
 * tenta o OCR local e aplica a política de confiança (ok_ocr / ok_ocr_parcial /
 * sem_texto). Reaproveitado tanto no guardar (12A) quanto no resumir (12C).
 *
 * NÃO baixa nada do Storage nem decide dono — quem chama já tem os bytes do
 * documento do próprio tenant (a verificação de posse é feita antes, no serviço).
 */
import { extrairTexto, type ExtracaoResultado } from '../../adapters/documentos/extractors.js';
import { avaliarOcr } from '../../core/domain/documentos/ocr-policy.js';
import type { OcrPort } from '../../core/ports/ocr.js';

interface Logger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface ExtrairComOcrDeps {
  /** Extrator nativo (injetável p/ teste); default = extrairTexto. */
  extrair?: (bytes: Uint8Array, filename: string, ct: string | null) => Promise<ExtracaoResultado>;
  /** OCR local (opcional). Ausente/desabilitado → comportamento sem OCR. */
  ocr?: OcrPort;
  ocrMinConfianca: number;
  ocrMaxPaginas: number;
  logger?: Logger;
}

export async function extrairComOcr(
  bytes: Uint8Array,
  filename: string,
  contentType: string | null,
  deps: ExtrairComOcrDeps,
): Promise<ExtracaoResultado> {
  const extrair = deps.extrair ?? extrairTexto;
  const ex = await extrair(bytes, filename, contentType);
  if (ex.status === 'ok') return ex; // texto nativo — nem tenta OCR
  if (!deps.ocr) return ex;
  // OCR só faz sentido para imagem ou PDF (escaneado). Planilha/desconhecido: não.
  if (ex.formato !== 'imagem' && ex.formato !== 'pdf') return ex;

  let r;
  try {
    r = await deps.ocr.reconhecer(bytes, contentType, deps.ocrMaxPaginas);
  } catch (err) {
    deps.logger?.error({ err }, 'ocr: falha ao reconhecer (mantém extração nativa)');
    return ex; // OCR falhou → mantém o resultado nativo (sem_texto/falha)
  }
  const v = avaliarOcr(r, deps.ocrMinConfianca);
  return { texto: v.texto, status: v.status, formato: ex.formato, aviso: v.aviso };
}

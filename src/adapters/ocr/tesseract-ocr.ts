/**
 * Adapter de OCR LOCAL (Passo 13) — tesseract.js (WASM). O documento NUNCA sai do
 * ambiente. Sem dependência de sistema: core/worker vêm do pacote e o modelo de
 * idioma é vendorizado (langPath local; sem CDN em runtime).
 *
 * PDF escaneado é rasterizado com @hyzyla/pdfium (WASM) + sharp; imagem vai direto.
 * Um único worker (lazy) e uma FILA serializada — OCR é pesado; não paralelizamos
 * para não multiplicar memória (o motor é single-thread de qualquer forma).
 */
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import type { OcrConfig } from './config.js';
import type { OcrPort, OcrResultado } from '../../core/ports/ocr.js';

const ESCALA_PDF = 2; // 2× ~ 150–200 DPI: bom p/ OCR sem estourar memória/tempo.

/** Fila serializada: um OCR por vez (memória previsível). */
let cadeia: Promise<unknown> = Promise.resolve();
function enfileirar<T>(fn: () => Promise<T>): Promise<T> {
  const proximo = cadeia.then(fn, fn);
  cadeia = proximo.then(
    () => undefined,
    () => undefined,
  );
  return proximo;
}

export class TesseractOcr implements OcrPort {
  private worker: Worker | null = null;

  constructor(private readonly cfg: OcrConfig) {}

  private async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    // langPath local (vendor) + sem cache em disco: nenhuma chamada externa.
    this.worker = await createWorker(this.cfg.idioma, 1, {
      langPath: resolve(this.cfg.tessdataDir),
      cacheMethod: 'none',
      gzip: true,
      logger: () => {},
      errorHandler: () => {},
    });
    return this.worker;
  }

  /** Encerra o worker (usar em scripts/CLI no fim; no server fica vivo). */
  async terminar(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  reconhecer(bytes: Uint8Array, contentType: string | null, maxPaginas: number): Promise<OcrResultado> {
    return enfileirar(() => this.executar(bytes, contentType, maxPaginas));
  }

  private async executar(
    bytes: Uint8Array,
    contentType: string | null,
    maxPaginas: number,
  ): Promise<OcrResultado> {
    const ehPdf = (contentType ?? '').toLowerCase().includes('pdf');
    const worker = await this.getWorker();

    if (!ehPdf) {
      const { data } = await worker.recognize(Buffer.from(bytes));
      return { texto: (data.text ?? '').trim(), confianca: data.confidence ?? 0, paginas: 1, paginasLidas: 1 };
    }

    // PDF escaneado → rasteriza as primeiras `maxPaginas` páginas → OCR por página.
    const { pngs, total } = await rasterizarPdf(bytes, maxPaginas);
    const partes: Array<{ texto: string; conf: number }> = [];
    for (const png of pngs) {
      const { data } = await worker.recognize(png);
      partes.push({ texto: (data.text ?? '').trim(), conf: data.confidence ?? 0 });
    }
    const texto = partes.map((p) => p.texto).join('\n\n').trim();
    // Confiança média ponderada pelo tamanho do texto (página vazia não distorce).
    const pesoTotal = partes.reduce((s, p) => s + p.texto.length, 0);
    const confianca =
      pesoTotal > 0
        ? partes.reduce((s, p) => s + p.conf * p.texto.length, 0) / pesoTotal
        : 0;
    return { texto, confianca, paginas: total, paginasLidas: pngs.length };
  }
}

/** Rasteriza as primeiras `maxPaginas` páginas do PDF em PNG (pdfium WASM + sharp). */
async function rasterizarPdf(
  bytes: Uint8Array,
  maxPaginas: number,
): Promise<{ pngs: Buffer[]; total: number }> {
  const lib = await PDFiumLibrary.init();
  const doc = await lib.loadDocument(Buffer.from(bytes));
  try {
    const paginas = Array.from(doc.pages());
    const total = paginas.length;
    const alvo = paginas.slice(0, Math.max(1, maxPaginas));
    const pngs: Buffer[] = [];
    for (const page of alvo) {
      const img = await page.render({
        scale: ESCALA_PDF,
        render: (opts: { data: Uint8Array; width: number; height: number }) =>
          sharp(Buffer.from(opts.data), {
            raw: { width: opts.width, height: opts.height, channels: 4 },
          })
            .png()
            .toBuffer(),
      });
      pngs.push(img.data as Buffer);
    }
    return { pngs, total };
  } finally {
    doc.destroy();
    lib.destroy();
  }
}

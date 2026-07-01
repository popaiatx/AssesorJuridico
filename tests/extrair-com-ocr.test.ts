import { describe, expect, it, vi } from 'vitest';
import { extrairComOcr } from '../src/application/documentos/extrair-com-ocr';
import type { ExtracaoResultado } from '../src/adapters/documentos/extractors';
import type { OcrPort, OcrResultado } from '../src/core/ports/ocr';

const nativo = (r: Partial<ExtracaoResultado>): ExtracaoResultado => ({
  texto: '', status: 'sem_texto', formato: 'imagem', ...r,
});

class FakeOcr implements OcrPort {
  chamadas = 0;
  constructor(private readonly res: OcrResultado) {}
  reconhecer(): Promise<OcrResultado> {
    this.chamadas++;
    return Promise.resolve(this.res);
  }
}

const boaLeitura: OcrResultado = { texto: 'CONTRATO DE LOCACAO com protocolo 5551 e valor R$ 2.000,00', confianca: 90, paginas: 1, paginasLidas: 1 };

describe('extrairComOcr', () => {
  it('texto nativo OK → NEM tenta OCR', async () => {
    const ocr = new FakeOcr(boaLeitura);
    const r = await extrairComOcr(new Uint8Array(), 'a.pdf', 'application/pdf', {
      extrair: () => Promise.resolve(nativo({ texto: 'texto nativo grande e suficiente aqui', status: 'ok', formato: 'pdf' })),
      ocr, ocrMinConfianca: 60, ocrMaxPaginas: 3,
    });
    expect(r.status).toBe('ok');
    expect(ocr.chamadas).toBe(0);
  });

  it('imagem sem texto nativo → OCR bom → ok_ocr', async () => {
    const ocr = new FakeOcr(boaLeitura);
    const r = await extrairComOcr(new Uint8Array(), 'scan.png', 'image/png', {
      extrair: () => Promise.resolve(nativo({ formato: 'imagem' })),
      ocr, ocrMinConfianca: 60, ocrMaxPaginas: 3,
    });
    expect(r.status).toBe('ok_ocr');
    expect(r.texto).toContain('CONTRATO');
    expect(ocr.chamadas).toBe(1);
  });

  it('OCR de baixa confiança → permanece sem_texto (não usa o texto)', async () => {
    const ocr = new FakeOcr({ ...boaLeitura, confianca: 30 });
    const r = await extrairComOcr(new Uint8Array(), 'scan.png', 'image/png', {
      extrair: () => Promise.resolve(nativo({ formato: 'imagem' })),
      ocr, ocrMinConfianca: 60, ocrMaxPaginas: 3,
    });
    expect(r.status).toBe('sem_texto');
    expect(r.texto).toBe('');
  });

  it('PDF com muitas páginas lidas em parte → ok_ocr_parcial', async () => {
    const ocr = new FakeOcr({ ...boaLeitura, paginas: 10, paginasLidas: 3 });
    const r = await extrairComOcr(new Uint8Array(), 'scan.pdf', 'application/pdf', {
      extrair: () => Promise.resolve(nativo({ formato: 'pdf' })),
      ocr, ocrMinConfianca: 60, ocrMaxPaginas: 3,
    });
    expect(r.status).toBe('ok_ocr_parcial');
  });

  it('sem OCR configurado → mantém sem_texto', async () => {
    const r = await extrairComOcr(new Uint8Array(), 'scan.png', 'image/png', {
      extrair: () => Promise.resolve(nativo({ formato: 'imagem' })),
      ocrMinConfianca: 60, ocrMaxPaginas: 3,
    });
    expect(r.status).toBe('sem_texto');
  });

  it('formato não-imagem/não-pdf (planilha) → não tenta OCR', async () => {
    const ocr = new FakeOcr(boaLeitura);
    const r = await extrairComOcr(new Uint8Array(), 'x.csv', 'text/csv', {
      extrair: () => Promise.resolve(nativo({ formato: 'planilha' })),
      ocr, ocrMinConfianca: 60, ocrMaxPaginas: 3,
    });
    expect(r.status).toBe('sem_texto');
    expect(ocr.chamadas).toBe(0);
  });

  it('OCR lança erro → mantém a extração nativa (não quebra)', async () => {
    const ocr: OcrPort = { reconhecer: () => Promise.reject(new Error('boom')) };
    const r = await extrairComOcr(new Uint8Array(), 'scan.png', 'image/png', {
      extrair: () => Promise.resolve(nativo({ formato: 'imagem' })),
      ocr, ocrMinConfianca: 60, ocrMaxPaginas: 3, logger: { error: vi.fn() },
    });
    expect(r.status).toBe('sem_texto');
  });
});

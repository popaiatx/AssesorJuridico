import { describe, expect, it } from 'vitest';
import { avaliarOcr } from '../src/core/domain/documentos/ocr-policy';
import type { OcrResultado } from '../src/core/ports/ocr';

const texto = 'CONTRATO DE LOCACAO RESIDENCIAL entre Joao e Maria, protocolo 5551, valor R$ 2.000,00.';
const base = (over: Partial<OcrResultado>): OcrResultado => ({
  texto, confianca: 90, paginas: 1, paginasLidas: 1, ...over,
});

describe('avaliarOcr', () => {
  it('confiança boa + texto significativo → ok_ocr (com aviso de conferir)', () => {
    const v = avaliarOcr(base({}), 60);
    expect(v.status).toBe('ok_ocr');
    expect(v.texto).toContain('CONTRATO');
    expect(v.aviso.toLowerCase()).toContain('ocr');
  });

  it('confiança abaixo do limiar → sem_texto, NÃO usa o texto (não inventa)', () => {
    const v = avaliarOcr(base({ confianca: 40 }), 60);
    expect(v.status).toBe('sem_texto');
    expect(v.texto).toBe('');
    expect(v.aviso.toLowerCase()).toContain('parcialmente');
  });

  it('texto insignificante → sem_texto mesmo com confiança alta', () => {
    const v = avaliarOcr(base({ texto: 'a b', confianca: 99 }), 60);
    expect(v.status).toBe('sem_texto');
  });

  it('leu menos páginas que o total → ok_ocr_parcial com aviso de N de M', () => {
    const v = avaliarOcr(base({ paginas: 12, paginasLidas: 3 }), 60);
    expect(v.status).toBe('ok_ocr_parcial');
    expect(v.aviso).toContain('3');
    expect(v.aviso).toContain('12');
  });
});

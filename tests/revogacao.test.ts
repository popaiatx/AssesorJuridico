import { describe, expect, it } from 'vitest';
import { detectarRevogacaoNorma } from '../src/core/domain/cerebro2/revogacao';

describe('detectarRevogacaoNorma (defensivo)', () => {
  it('detecta revogação da norma inteira no cabeçalho (Revogada pela Lei)', () => {
    const txt =
      'CÓDIGO CIVIL DOS ESTADOS UNIDOS DO BRASIL (Revogada pela Lei nº 10.406, de 2002)\n' +
      'Art. 1º Toda pessoa é capaz de direitos e obrigações.';
    expect(detectarRevogacaoNorma(txt)).toBe(true);
  });

  it('aceita gênero masculino e "pelo Decreto"', () => {
    const txt = 'DECRETO X — Revogado pelo Decreto-Lei nº 9, de 1940.\nArt. 1 ...';
    expect(detectarRevogacaoNorma(txt)).toBe(true);
  });

  it('norma vigente (sem marcador) → false', () => {
    const txt =
      'LEI Nº 8.078, DE 11 DE SETEMBRO DE 1990. Dispõe sobre a proteção do consumidor.\n' +
      'Art. 1º O presente código estabelece normas de proteção...';
    expect(detectarRevogacaoNorma(txt)).toBe(false);
  });

  it('NÃO confunde com revogação de ARTIGO no corpo (após art. 1)', () => {
    const txt =
      'LEI Nº 10.406. Institui o Código Civil.\n' +
      'Art. 1º Toda pessoa é capaz...\n' +
      'Art. 1.969 (Revogado pela Lei nº 11.441, de 2007).';
    expect(detectarRevogacaoNorma(txt)).toBe(false);
  });

  it('NÃO casa prosa solta ("atos revogados tinham por objeto")', () => {
    const txt =
      'LEI X.\nArt. 1º ...\nParágrafo único. Se os atos revogados tinham por objeto...';
    expect(detectarRevogacaoNorma(txt)).toBe(false);
  });

  it('texto vazio → false (default seguro: vigente)', () => {
    expect(detectarRevogacaoNorma('')).toBe(false);
  });
});

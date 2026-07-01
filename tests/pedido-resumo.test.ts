import { describe, expect, it } from 'vitest';
import { ehPedidoResumo, interpretarPedido } from '../src/core/domain/documentos/pedido-resumo';

describe('ehPedidoResumo', () => {
  it('detecta o verbo resumir (com variações/acentos)', () => {
    expect(ehPedidoResumo('me resume o contrato')).toBe(true);
    expect(ehPedidoResumo('faz um resumo disso')).toBe(true);
    expect(ehPedidoResumo('resuma o segundo')).toBe(true);
    expect(ehPedidoResumo('acha o contrato do João')).toBe(false);
  });
});

describe('interpretarPedido', () => {
  it('sem resumo → buscar com a referência original', () => {
    expect(interpretarPedido('acha o contrato de aluguel')).toEqual({
      acao: 'buscar',
      referencia: 'acha o contrato de aluguel',
    });
  });

  it('ordinal por extenso → resumir alvo ordinal, modo guardado', () => {
    expect(interpretarPedido('resume o segundo')).toEqual({
      acao: 'resumir',
      alvo: { tipo: 'ordinal', indice: 2 },
      modo: 'guardado',
    });
  });

  it('"o último" → indice -1', () => {
    const p = interpretarPedido('me resume o último');
    expect(p).toEqual({ acao: 'resumir', alvo: { tipo: 'ordinal', indice: -1 }, modo: 'guardado' });
  });

  it('ordinal numérico com pista ("o 3") → indice 3', () => {
    expect(interpretarPedido('resume o 3')).toEqual({
      acao: 'resumir',
      alvo: { tipo: 'ordinal', indice: 3 },
      modo: 'guardado',
    });
  });

  it('referência por nome → resumir alvo referência', () => {
    const p = interpretarPedido('resume o do gabriel');
    expect(p.acao).toBe('resumir');
    if (p.acao === 'resumir') {
      expect(p.alvo).toEqual({ tipo: 'referencia', termo: 'o do gabriel' });
      expect(p.modo).toBe('guardado');
    }
  });

  it('número de protocolo NÃO vira ordinal (fica na referência)', () => {
    const p = interpretarPedido('resume o documento com protocolo 4567');
    expect(p.acao).toBe('resumir');
    if (p.acao === 'resumir') {
      expect(p.alvo.tipo).toBe('referencia');
      if (p.alvo.tipo === 'referencia') expect(p.alvo.termo).toContain('4567');
    }
  });

  it('foco → modo novo + foco, referência sem a cláusula de foco', () => {
    const p = interpretarPedido('resume o contrato focando nos prazos');
    expect(p.acao).toBe('resumir');
    if (p.acao === 'resumir') {
      expect(p.modo).toBe('novo');
      expect(p.foco).toBe('prazos');
      expect(p.alvo).toEqual({ tipo: 'referencia', termo: 'o contrato' });
    }
  });

  it('"mais detalhado" → modo novo (sem foco)', () => {
    const p = interpretarPedido('faz um resumo mais detalhado do contrato');
    expect(p.acao).toBe('resumir');
    if (p.acao === 'resumir') expect(p.modo).toBe('novo');
  });
});

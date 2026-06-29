import { describe, expect, it } from 'vitest';
import { createAnonymizer } from '../src/core/domain/anonymization';

describe('createAnonymizer', () => {
  it('mascara com rótulo estável e reidentifica', () => {
    const a = createAnonymizer();
    const m1 = a.mask('Maria Silva', 'Cliente');
    const m2 = a.mask('Maria Silva', 'Cliente'); // mesmo valor → mesmo rótulo
    const p1 = a.mask('Empresa X', 'Parte');
    expect(m1).toBe('Cliente A');
    expect(m2).toBe('Cliente A');
    expect(p1).toBe('Parte A');

    const textoLlm = 'O Cliente A tem processo contra a Parte A.';
    expect(textoLlm).not.toContain('Maria Silva'); // payload ao LLM não vaza o nome
    expect(a.reidentify(textoLlm)).toBe('O Maria Silva tem processo contra a Empresa X.');
  });

  it('incrementa rótulos por tipo e reidentifica sem colisão (A vs AA…)', () => {
    const a = createAnonymizer();
    const nomes = Array.from({ length: 27 }, (_, i) => a.mask(`Cli${i}`, 'Cliente'));
    expect(nomes[0]).toBe('Cliente A');
    expect(nomes[25]).toBe('Cliente Z');
    expect(nomes[26]).toBe('Cliente AA');
    expect(a.reidentify('Cliente AA e Cliente A')).toBe('Cli26 e Cli0');
  });
});

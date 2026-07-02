import { describe, expect, it } from 'vitest';
import {
  avisoCnjSemDono,
  cnjForte,
  numerosCandidatos,
  perguntaSugestao,
  perguntaSugestaoMultipla,
} from '../src/core/domain/documentos/sugestao-pasta';
import type { KeyInfo } from '../src/core/ports/documentos';

function chaves(numeros: string[]): KeyInfo {
  return { tipo: 'contrato', partes: [], numeros, datas: [], assunto: '', resumoCurto: '' };
}

describe('numerosCandidatos (normalização determinística)', () => {
  it('só dígitos, ≥4, sem duplicatas, ordem preservada', () => {
    expect(numerosCandidatos(chaves(['0001234-56.2024.8.26.0100', '5551', '123', '5551']))).toEqual([
      '00012345620248260100',
      '5551',
    ]);
  });
  it('sem chaves / sem números → vazio (sem sugestão)', () => {
    expect(numerosCandidatos(null)).toEqual([]);
    expect(numerosCandidatos(chaves([]))).toEqual([]);
  });
  it('teto de candidatos (não explode com documento cheio de números)', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => `${1000 + i}`);
    expect(numerosCandidatos(chaves(muitos)).length).toBeLessThanOrEqual(8);
  });
});

describe('cnjForte (aviso honesto de processo inexistente)', () => {
  it('detecta CNJ de 20 dígitos; fragmento não é forte', () => {
    expect(cnjForte(['5551', '00012345620248260100'])).toBe('00012345620248260100');
    expect(cnjForte(['5551', '12345'])).toBeNull();
  });
});

describe('perguntas da sugestão', () => {
  const p = { id: 'p1', numeroCnj: '00012345620248260100', clienteNome: 'Gabriel Machado' };
  it('única: sim/não, mostrando processo e cliente', () => {
    const q = perguntaSugestao(p);
    expect(q).toContain('processo 00012345620248260100');
    expect(q).toContain('Gabriel Machado');
    expect(q).toContain('guardo na pasta dele?');
  });
  it('múltipla: lista numerada + opção de deixar avulso', () => {
    const q = perguntaSugestaoMultipla([p, { id: 'p2', numeroCnj: '00012345920138260100', clienteNome: null }]);
    expect(q).toContain('1)');
    expect(q).toContain('2)');
    expect(q).toContain('*não*');
  });
  it('aviso de CNJ sem dono é honesto e menciona o número', () => {
    expect(avisoCnjSemDono('00099999920248260100')).toContain('não achei esse processo');
  });
});

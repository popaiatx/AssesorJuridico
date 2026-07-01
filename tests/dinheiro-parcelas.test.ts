import { describe, expect, it } from 'vitest';
import {
  centavosParaDecimal,
  decimalParaCentavos,
  formatarCentavos,
  parseValorBRL,
} from '../src/core/domain/cerebro1/dinheiro';
import {
  dividirComSomaExata,
  gerarPlano,
  hojeBRT,
  vencimentosMensais,
} from '../src/core/domain/cerebro1/parcelas';

describe('parseValorBRL (ambíguo → null, nunca adivinha)', () => {
  it('formatos claros', () => {
    expect(parseValorBRL('R$ 10.000,00')).toBe(1000000);
    expect(parseValorBRL('10000')).toBe(1000000);
    expect(parseValorBRL('1.000')).toBe(100000); // milhar pt-BR
    expect(parseValorBRL('1.000,50')).toBe(100050);
    expect(parseValorBRL('1000,5')).toBe(100050);
    expect(parseValorBRL('1000.50')).toBe(100050); // ponto decimal de teclado
    expect(parseValorBRL('0,05')).toBe(5);
    expect(parseValorBRL('10.000.000')).toBe(1000000000);
  });
  it('ambíguo/inválido → null', () => {
    expect(parseValorBRL('1.5000')).toBeNull();
    expect(parseValorBRL('10 mil')).toBeNull();
    expect(parseValorBRL('1,2,3')).toBeNull();
    expect(parseValorBRL('1.00,5')).toBeNull();
    expect(parseValorBRL('')).toBeNull();
  });
  it('ida e volta com o decimal do Postgres', () => {
    expect(centavosParaDecimal(1000000)).toBe('10000.00');
    expect(decimalParaCentavos('10000.00')).toBe(1000000);
    expect(decimalParaCentavos('0.05')).toBe(5);
    expect(decimalParaCentavos('lixo')).toBeNull();
    expect(formatarCentavos(1000050)).toBe('R$ 10.000,50');
    expect(formatarCentavos(5)).toBe('R$ 0,05');
  });
});

describe('dividirComSomaExata (a diferença vai na PRIMEIRA)', () => {
  it('R$ 10.000 em 3 → 3.333,34 + 3.333,33 + 3.333,33', () => {
    expect(dividirComSomaExata(1000000, 3)).toEqual([333334, 333333, 333333]);
  });
  it('propriedade: soma SEMPRE bate com o total (casos de borda)', () => {
    for (const [total, n] of [
      [1000000, 3],
      [10000, 7],
      [5, 3],
      [999999, 12],
      [100, 1],
    ] as const) {
      const partes = dividirComSomaExata(total, n);
      expect(partes).toHaveLength(n);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.min(...partes)).toBeGreaterThanOrEqual(0);
      // diferença concentrada na primeira; demais são iguais
      expect(new Set(partes.slice(1)).size).toBeLessThanOrEqual(1);
    }
  });
});

describe('vencimentosMensais (clamp NÃO-sticky ao último dia)', () => {
  it('dia 31 → fev vira 28 e MARÇO VOLTA ao 31', () => {
    expect(vencimentosMensais(2027, 1, 31, 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });
  it('bissexto: fev/2028 vira 29', () => {
    expect(vencimentosMensais(2028, 1, 31, 2)).toEqual(['2028-01-31', '2028-02-29']);
  });
  it('dia 30 → fev clampa; abril mantém 30; dia 31 → abril vira 30', () => {
    expect(vencimentosMensais(2027, 2, 30, 2)).toEqual(['2027-02-28', '2027-03-30']);
    expect(vencimentosMensais(2027, 3, 31, 2)).toEqual(['2027-03-31', '2027-04-30']);
  });
  it('vira o ano', () => {
    expect(vencimentosMensais(2026, 11, 20, 3)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
  });
});

describe('gerarPlano', () => {
  it('parcelado por TOTAL: 10.000 em 10, todo dia 20 desde julho', () => {
    const r = gerarPlano({ totalCentavos: 1000000, numParcelas: 10, primeiroVencimento: '2026-07-20' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plano.parcelas).toHaveLength(10);
    expect(r.plano.parcelas[0]).toMatchObject({ parcela: 1, totalParcelas: 10, valorDecimal: '1000.00', vencimento: '2026-07-20' });
    expect(r.plano.parcelas[9]!.vencimento).toBe('2027-04-20');
    expect(r.plano.parcelas.reduce((a, p) => a + p.valorCentavos, 0)).toBe(1000000);
  });
  it('modo valor-da-parcela ("10x de R$ 1.000"): sem arredondamento, total derivado', () => {
    const r = gerarPlano({ valorParcelaCentavos: 100000, numParcelas: 10, primeiroVencimento: '2026-07-20' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plano.totalCentavos).toBe(1000000);
    expect(new Set(r.plano.parcelas.map((p) => p.valorDecimal))).toEqual(new Set(['1000.00']));
  });
  it('à vista = 1 parcela única', () => {
    const r = gerarPlano({ totalCentavos: 1000000, numParcelas: 1, primeiroVencimento: '2026-07-20' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plano.parcelas).toEqual([
      { parcela: 1, totalParcelas: 1, valorCentavos: 1000000, valorDecimal: '10000.00', vencimento: '2026-07-20' },
    ]);
  });
  it('dia preferido explícito diferente da âncora (todo dia 31 começando em fev)', () => {
    const r = gerarPlano({ totalCentavos: 300000, numParcelas: 3, primeiroVencimento: '2027-02-01', diaVencimento: 31 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plano.parcelas.map((p) => p.vencimento)).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
  });
  it('erros claros: total < N centavos; parcelas inválidas; data ruim', () => {
    expect(gerarPlano({ totalCentavos: 2, numParcelas: 3, primeiroVencimento: '2026-07-20' })).toMatchObject({ ok: false });
    expect(gerarPlano({ totalCentavos: 100, numParcelas: 0, primeiroVencimento: '2026-07-20' })).toMatchObject({ ok: false });
    expect(gerarPlano({ totalCentavos: 100, numParcelas: 2, primeiroVencimento: '20/07/2026' })).toMatchObject({ ok: false });
    expect(gerarPlano({ numParcelas: 2, primeiroVencimento: '2026-07-20' })).toMatchObject({ ok: false });
  });
});

describe('hojeBRT', () => {
  it('vira o dia no fuso de Brasília, não em UTC', () => {
    // 01:00 UTC de 02/07 ainda é 22:00 de 01/07 em BRT.
    expect(hojeBRT(new Date('2026-07-02T01:00:00Z'))).toBe('2026-07-01');
    expect(hojeBRT(new Date('2026-07-02T12:00:00Z'))).toBe('2026-07-02');
  });
});

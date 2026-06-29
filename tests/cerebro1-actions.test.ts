import { describe, expect, it } from 'vitest';
import { ACTIONS_BY_NAME, isAffirmative, isNegative } from '../src/core/domain/cerebro1-actions';

const criar = ACTIONS_BY_NAME.criar_compromisso!;
const cadastrar = ACTIONS_BY_NAME.cadastrar_processo!;
const consultar = ACTIONS_BY_NAME.consultar_processo!;

describe('validação de ações', () => {
  it('criar_compromisso completo → ok, normaliza data e CNJ', () => {
    const r = criar.validate({
      tipo: 'audiencia',
      data_hora: '2026-07-02T14:00:00-03:00',
      descricao: 'Instrução',
      numero_cnj: '0001234-56.2024.8.26.0100',
    });
    expect(r.faltando).toEqual([]);
    expect(r.erro).toBeNull();
    expect(r.value.tipo).toBe('audiencia');
    expect(r.value.numeroCnj).toBe('00012345620248260100'); // 20 dígitos
    expect(typeof r.value.dataHora).toBe('string');
  });

  it('criar_compromisso sem data → faltando data_hora (pergunta só o que falta)', () => {
    const r = criar.validate({ tipo: 'audiencia', descricao: 'X' });
    expect(r.faltando).toContain('data_hora');
    expect(r.erro).toBeNull();
  });

  it('criar_compromisso com data inválida → erro (pede correção)', () => {
    const r = criar.validate({ tipo: 'reuniao', data_hora: 'amanhã sei lá', descricao: 'X' });
    expect(r.erro).toMatch(/data/i);
  });

  it('CNJ malformado → erro', () => {
    const r = cadastrar.validate({ numero_cnj: '123' });
    expect(r.erro).toMatch(/CNJ|20 dígitos/i);
  });

  it('cadastrar_processo vazio → erro pedindo ao menos um dado', () => {
    const r = cadastrar.validate({});
    expect(r.erro).toBeTruthy();
  });

  it('confirmText do cadastro é legível', () => {
    const r = cadastrar.validate({ cliente_nome: 'Maria', parte_contraria: 'Empresa X' });
    expect(cadastrar.confirmText!(r.value)).toContain('cliente Maria');
  });

  it('consultar_processo sem critério → erro', () => {
    expect(consultar.validate({}).erro).toBeTruthy();
  });
});

describe('afirmativo/negativo', () => {
  it('reconhece confirmação e cancelamento', () => {
    expect(isAffirmative('sim')).toBe(true);
    expect(isAffirmative('confirmar')).toBe(true);
    expect(isNegative('cancelar')).toBe(true);
    expect(isAffirmative('talvez')).toBe(false);
  });
});

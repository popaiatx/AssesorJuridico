import { describe, expect, it } from 'vitest';
import {
  advanceOnboarding,
  type OnboardingState,
} from '../src/core/domain/onboarding';

describe('advanceOnboarding (máquina de estados)', () => {
  it('primeiro contato → boas-vindas e pede o nome (não consome o texto)', () => {
    const out = advanceOnboarding(null, 'oi');
    expect(out.kind).toBe('continuar');
    if (out.kind !== 'continuar') return;
    expect(out.etapa).toBe('aguardando_nome');
    expect(out.evento).toBe('iniciado');
    expect(out.reply.toLowerCase()).toContain('nome');
  });

  it('fluxo completo até criar', () => {
    let state: OnboardingState = { etapa: 'aguardando_nome', dados: {} };

    let out = advanceOnboarding(state, 'Maria Silva');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_oab');
    if (out.kind !== 'continuar') throw new Error('x');
    state = { etapa: out.etapa, dados: out.dados };

    out = advanceOnboarding(state, '123456/SP');
    if (out.kind !== 'continuar') throw new Error('x');
    expect(out.etapa).toBe('aguardando_documento');
    state = { etapa: out.etapa, dados: out.dados };

    out = advanceOnboarding(state, '111.444.777-35');
    if (out.kind !== 'continuar') throw new Error('x');
    expect(out.etapa).toBe('aguardando_email');
    state = { etapa: out.etapa, dados: out.dados };

    out = advanceOnboarding(state, 'maria@adv.com');
    if (out.kind !== 'continuar') throw new Error('x');
    expect(out.etapa).toBe('aguardando_consentimento');
    expect(out.reply).toContain('ACEITO'); // consentimento explícito
    state = { etapa: out.etapa, dados: out.dados };

    out = advanceOnboarding(state, 'aceito');
    expect(out.kind).toBe('criar');
    if (out.kind !== 'criar') return;
    expect(out.dados).toEqual({
      nome: 'Maria Silva',
      oabNumero: '123456',
      oabSeccional: 'SP',
      documento: '11144477735',
      email: 'maria@adv.com',
    });
  });

  it('validação falha → permanece na etapa e re-explica (não pula)', () => {
    const state: OnboardingState = { etapa: 'aguardando_documento', dados: { nome: 'X' } };
    const out = advanceOnboarding(state, 'não é cpf');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_documento');
    if (out.kind !== 'continuar') return;
    expect(out.evento).toBe('documento_invalido');
  });

  it('consentimento sem aceite → permanece pedindo aceite', () => {
    const state: OnboardingState = {
      etapa: 'aguardando_consentimento',
      dados: { nome: 'X', oabNumero: '1', oabSeccional: 'SP', documento: '11144477735', email: 'a@b.com' },
    };
    const out = advanceOnboarding(state, 'talvez depois');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_consentimento');
    if (out.kind !== 'continuar') return;
    expect(out.evento).toBe('consentimento_pendente');
  });

  it('cancelar/recomeçar → volta ao início (R1)', () => {
    const state: OnboardingState = { etapa: 'aguardando_email', dados: { nome: 'X' } };
    const out = advanceOnboarding(state, 'cancelar');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_nome');
    if (out.kind !== 'continuar') return;
    expect(out.evento).toBe('reiniciado');
    expect(out.dados).toEqual({});
  });

  it('mensagem vazia (só mídia) → pede o dado em texto (R1)', () => {
    const state: OnboardingState = { etapa: 'aguardando_oab', dados: { nome: 'X' } };
    const out = advanceOnboarding(state, '');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_oab');
    if (out.kind !== 'continuar') return;
    expect(out.evento).toBe('sem_texto');
    expect(out.reply.toLowerCase()).toContain('texto');
  });

  it('retomada: continua de uma etapa intermediária arbitrária', () => {
    const state: OnboardingState = {
      etapa: 'aguardando_email',
      dados: { nome: 'X', oabNumero: '123456', oabSeccional: 'SP', documento: '11144477735' },
    };
    const out = advanceOnboarding(state, 'x@y.com');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_consentimento');
  });
});

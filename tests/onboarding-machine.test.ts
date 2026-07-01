import { describe, expect, it } from 'vitest';
import { advanceOnboarding, type OnboardingState } from '../src/core/domain/onboarding';

describe('advanceOnboarding (máquina enxuta: nome → e-mail → consentimento)', () => {
  it('primeiro contato → boas-vindas e pede o nome (não consome o texto)', () => {
    const out = advanceOnboarding(null, 'oi');
    expect(out.kind).toBe('continuar');
    if (out.kind !== 'continuar') return;
    expect(out.etapa).toBe('aguardando_nome');
    expect(out.evento).toBe('iniciado');
    expect(out.reply.toLowerCase()).toContain('3 dias'); // intro acolhedora menciona o trial
    expect(out.reply).toContain('estagiárIA'); // apresenta-se pelo nome, grafia oficial
  });

  it('fluxo completo até criar (sem OAB/documento)', () => {
    let state: OnboardingState = { etapa: 'aguardando_nome', dados: {} };

    let out = advanceOnboarding(state, 'Maria');
    if (out.kind !== 'continuar') throw new Error('x');
    expect(out.etapa).toBe('aguardando_email');
    state = { etapa: out.etapa, dados: out.dados };

    out = advanceOnboarding(state, 'maria@adv.com');
    if (out.kind !== 'continuar') throw new Error('x');
    expect(out.etapa).toBe('aguardando_consentimento');
    expect(out.reply).toContain('ACEITO');
    state = { etapa: out.etapa, dados: out.dados };

    out = advanceOnboarding(state, 'aceito');
    expect(out.kind).toBe('criar');
    if (out.kind !== 'criar') return;
    expect(out.dados).toEqual({ nome: 'Maria', email: 'maria@adv.com' });
  });

  it('e-mail inválido → permanece na etapa e re-explica', () => {
    const state: OnboardingState = { etapa: 'aguardando_email', dados: { nome: 'X' } };
    const out = advanceOnboarding(state, 'não é email');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_email');
    if (out.kind !== 'continuar') return;
    expect(out.evento).toBe('email_invalido');
  });

  it('consentimento sem aceite → continua pedindo aceite', () => {
    const state: OnboardingState = {
      etapa: 'aguardando_consentimento',
      dados: { nome: 'X', email: 'a@b.com' },
    };
    const out = advanceOnboarding(state, 'talvez');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_consentimento');
    if (out.kind !== 'continuar') return;
    expect(out.evento).toBe('consentimento_pendente');
  });

  it('cancelar/recomeçar → volta ao início (R1)', () => {
    const state: OnboardingState = { etapa: 'aguardando_email', dados: { nome: 'X' } };
    const out = advanceOnboarding(state, 'cancelar');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_nome');
    if (out.kind !== 'continuar') return;
    expect(out.dados).toEqual({});
  });

  it('mensagem vazia (só mídia) → pede o dado em texto (R1)', () => {
    const state: OnboardingState = { etapa: 'aguardando_email', dados: { nome: 'X' } };
    const out = advanceOnboarding(state, '');
    expect(out.kind === 'continuar' && out.etapa).toBe('aguardando_email');
    if (out.kind !== 'continuar') return;
    expect(out.evento).toBe('sem_texto');
    expect(out.reply.toLowerCase()).toContain('texto');
  });
});

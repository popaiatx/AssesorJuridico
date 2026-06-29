import { describe, expect, it } from 'vitest';
import { decideAccess } from '../src/core/domain/access';

const now = new Date('2026-06-29T12:00:00.000Z');
const futuro = new Date('2026-06-30T12:00:00.000Z');
const passado = new Date('2026-06-29T11:59:00.000Z'); // 1 min atrás

describe('decideAccess (fail-closed)', () => {
  it('assinatura ativa → libera', () => {
    expect(decideAccess({ status: 'ativa', trialFim: null }, now).allowed).toBe(true);
  });

  it('trial dentro do prazo → libera', () => {
    expect(decideAccess({ status: 'trial', trialFim: futuro }, now).allowed).toBe(true);
  });

  it('trial vencido por 1 minuto → bloqueia', () => {
    const d = decideAccess({ status: 'trial', trialFim: passado }, now);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('trial_expirado');
  });

  it('trial_fim nulo → bloqueia', () => {
    const d = decideAccess({ status: 'trial', trialFim: null }, now);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('trial_sem_data');
  });

  it('sem linha de assinatura → bloqueia', () => {
    expect(decideAccess(null, now)).toEqual({ allowed: false, reason: 'sem_assinatura' });
  });

  it('status inesperado → bloqueia', () => {
    expect(decideAccess({ status: 'qualquer_coisa', trialFim: null }, now).allowed).toBe(false);
  });

  it('aguardando_pagamento / inadimplente / suspensa → bloqueiam', () => {
    for (const status of ['aguardando_pagamento', 'inadimplente', 'suspensa', 'cancelada']) {
      expect(decideAccess({ status, trialFim: futuro }, now).allowed).toBe(false);
    }
  });
});

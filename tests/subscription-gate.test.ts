import { describe, expect, it } from 'vitest';
import { SupabaseSubscriptionGate } from '../src/adapters/subscription/supabase-subscription-gate';

const now = new Date('2026-06-29T12:00:00.000Z');
const futuro = new Date('2026-06-30T12:00:00.000Z');

describe('SupabaseSubscriptionGate (fail-closed na leitura)', () => {
  it('erro de leitura → bloqueia (não lança)', async () => {
    const gate = new SupabaseSubscriptionGate(() => Promise.reject(new Error('db caiu')));
    const d = await gate.evaluate('a', now);
    expect(d).toEqual({ allowed: false, reason: 'erro_leitura' });
  });

  it('sem linha → bloqueia', async () => {
    const gate = new SupabaseSubscriptionGate(() => Promise.resolve(null));
    expect((await gate.evaluate('a', now)).allowed).toBe(false);
  });

  it('trial dentro do prazo → libera', async () => {
    const gate = new SupabaseSubscriptionGate(() =>
      Promise.resolve({ status: 'trial', trialFim: futuro }),
    );
    expect((await gate.evaluate('a', now)).allowed).toBe(true);
  });

  it('ativa → libera', async () => {
    const gate = new SupabaseSubscriptionGate(() =>
      Promise.resolve({ status: 'ativa', trialFim: null }),
    );
    expect((await gate.evaluate('a', now)).allowed).toBe(true);
  });
});

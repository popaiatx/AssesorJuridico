import { describe, expect, it } from 'vitest';
import { deveInjetarContexto, montarConsulta } from '../src/core/domain/cerebro2/follow-up';
import type { RecentContext } from '../src/core/domain/conversation/memory';

const ctx = (fontes: string[]): RecentContext => ({
  turnos: [{ papel: 'assistant', intent: 'duvida_juridica', fontes, em: 't' }],
});
const comCPC = ctx(['art. 335 do CPC']);

describe('deveInjetarContexto (conservador: na dúvida, novo foco)', () => {
  it('follow-up anafórico curto → injeta', () => {
    expect(deveInjetarContexto('e o prazo dela?', comCPC)).toBe(true);
    expect(deveInjetarContexto('e o artigo seguinte?', comCPC)).toBe(true);
    expect(deveInjetarContexto('e sobre isso?', comCPC)).toBe(true);
  });

  it('ADVERSARIAL: começa com "e" mas nomeia outra lei → NÃO injeta (novo foco)', () => {
    expect(deveInjetarContexto('e na CLT, quanto é a multa do FGTS?', comCPC)).toBe(false);
    expect(deveInjetarContexto('e o art. 49 do CDC?', comCPC)).toBe(false);
    expect(deveInjetarContexto('qual o prazo na lei 8.213?', comCPC)).toBe(false);
  });

  it('sem memória / sem citações recentes → nunca injeta', () => {
    expect(deveInjetarContexto('e o prazo dela?', undefined)).toBe(false);
    expect(deveInjetarContexto('e o prazo dela?', ctx([]))).toBe(false);
  });

  it('pergunta longa e autônoma → novo foco', () => {
    expect(
      deveInjetarContexto('quais são os requisitos para usucapião extraordinária de imóvel rural?', comCPC),
    ).toBe(false);
  });
});

describe('montarConsulta (mensagem atual domina; contexto só desambigua)', () => {
  it('coloca a mensagem primeiro e anexa as citações recentes', () => {
    const q = montarConsulta('e o prazo dela?', comCPC);
    expect(q.startsWith('e o prazo dela?')).toBe(true);
    expect(q).toContain('art. 335 do CPC');
  });
});

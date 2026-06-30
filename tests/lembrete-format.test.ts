import { describe, expect, it } from 'vitest';
import { formatarQuando, montarMensagemLembrete } from '../src/core/domain/lembretes/format';
import type { DueReminder } from '../src/core/ports/reminders';

const TZ = 'America/Sao_Paulo';
// 2026-07-01T17:00:00Z == 14:00 em Brasília (BRT, -03:00).
const DATA = '2026-07-01T17:00:00.000Z';

const base: DueReminder = {
  assinanteId: 'A',
  telefone: '5511999990001',
  compromissoId: 'c1',
  lembreteEm: '2026-06-30T17:00:00.000Z',
  dataHora: DATA,
  tipo: 'audiencia',
  descricao: null,
  processoNumero: '0001234-55.2024.8.26.0100',
  clienteNome: 'Maria Silva',
};

describe('formatarQuando (fuso de Brasília + relativo)', () => {
  it('converte UTC→BRT: 17:00Z vira 14:00', () => {
    const now = new Date('2026-06-30T18:00:00Z');
    expect(formatarQuando(DATA, TZ, now)).toContain('14:00');
  });
  it('mesmo dia → "hoje"', () => {
    expect(formatarQuando(DATA, TZ, new Date('2026-07-01T10:00:00Z'))).toBe('hoje às 14:00');
  });
  it('dia seguinte → "amanhã"', () => {
    expect(formatarQuando(DATA, TZ, new Date('2026-06-30T12:00:00Z'))).toBe('amanhã às 14:00');
  });
  it('mais distante → "DD/MM"', () => {
    expect(formatarQuando(DATA, TZ, new Date('2026-06-20T12:00:00Z'))).toBe('01/07 às 14:00');
  });
});

describe('montarMensagemLembrete', () => {
  it('mensagem clara com tipo, processo, cliente, hora local e aviso automático', () => {
    const now = new Date('2026-06-30T12:00:00Z');
    const msg = montarMensagemLembrete(base, TZ, now);
    expect(msg).toContain('🔔 Lembrete');
    expect(msg).toContain('audiência');
    expect(msg).toContain('0001234-55.2024.8.26.0100');
    expect(msg).toContain('Maria Silva');
    expect(msg).toContain('amanhã às 14:00');
    expect(msg).toContain('aviso automático');
  });
  it('sem processo/cliente → omite sem quebrar', () => {
    const now = new Date('2026-06-30T12:00:00Z');
    const msg = montarMensagemLembrete(
      { ...base, processoNumero: null, clienteNome: null, tipo: 'reuniao' },
      TZ,
      now,
    );
    expect(msg).toContain('reunião');
    expect(msg).not.toContain('processo');
    expect(msg).not.toContain('cliente');
  });
});

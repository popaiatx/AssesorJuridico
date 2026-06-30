import { describe, expect, it } from 'vitest';
import { sendLembretes, type LembreteSender } from '../src/application/lembretes/send-lembretes';
import type { DueReminder, RemindersStore } from '../src/core/ports/reminders';

const TZ = 'America/Sao_Paulo';
const NOW = new Date('2026-06-30T18:00:00.000Z');

function reminder(over: Partial<DueReminder> = {}): DueReminder {
  return {
    assinanteId: 'A',
    telefone: '5511999990001',
    compromissoId: 'c1',
    lembreteEm: '2026-06-30T17:00:00.000Z',
    dataHora: '2026-07-01T17:00:00.000Z',
    tipo: 'audiencia',
    descricao: null,
    processoNumero: '0001234-55.2024.8.26.0100',
    clienteNome: 'Maria Silva',
    ...over,
  };
}

/** Store stateful: `due` exclui o que já foi marcado (espelha o SQL real). */
class FakeStore implements RemindersStore {
  marcados = new Set<string>();
  marcouCom: Array<{ id: string; em: string }> = [];
  constructor(private readonly itens: DueReminder[]) {}
  due(): Promise<DueReminder[]> {
    return Promise.resolve(this.itens.filter((r) => !this.marcados.has(`${r.compromissoId}|${r.lembreteEm}`)));
  }
  marcarEnviado(compromissoId: string, lembreteEmIso: string): Promise<boolean> {
    const k = `${compromissoId}|${lembreteEmIso}`;
    this.marcouCom.push({ id: compromissoId, em: lembreteEmIso });
    if (this.marcados.has(k)) return Promise.resolve(false);
    this.marcados.add(k);
    return Promise.resolve(true);
  }
}

class FakeSender implements LembreteSender {
  enviados: Array<{ telefone: string; mensagem: string }> = [];
  constructor(private readonly falharPara?: string) {}
  enviar(telefone: string, mensagem: string): Promise<void> {
    if (this.falharPara && telefone === this.falharPara) {
      return Promise.reject(new Error('WhatsApp 503'));
    }
    this.enviados.push({ telefone, mensagem });
    return Promise.resolve();
  }
}

const deps = (store: RemindersStore, sender: LembreteSender) => ({
  store,
  sender,
  now: () => NOW,
  timeZone: TZ,
  graceMin: 60,
});

describe('sendLembretes', () => {
  it('envia e MARCA após sucesso; conteúdo vai ao telefone do dono', async () => {
    const store = new FakeStore([reminder()]);
    const sender = new FakeSender();
    const r = await sendLembretes(deps(store, sender));
    expect(r.enviados).toBe(1);
    expect(sender.enviados[0]!.telefone).toBe('5511999990001');
    expect(sender.enviados[0]!.mensagem).toContain('Maria Silva');
    expect(store.marcouCom).toEqual([{ id: 'c1', em: '2026-06-30T17:00:00.000Z' }]);
  });

  it('rodar 2x = 1 envio por lembrete (idempotente)', async () => {
    const store = new FakeStore([reminder()]);
    const sender = new FakeSender();
    await sendLembretes(deps(store, sender));
    await sendLembretes(deps(store, sender)); // 2ª rodada: due já não retorna o marcado
    expect(sender.enviados).toHaveLength(1);
  });

  it('resiliência: falha em um não aborta os outros nem o marca', async () => {
    const store = new FakeStore([
      reminder({ compromissoId: 'c1', telefone: 'FALHA' }),
      reminder({ compromissoId: 'c2', telefone: '5511888880002', clienteNome: 'João' }),
    ]);
    const sender = new FakeSender('FALHA');
    const r = await sendLembretes(deps(store, sender));
    expect(r.status).toBe('parcial');
    expect(r.enviados).toBe(1);
    expect(r.falhas).toBe(1);
    expect(sender.enviados.map((e) => e.telefone)).toEqual(['5511888880002']);
    expect(store.marcouCom.map((m) => m.id)).toEqual(['c2']); // c1 (falhou) NÃO foi marcado
  });

  it('dry-run: NÃO envia, NÃO marca; lista o que enviaria (texto fiel)', async () => {
    const store = new FakeStore([reminder()]);
    const sender = new FakeSender();
    const r = await sendLembretes(deps(store, sender), { dryRun: true });
    expect(sender.enviados).toHaveLength(0);
    expect(store.marcouCom).toHaveLength(0); // não marca → pode rodar quantas vezes quiser
    expect(r.preview).toHaveLength(1);
    expect(r.preview[0]!.mensagem).toContain('🔔 Lembrete');
    expect(r.preview[0]!.mensagem).toContain('amanhã às 14:00');
  });
});

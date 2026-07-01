/**
 * Motor do lembrete de COBRANÇA (Passo 16): envia+marca-após-sucesso,
 * idempotência, resiliência por item, dry-run fiel, texto (hoje/em N dias/
 * venceu) e isolamento (o aviso vai só ao DONO da parcela).
 */
import { describe, expect, it } from 'vitest';
import { sendCobrancas } from '../src/application/lembretes/send-cobrancas';
import { montarMensagemCobranca } from '../src/core/domain/lembretes/cobranca-format';
import type { CobrancasStore, DueCobranca } from '../src/core/ports/reminders';

const NOW = new Date('2026-07-20T12:05:00Z'); // 09:05 BRT de 20/07

function due(over: Partial<DueCobranca> = {}): DueCobranca {
  return {
    assinanteId: 'A',
    telefone: '5511999990001',
    lancamentoId: 'l-1',
    lembreteEm: '2026-07-20T12:00:00.000Z',
    vencimento: '2026-07-20',
    valorDecimal: '1000.00',
    parcela: 3,
    totalParcelas: 10,
    descricao: null,
    processoNumero: '00012345620248260100',
    clienteNome: 'Gabriel Machado',
    ...over,
  };
}

/** Store fake que honra o contrato: due exclui as já marcadas. */
function fakeStore(itens: DueCobranca[]) {
  const marcadas = new Set<string>();
  const store: CobrancasStore = {
    due: () =>
      Promise.resolve(itens.filter((i) => !marcadas.has(`${i.lancamentoId}|${i.lembreteEm}`))),
    marcarEnviada: (id, em) => {
      const k = `${id}|${em}`;
      if (marcadas.has(k)) return Promise.resolve(false);
      marcadas.add(k);
      return Promise.resolve(true);
    },
  };
  return { store, marcadas };
}

describe('montarMensagemCobranca', () => {
  it('vence HOJE: exemplo do produto (parcela 3/10 do Gabriel)', () => {
    const msg = montarMensagemCobranca(due(), NOW);
    expect(msg).toContain('💰 Lembrete: parcela 3/10');
    expect(msg).toContain('processo 00012345620248260100');
    expect(msg).toContain('cliente Gabriel Machado');
    expect(msg).toContain('vence *hoje*');
    expect(msg).toContain('R$ 1.000,00');
    expect(msg).toContain('estagiárIA');
    expect(msg).toContain('só para você'); // NUNCA cobra o cliente final
  });
  it('em N dias / amanhã / venceu (antecipado configurável e atraso)', () => {
    expect(montarMensagemCobranca(due({ vencimento: '2026-07-23' }), NOW)).toContain('vence em 3 dias (23/07)');
    expect(montarMensagemCobranca(due({ vencimento: '2026-07-21' }), NOW)).toContain('vence *amanhã* (21/07)');
    expect(montarMensagemCobranca(due({ vencimento: '2026-07-18' }), NOW)).toContain('venceu há 2 dias (18/07)');
    expect(montarMensagemCobranca(due({ parcela: null, totalParcelas: null }), NOW)).toContain('parcela única');
  });
});

describe('sendCobrancas', () => {
  it('envia ao DONO e marca após sucesso; rodar 2x = 1 envio (idempotente)', async () => {
    const { store } = fakeStore([due()]);
    const enviados: Array<{ tel: string; msg: string }> = [];
    const sender = { enviar: (tel: string, msg: string) => (enviados.push({ tel, msg }), Promise.resolve()) };

    const r1 = await sendCobrancas({ store, sender, now: () => NOW });
    expect(r1.enviados).toBe(1);
    expect(enviados[0]!.tel).toBe('5511999990001'); // telefone do DONO (advogado)

    const r2 = await sendCobrancas({ store, sender, now: () => NOW });
    expect(r2.verificados).toBe(0); // já marcada → due não devolve mais
    expect(enviados).toHaveLength(1);
  });

  it('dry-run FIEL: mesma seleção/mensagem, NÃO envia e NÃO marca', async () => {
    const { store, marcadas } = fakeStore([due()]);
    let chamado = false;
    const sender = { enviar: () => ((chamado = true), Promise.resolve()) };
    const r = await sendCobrancas({ store, sender, now: () => NOW }, { dryRun: true });
    expect(r.preview).toHaveLength(1);
    expect(r.preview[0]!.mensagem).toContain('vence *hoje*');
    expect(chamado).toBe(false);
    expect(marcadas.size).toBe(0);
  });

  it('resiliência POR ITEM: falha de um não aborta os outros nem marca', async () => {
    const { store, marcadas } = fakeStore([due(), due({ lancamentoId: 'l-2', telefone: '5511999990002' })]);
    const sender = {
      enviar: (tel: string) =>
        tel === '5511999990001' ? Promise.reject(new Error('rede')) : Promise.resolve(),
    };
    const r = await sendCobrancas({ store, sender, now: () => NOW });
    expect(r.status).toBe('parcial');
    expect(r.enviados).toBe(1);
    expect(r.falhas).toBe(1);
    expect(marcadas.has('l-1|2026-07-20T12:00:00.000Z')).toBe(false); // falhou → re-tenta
    expect(marcadas.has('l-2|2026-07-20T12:00:00.000Z')).toBe(true);
  });

  it('ISOLAMENTO: cada aviso vai ao telefone do PRÓPRIO dono (A e B na mesma rodada)', async () => {
    const { store } = fakeStore([
      due({ assinanteId: 'A', telefone: '5511999990001', lancamentoId: 'l-a' }),
      due({ assinanteId: 'B', telefone: '5511999990002', lancamentoId: 'l-b', clienteNome: 'Cliente B' }),
    ]);
    const porTelefone = new Map<string, string[]>();
    const sender = {
      enviar: (tel: string, msg: string) => {
        porTelefone.set(tel, [...(porTelefone.get(tel) ?? []), msg]);
        return Promise.resolve();
      },
    };
    await sendCobrancas({ store, sender, now: () => NOW });
    expect(porTelefone.get('5511999990001')![0]).toContain('Gabriel Machado');
    expect(porTelefone.get('5511999990001')![0]).not.toContain('Cliente B');
    expect(porTelefone.get('5511999990002')![0]).toContain('Cliente B');
  });
});

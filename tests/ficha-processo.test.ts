import { describe, expect, it } from 'vitest';
import { FichaProcessoService } from '../src/application/cerebro1/ficha-processo';
import type { FichaBruta, FichaStore } from '../src/core/ports/ficha';

const AGORA = new Date('2026-07-01T12:00:00Z');

/**
 * Fake do FichaStore com DOIS tenants, honrando o contrato da query real:
 * só devolve a ficha se (assinanteId, processoId) casarem — posse re-verificada.
 * Registra as chamadas para as asserções de isolamento.
 */
function fakeStore(dados: Record<string, Record<string, FichaBruta>>) {
  const chamadas: Array<{ assinanteId: string; processoId: string }> = [];
  const store: FichaStore = {
    getFichaBruta: (assinanteId, processoId) => {
      chamadas.push({ assinanteId, processoId });
      return Promise.resolve(dados[assinanteId]?.[processoId] ?? null);
    },
  };
  return { store, chamadas };
}

function bruta(id: string, numero: string, marcador: string): FichaBruta {
  return {
    processo: {
      id,
      numeroCnj: numero,
      clienteNome: `Cliente ${marcador}`,
      parteContraria: null,
      vara: null,
      comarca: null,
      area: null,
      valorCausa: null,
      status: 'ativo',
      fase: null,
      instancia: null,
      segredoJustica: false,
    },
    compromissos: [
      { id: `c-${marcador}`, tipo: 'audiencia', dataHora: '2026-07-10T14:00:00Z', descricao: `aud ${marcador}` },
    ],
    documentos: [
      { id: `d-${marcador}`, nome: `doc-${marcador}.pdf`, extracaoStatus: 'ok', enviadoEm: '2026-06-01T00:00:00Z' },
    ],
    lancamentos: [
      { id: `l-${marcador}`, tipo: 'honorario', valor: '100.00', vencimento: null, status: 'pendente' },
    ],
  };
}

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';

describe('FichaProcessoService — agregação e isolamento (2 assinantes)', () => {
  // Cenário ADVERSARIAL: B tem processo de número SIMILAR (mesmo fragmento 12345)
  // com compromisso, documento e lançamento "parecidos" vinculados.
  const dados = {
    [A]: { 'proc-a': bruta('proc-a', '00012345620248260100', 'A') },
    [B]: { 'proc-b': bruta('proc-b', '00012345920248260100', 'B') },
  };

  it('monta a ficha inteira do próprio assinante', async () => {
    const { store } = fakeStore(dados);
    const svc = new FichaProcessoService({ store, clock: () => AGORA });
    const ficha = await svc.montarPorId(A, 'proc-a');
    expect(ficha).not.toBeNull();
    expect(ficha!.processo.clienteNome).toBe('Cliente A');
    expect(ficha!.agenda.futuros[0]!.descricao).toBe('aud A');
    expect(ficha!.documentos[0]!.nome).toBe('doc-A.pdf');
    expect(ficha!.financeiro.lancamentos[0]!.id).toBe('l-A');
  });

  it('A pedindo o processo de B por id → null (posse re-verificada); nada de B vaza', async () => {
    const { store, chamadas } = fakeStore(dados);
    const svc = new FichaProcessoService({ store, clock: () => AGORA });
    const ficha = await svc.montarPorId(A, 'proc-b'); // id REAL de B
    expect(ficha).toBeNull();
    // A identidade usada foi SEMPRE a de A — nunca a de B:
    expect(chamadas.every((c) => c.assinanteId === A)).toBe(true);
  });

  it('a ficha de A jamais contém compromisso/documento/lançamento de B', async () => {
    const { store } = fakeStore(dados);
    const svc = new FichaProcessoService({ store, clock: () => AGORA });
    const ficha = await svc.montarPorId(A, 'proc-a');
    const conteudo = JSON.stringify(ficha);
    expect(conteudo).not.toContain('B'); // nenhum marcador de B em nenhuma seção
    expect(conteudo).not.toContain('proc-b');
  });

  it('processo inexistente → null claro', async () => {
    const { store } = fakeStore(dados);
    const svc = new FichaProcessoService({ store, clock: () => AGORA });
    expect(await svc.montarPorId(A, 'nao-existe')).toBeNull();
  });
});

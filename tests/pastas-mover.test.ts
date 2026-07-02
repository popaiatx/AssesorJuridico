/**
 * Mover documento entre pastas + filtros por pasta (Passo 18): parser puro,
 * confirmação sempre, ordinal/contexto pela memória, exibição 📁/📂 na busca,
 * COERÊNCIA pós-mover e isolamento (destino re-verificado).
 */
import { describe, expect, it } from 'vitest';
import { DocumentSearchHandler } from '../src/application/documentos/document-search-handler';
import { BuscarDocumentos } from '../src/application/documentos/buscar-documentos';
import {
  ehPedidoMover,
  interpretarFiltroPasta,
  interpretarMover,
} from '../src/core/domain/documentos/pedido-mover';
import type {
  DocumentoPastaStore,
  DocumentoResultado,
  DocumentoRow,
  DocumentoSearchStore,
  ProcessoPastaRef,
} from '../src/core/ports/documentos';
import type {
  PendingAction,
  PendingActionStore,
  ProcessoRow,
  ProcessoSelector,
} from '../src/core/ports/cerebro1';
import type { MessageContext } from '../src/core/orchestration/handler';
import type { ConversationTurn } from '../src/core/ports/conversation-memory';
import { makeMessage } from './helpers';

// --- Parser puro ---
describe('pedido-mover (parser puro)', () => {
  it('detecta mover e extrai alvo + destino por processo', () => {
    const p = interpretarMover('move o contrato do gabriel para a pasta do processo 12345');
    expect(p).toEqual({
      alvo: { tipo: 'referencia', termo: 'contrato do gabriel' },
      destino: { tipo: 'processo', ref: '12345' },
    });
  });
  it('ordinal: "move o 2 para a pasta do Gabriel"', () => {
    const p = interpretarMover('move o 2 para a pasta do Gabriel');
    expect(p!.alvo).toEqual({ tipo: 'ordinal', indice: 2 });
    expect(p!.destino).toEqual({ tipo: 'processo', ref: 'gabriel' });
  });
  it('"tira o contrato da pasta" → avulso; "guarda na pasta dele" → contexto', () => {
    expect(interpretarMover('tira o contrato da pasta')!.destino).toEqual({ tipo: 'avulso' });
    expect(interpretarMover('guarda na pasta dele')!.destino).toEqual({ tipo: 'contexto' });
  });
  it('não confunde busca/resumo com mover', () => {
    expect(ehPedidoMover('acha o contrato do joão')).toBe(false);
    expect(ehPedidoMover('resume o segundo')).toBe(false);
  });
  it('filtros: "documentos avulsos" e "documentos do processo 12345"', () => {
    expect(interpretarFiltroPasta('documentos avulsos')).toEqual({ tipo: 'avulsos' });
    expect(interpretarFiltroPasta('quais os documentos do processo 12345?')).toEqual({ tipo: 'processo', ref: '12345' });
    expect(interpretarFiltroPasta('acha o contrato do joão')).toBeNull();
  });
});

// --- Fakes do fluxo ---
interface DocFake extends DocumentoRow {
  buscaTexto: string;
  processoNumero: string | null;
  processoClienteNome: string | null;
}
function docFake(over: Partial<DocFake> & { id: string; nome: string }): DocFake {
  return {
    tipo: 'application/pdf',
    storageRef: `A/${over.id}/arq.pdf`,
    processoId: null,
    chaves: null,
    resumo: null,
    extracaoStatus: 'ok',
    status: 'guardado',
    buscaTexto: over.nome,
    processoNumero: null,
    processoClienteNome: null,
    ...over,
  };
}

class Mundo {
  docs = new Map<string, DocFake[]>();
  procs = new Map<string, ProcessoPastaRef[]>();
  seedDoc(t: string, d: DocFake): void {
    const a = this.docs.get(t) ?? [];
    a.push(d);
    this.docs.set(t, a);
  }
  seedProc(t: string, p: ProcessoPastaRef): void {
    const a = this.procs.get(t) ?? [];
    a.push(p);
    this.procs.set(t, a);
  }
  private comPasta(t: string, d: DocFake): DocumentoResultado {
    const p = d.processoId ? (this.procs.get(t) ?? []).find((x) => x.id === d.processoId) : null;
    return { ...d, processoNumero: p?.numeroCnj ?? null, processoClienteNome: p?.clienteNome ?? null };
  }
  searchStore(): DocumentoSearchStore {
    return {
      buscarExato: (t, termos) =>
        Promise.resolve(
          (this.docs.get(t) ?? [])
            .filter((d) => termos.some((tk) => d.buscaTexto.includes(tk) || d.nome.includes(tk)))
            .map((d) => this.comPasta(t, d)),
        ),
      buscarSemantico: () => Promise.resolve([]),
      contarSemTexto: () => Promise.resolve(0),
    };
  }
  pastaStore(): DocumentoPastaStore {
    return {
      findProcessosPorNumeros: (t, nums) =>
        Promise.resolve((this.procs.get(t) ?? []).filter((p) => nums.some((n) => (p.numeroCnj ?? '').includes(n)))),
      getProcessoPastaById: (t, id) =>
        Promise.resolve((this.procs.get(t) ?? []).find((p) => p.id === id) ?? null),
      setProcessoId: (t, docId, processoId) => {
        const d = (this.docs.get(t) ?? []).find((x) => x.id === docId);
        if (!d) return Promise.resolve(false);
        d.processoId = processoId;
        return Promise.resolve(true);
      },
      listarPorPasta: (t, f) =>
        Promise.resolve(
          (this.docs.get(t) ?? [])
            .filter((d) => (f.avulsos ? d.processoId === null : d.processoId === f.processoId))
            .map((d) => this.comPasta(t, d)),
        ),
    };
  }
  findProcessos(t: string, sel: ProcessoSelector): Promise<ProcessoRow[]> {
    return Promise.resolve(
      (this.procs.get(t) ?? [])
        .filter(
          (p) =>
            (!sel.numeroCnj || p.numeroCnj === sel.numeroCnj) &&
            (!sel.numeroFragmento || (p.numeroCnj ?? '').includes(sel.numeroFragmento)) &&
            (!sel.clienteNome || (p.clienteNome ?? '').toLowerCase().includes(sel.clienteNome.toLowerCase())),
        )
        .map((p) => ({ id: p.id, numeroCnj: p.numeroCnj, clienteNome: p.clienteNome, parteContraria: null, area: null, status: 'ativo' })),
    );
  }
  getDocumento(t: string, id: string): Promise<DocumentoRow | null> {
    return Promise.resolve((this.docs.get(t) ?? []).find((d) => d.id === id) ?? null);
  }
}

class InMemoryPending implements PendingActionStore {
  m = new Map<string, PendingAction>();
  get(id: string) {
    return Promise.resolve(this.m.get(id) ?? null);
  }
  save(id: string, p: PendingAction) {
    this.m.set(id, p);
    return Promise.resolve();
  }
  clear(id: string) {
    this.m.delete(id);
    return Promise.resolve();
  }
}

const storageFake = {
  putDocument: () => Promise.reject(new Error('n/a')),
  getDocument: () => Promise.reject(new Error('n/a')),
  getSignedUrl: (ref: string) => Promise.resolve(`https://signed/${ref}`),
  deleteDocument: () => Promise.resolve(),
};
const resumoFake = { resumirPorId: () => Promise.resolve('RESUMO') };

const PROC_G: ProcessoPastaRef = { id: 'proc-g', numeroCnj: '00012345620248260100', clienteNome: 'Gabriel Machado' };

function build(mundo: Mundo) {
  const pending = new InMemoryPending();
  const busca = new BuscarDocumentos({
    store: mundo.searchStore(),
    topN: 5,
    minSimilarity: 0.3,
    logger: { error: () => {} },
  });
  const handler = new DocumentSearchHandler({
    busca,
    resumo: resumoFake,
    storage: storageFake,
    urlTtlSec: 300,
    pastas: {
      store: mundo.pastaStore(),
      pending,
      getDocumento: (t, id) => mundo.getDocumento(t, id),
      findProcessos: (t, sel) => mundo.findProcessos(t, sel),
    },
  });
  return { handler, pending, mundo };
}

function ctxDe(texto: string, turnos: ConversationTurn[] = [], assinanteId = 'A'): MessageContext {
  return {
    assinanteId,
    intent: 'documento',
    message: makeMessage(texto),
    ...(turnos.length > 0 ? { recentContext: { turnos } } : {}),
  };
}

describe('mover documento (Passo 18)', () => {
  it('por nome → CONFIRMAÇÃO mostrando doc real e pasta destino; pendência salva', async () => {
    const mundo = new Mundo();
    mundo.seedDoc('A', docFake({ id: 'd1', nome: 'contrato-gabriel.pdf', buscaTexto: 'contrato gabriel' }));
    mundo.seedProc('A', PROC_G);
    const { handler, pending } = build(mundo);
    const r = await handler.handle(ctxDe('move o contrato do gabriel para a pasta do processo 12345'));
    expect(r.replyText).toContain('Movo *contrato-gabriel.pdf*');
    expect(r.replyText).toContain('📁 pasta do processo 00012345620248260100 (cliente Gabriel Machado)');
    expect(r.replyText).toContain('SIM');
    expect((await pending.get('A'))).toMatchObject({
      acao: 'mover_documento',
      params: { docId: 'd1', processoId: 'proc-g' },
    });
  });

  it('por ORDINAL da última busca (memória) + destino por cliente', async () => {
    const mundo = new Mundo();
    mundo.seedDoc('A', docFake({ id: 'd1', nome: 'a.pdf' }));
    mundo.seedDoc('A', docFake({ id: 'd2', nome: 'b.pdf' }));
    mundo.seedProc('A', PROC_G);
    const { handler, pending } = build(mundo);
    const turnos: ConversationTurn[] = [{ papel: 'assistant', docIds: ['d1', 'd2'], em: 'x' }];
    const r = await handler.handle(ctxDe('move o 2 para a pasta do Gabriel', turnos));
    expect(r.replyText).toContain('Movo *b.pdf*');
    expect((await pending.get('A'))!.params.docId).toBe('d2');
  });

  it('"guarda na pasta dele" resolve pelo ÚLTIMO processo consultado (ficha na memória)', async () => {
    const mundo = new Mundo();
    mundo.seedDoc('A', docFake({ id: 'd1', nome: 'contrato.pdf', buscaTexto: 'contrato' }));
    mundo.seedProc('A', PROC_G);
    const { handler, pending } = build(mundo);
    const turnos: ConversationTurn[] = [{ papel: 'assistant', processoIds: ['proc-g'], em: 'x' }];
    const r = await handler.handle(ctxDe('guarda o contrato na pasta dele', turnos));
    expect(r.replyText).toContain('Gabriel Machado');
    expect((await pending.get('A'))!.params.processoId).toBe('proc-g');
  });

  it('"tira da pasta" → confirmação para avulso; sem memória p/ "dele" → pede especificar', async () => {
    const mundo = new Mundo();
    mundo.seedDoc('A', docFake({ id: 'd1', nome: 'contrato.pdf', buscaTexto: 'contrato', processoId: 'proc-g' }));
    mundo.seedProc('A', PROC_G);
    const { handler } = build(mundo);
    const r1 = await handler.handle(ctxDe('tira o contrato da pasta'));
    expect(r1.replyText).toContain('📂 avulso');
    const r2 = await handler.handle(ctxDe('guarda o contrato na pasta dele'));
    expect(r2.replyText).toContain('Pasta de quem?');
  });

  it('busca exibe a PASTA: 📁 com processo/cliente e 📂 avulso', async () => {
    const mundo = new Mundo();
    mundo.seedDoc('A', docFake({ id: 'd1', nome: 'contrato.pdf', buscaTexto: 'contrato', processoId: 'proc-g' }));
    mundo.seedDoc('A', docFake({ id: 'd2', nome: 'procuracao.pdf', buscaTexto: 'contrato procuracao' }));
    mundo.seedProc('A', PROC_G);
    const { handler } = build(mundo);
    const r = await handler.handle(ctxDe('acha contrato'));
    expect(r.replyText).toContain('📁 processo 00012345620248260100 (Gabriel Machado)');
    expect(r.replyText).toContain('📂 avulso');
  });

  it('COERÊNCIA pós-mover: entra na pasta nova, sai dos avulsos', async () => {
    const mundo = new Mundo();
    mundo.seedDoc('A', docFake({ id: 'd1', nome: 'contrato.pdf', buscaTexto: 'contrato' }));
    mundo.seedProc('A', PROC_G);
    const { handler } = build(mundo);

    const antes = await handler.handle(ctxDe('documentos avulsos'));
    expect(antes.replyText).toContain('contrato.pdf');

    // (execução do mover = setProcessoId, provada no fluxo de sugestão; aqui aplicamos direto)
    await mundo.pastaStore().setProcessoId('A', 'd1', 'proc-g');

    const avulsos = await handler.handle(ctxDe('documentos avulsos'));
    expect(avulsos.replyText).not.toContain('contrato.pdf');
    const daPasta = await handler.handle(ctxDe('documentos do processo 12345'));
    expect(daPasta.replyText).toContain('contrato.pdf');
    expect(daPasta.replyText).toContain('📁 Documentos do processo 00012345620248260100');
  });

  it('ISOLAMENTO: destino que só existe em B → "não encontrei"; "dele" com processo de B na memória forjada → posse re-verificada', async () => {
    const mundo = new Mundo();
    mundo.seedDoc('A', docFake({ id: 'd1', nome: 'contrato.pdf', buscaTexto: 'contrato' }));
    mundo.seedProc('B', { id: 'proc-b', numeroCnj: '00099999920248260100', clienteNome: 'Cliente B' });
    const { handler, pending } = build(mundo);

    const r1 = await handler.handle(ctxDe('move o contrato para a pasta do processo 99999'));
    expect(r1.replyText).toContain('Não encontrei esse processo');

    // memória FORJADA apontando para processo de B:
    const turnos: ConversationTurn[] = [{ papel: 'assistant', processoIds: ['proc-b'], em: 'x' }];
    const r2 = await handler.handle(ctxDe('guarda o contrato na pasta dele', turnos));
    expect(r2.replyText).toContain('Não encontrei mais esse processo');
    expect(await pending.get('A')).toBeNull();
  });
});

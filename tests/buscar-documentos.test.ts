import { describe, expect, it } from 'vitest';
import { tokensDeBusca } from '../src/core/domain/documentos/busca';
import { BuscarDocumentos } from '../src/application/documentos/buscar-documentos';
import { DocumentSearchHandler } from '../src/application/documentos/document-search-handler';
import type {
  DocumentoResultado,
  DocumentoSearchStore,
} from '../src/core/ports/documentos';
import type { EmbeddingsPort } from '../src/core/ports/embeddings';
import type { MessageContext } from '../src/core/orchestration/handler';
import type { PutDocumentInput, StoragePort } from '../src/core/ports/storage';

// --- tokensDeBusca (puro) ---
describe('tokensDeBusca', () => {
  it('remove comando/artigo/preposição e mantém palavras de conteúdo', () => {
    expect(tokensDeBusca('acha aquele contrato de aluguel do João')).toEqual([
      'contrato',
      'aluguel',
      'joão',
    ]);
  });
  it('mantém fragmentos numéricos (protocolo)', () => {
    expect(tokensDeBusca('protocolo 5551')).toEqual(['protocolo', '5551']);
  });
  it('só número → só o número', () => {
    expect(tokensDeBusca('9999')).toEqual(['9999']);
  });
  it('só stopwords → vazio', () => {
    expect(tokensDeBusca('aquele que')).toEqual([]);
  });
});

// --- Fakes que MODELAM o escopo por tenant da query (where assinante_id) ---
interface DocSeed extends DocumentoResultado {
  assinanteId: string;
  buscaTexto: string;
  vetor: number[];
  status: string;
  extracaoStatus: 'ok' | 'sem_texto' | 'falha';
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!;
  return s;
}

class FakeSearchStore implements DocumentoSearchStore {
  exatoCalls: string[] = [];
  semanticoCalls: string[] = [];
  contarCalls: string[] = [];
  constructor(private readonly docs: DocSeed[]) {}

  // Espelha o SQL: filtra por assinante_id ANTES do ILIKE.
  buscarExato(assinanteId: string, termos: string[], limite: number): Promise<DocumentoResultado[]> {
    this.exatoCalls.push(assinanteId);
    const r = this.docs
      .filter((d) => d.assinanteId === assinanteId && d.status === 'guardado')
      .map((d) => ({
        d,
        score: termos.filter(
          (t) =>
            d.buscaTexto.toLowerCase().includes(t.toLowerCase()) ||
            d.nome.toLowerCase().includes(t.toLowerCase()),
        ).length,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limite)
      .map((x) => strip(x.d));
    return Promise.resolve(r);
  }

  // Espelha o SQL: filtra por assinante_id ANTES do operador vetorial.
  buscarSemantico(assinanteId: string, embedding: number[], limite: number): Promise<DocumentoResultado[]> {
    this.semanticoCalls.push(assinanteId);
    const r = this.docs
      .filter(
        (d) => d.assinanteId === assinanteId && d.status === 'guardado' && d.extracaoStatus === 'ok',
      )
      .map((d) => ({ d, sim: dot(embedding, d.vetor) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limite)
      .map((x) => ({ ...strip(x.d), similarity: x.sim }));
    return Promise.resolve(r);
  }

  contarSemTexto(assinanteId: string): Promise<number> {
    this.contarCalls.push(assinanteId);
    return Promise.resolve(
      this.docs.filter(
        (d) => d.assinanteId === assinanteId && d.status === 'guardado' && d.extracaoStatus === 'sem_texto',
      ).length,
    );
  }
}

function strip(d: DocSeed): DocumentoResultado {
  return {
    id: d.id, nome: d.nome, tipo: d.tipo, storageRef: d.storageRef, processoId: d.processoId,
    chaves: d.chaves, resumo: d.resumo, extracaoStatus: d.extracaoStatus, status: d.status,
  };
}

// Embeddings fake: devolve um vetor fixo pela referência (configurável) ou falha.
class FakeEmbeddings implements EmbeddingsPort {
  constructor(private readonly vetor: number[] | 'falha' = [1, 0, 0]) {}
  embed(texts: string[]): Promise<number[][]> {
    if (this.vetor === 'falha') return Promise.reject(new Error('API fora'));
    return Promise.resolve(texts.map(() => this.vetor as number[]));
  }
}

function doc(over: Partial<DocSeed> & { id: string; assinanteId: string }): DocSeed {
  return {
    nome: 'arq.pdf', tipo: 'application/pdf', storageRef: `${over.assinanteId}/${over.id}/arq.pdf`,
    processoId: null, chaves: null, resumo: null, extracaoStatus: 'ok', status: 'guardado',
    buscaTexto: '', vetor: [0, 0, 0],
    ...over,
  };
}

describe('BuscarDocumentos — combinação e Top N', () => {
  it('prioriza a exata, deduplica e respeita o Top N', async () => {
    const docs = [
      doc({ id: 'd1', assinanteId: 'A', nome: 'contrato.pdf', buscaTexto: 'contrato de aluguel joão', vetor: [0.9, 0.1, 0] }),
      doc({ id: 'd2', assinanteId: 'A', nome: 'peticao.pdf', buscaTexto: 'peticao trabalhista', vetor: [1, 0, 0] }),
      doc({ id: 'd3', assinanteId: 'A', nome: 'recibo.pdf', buscaTexto: 'recibo pagamento', vetor: [0, 1, 0] }),
    ];
    const store = new FakeSearchStore(docs);
    const busca = new BuscarDocumentos({ store, embeddings: new FakeEmbeddings([1, 0, 0]), topN: 2, minSimilarity: 0.3, logger: { error: () => {} } });
    const r = await busca.buscar('A', 'contrato de aluguel');
    // exato casa d1 (contrato/aluguel); semântico traz d2 (vetor==query) — d1 primeiro
    expect(r.documentos.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(r.documentos).toHaveLength(2); // Top N respeitado
  });

  it('sem embeddings: só a busca exata', async () => {
    const docs = [doc({ id: 'd1', assinanteId: 'A', nome: 'contrato.pdf', buscaTexto: 'contrato aluguel', vetor: [1, 0, 0] })];
    const store = new FakeSearchStore(docs);
    const busca = new BuscarDocumentos({ store, topN: 5, minSimilarity: 0.3, logger: { error: () => {} } });
    const r = await busca.buscar('A', 'aluguel');
    expect(r.documentos.map((d) => d.id)).toEqual(['d1']);
    expect(store.semanticoCalls).toHaveLength(0);
  });

  it('falha do provider de embeddings: cai para só a exata (sem quebrar)', async () => {
    const docs = [doc({ id: 'd1', assinanteId: 'A', nome: 'contrato.pdf', buscaTexto: 'contrato aluguel', vetor: [1, 0, 0] })];
    const store = new FakeSearchStore(docs);
    const busca = new BuscarDocumentos({ store, embeddings: new FakeEmbeddings('falha'), topN: 5, minSimilarity: 0.3, logger: { error: () => {} } });
    const r = await busca.buscar('A', 'aluguel');
    expect(r.documentos.map((d) => d.id)).toEqual(['d1']);
  });
});

describe('BuscarDocumentos — ISOLAMENTO por tenant (2 assinantes)', () => {
  // A e B têm contratos de aluguel parecidos; o de B é o vetor MAIS próximo da query.
  const docs = [
    doc({ id: 'a1', assinanteId: 'A', nome: 'contrato-a.pdf', buscaTexto: 'contrato de aluguel joão protocolo 5551', vetor: [0.9, 0.1, 0] }),
    doc({ id: 'a2', assinanteId: 'A', nome: 'scan-a.pdf', buscaTexto: '', vetor: [0, 0, 0], extracaoStatus: 'sem_texto' }),
    doc({ id: 'b1', assinanteId: 'B', nome: 'contrato-b.pdf', buscaTexto: 'contrato de aluguel pedro protocolo 9999', vetor: [1, 0, 0] }),
    doc({ id: 'b2', assinanteId: 'B', nome: 'scan-b.pdf', buscaTexto: '', vetor: [0, 0, 0], extracaoStatus: 'sem_texto' }),
  ];

  it('A busca "aluguel": traz só o de A, nunca o de B (nem sendo o + próximo)', async () => {
    const store = new FakeSearchStore(docs);
    const busca = new BuscarDocumentos({ store, embeddings: new FakeEmbeddings([1, 0, 0]), topN: 5, minSimilarity: 0.3, logger: { error: () => {} } });
    const r = await busca.buscar('A', 'contrato de aluguel');
    expect(r.documentos.map((d) => d.id)).toEqual(['a1']); // b1 ausente apesar de vetor == query
    expect(r.documentos.some((d) => d.id === 'b1')).toBe(false);
    // Toda chamada ao store usou a identidade A — nunca B
    expect(store.exatoCalls.every((x) => x === 'A')).toBe(true);
    expect(store.semanticoCalls.every((x) => x === 'A')).toBe(true);
    expect(store.contarCalls.every((x) => x === 'A')).toBe(true);
  });

  it('A busca o número que SÓ existe em B (9999): vazio', async () => {
    const store = new FakeSearchStore(docs);
    const busca = new BuscarDocumentos({ store, embeddings: new FakeEmbeddings([0, 0, 1]), topN: 5, minSimilarity: 0.3, logger: { error: () => {} } });
    const r = await busca.buscar('A', '9999'); // 5551 é de A; 9999 só de B
    expect(r.documentos).toHaveLength(0);
  });

  it('contagem de ponto cego conta só os de A', async () => {
    const store = new FakeSearchStore(docs);
    const busca = new BuscarDocumentos({ store, topN: 5, minSimilarity: 0.3, logger: { error: () => {} } });
    const r = await busca.buscar('A', 'qualquer');
    expect(r.semTexto).toBe(1); // só scan-a; scan-b (de B) não conta
  });
});

// --- Handler: formatação, nada, ponto cego, URL só do dono ---
class FakeStorage implements StoragePort {
  signCalls: string[] = [];
  putDocument(_i: PutDocumentInput): Promise<{ storageRef: string }> {
    return Promise.resolve({ storageRef: 'x' });
  }
  getDocument(): Promise<Uint8Array> {
    return Promise.reject(new Error('não deve ser chamado'));
  }
  getSignedUrl(ref: string): Promise<string> {
    this.signCalls.push(ref);
    return Promise.resolve(`https://signed/${ref}`);
  }
  deleteDocument(): Promise<void> {
    return Promise.resolve();
  }
}

// Resumidor fake: registra as chamadas e devolve um texto marcado com o id/pedido.
class FakeResumo {
  calls: Array<{ id: string; pedido?: { modo?: string; foco?: string } }> = [];
  resumirPorId(_assinante: string, id: string, pedido?: { modo?: string; foco?: string }): Promise<string> {
    this.calls.push({ id, ...(pedido ? { pedido } : {}) });
    return Promise.resolve(`RESUMO[${id}]${pedido?.foco ? ` foco=${pedido.foco}` : ''}`);
  }
}

function ctxDe(
  assinanteId: string | null,
  text: string,
  docIds?: string[],
): MessageContext {
  const base: MessageContext = {
    assinanteId,
    intent: 'documento',
    message: { messageId: 'm1', from: '551199', text, timestamp: '2026-01-01T00:00:00Z' },
  };
  // Simula a memória: última lista de documentos exibida (turno do assistente).
  if (docIds) {
    return { ...base, recentContext: { turnos: [{ papel: 'assistant', intent: 'documento', docIds, em: '2026-01-01T00:00:00Z' }] } };
  }
  return base;
}

describe('DocumentSearchHandler', () => {
  const docs = [
    doc({ id: 'a1', assinanteId: 'A', nome: 'contrato-a.pdf', buscaTexto: 'contrato aluguel joão', vetor: [1, 0, 0], chaves: { tipo: 'contrato', partes: ['João'], numeros: [], datas: [], assunto: 'locação', resumoCurto: '' } }),
    doc({ id: 'a2', assinanteId: 'A', nome: 'scan-a.pdf', buscaTexto: '', vetor: [0, 0, 0], extracaoStatus: 'sem_texto' }),
    doc({ id: 'b1', assinanteId: 'B', nome: 'contrato-b.pdf', buscaTexto: 'contrato aluguel pedro', vetor: [1, 0, 0] }),
  ];

  function build(emb: number[] = [1, 0, 0]) {
    const store = new FakeSearchStore(docs);
    const storage = new FakeStorage();
    const resumo = new FakeResumo();
    const busca = new BuscarDocumentos({ store, embeddings: new FakeEmbeddings(emb), topN: 5, minSimilarity: 0.3, logger: { error: () => {} } });
    return { handler: new DocumentSearchHandler({ busca, resumo, storage, urlTtlSec: 300 }), storage, resumo };
  }

  it('lista o doc de A com link assinado e avisa o ponto cego; nunca assina o de B', async () => {
    const { handler, storage } = build();
    const r = await handler.handle(ctxDe('A', 'acha o contrato de aluguel'));
    expect(r.replyText).toContain('contrato-a.pdf');
    expect(r.replyText).toContain('https://signed/A/a1/arq.pdf');
    expect(r.replyText.toLowerCase()).toContain('escaneado'); // aviso de ponto cego (scan-a)
    expect(r.cerebro).toBe('dados');
    // URL assinada SÓ para o doc do dono; nunca para o storage_ref de B
    expect(storage.signCalls).toEqual(['A/a1/arq.pdf']);
    expect(storage.signCalls.some((ref) => ref.includes('b1'))).toBe(false);
  });

  it('nada encontrado: mensagem honesta (e ainda avisa ponto cego)', async () => {
    const { handler } = build([0, 0, 1]); // referência ortogonal a a1 → semântica abaixo do piso
    const r = await handler.handle(ctxDe('A', 'mandado de seguranca tributario'));
    expect(r.replyText.toLowerCase()).toContain('não achei');
    expect(r.replyText.toLowerCase()).toContain('escaneado'); // ainda avisa o ponto cego
  });

  it('sem identidade: não busca', async () => {
    const { handler, storage } = build();
    const r = await handler.handle(ctxDe(null, 'contrato'));
    expect(r.replyText.toLowerCase()).toContain('identificar');
    expect(storage.signCalls).toHaveLength(0);
  });

  // --- 12C: resumir ---
  it('busca devolve documentosListados (ordem) para o "resume o N" seguinte', async () => {
    const { handler } = build();
    const r = await handler.handle(ctxDe('A', 'acha o contrato de aluguel'));
    expect(r.documentosListados).toEqual(['a1']); // só o de A
  });

  it('"resume o segundo" resolve pela lista da última busca (memória)', async () => {
    const { handler, resumo } = build();
    const r = await handler.handle(ctxDe('A', 'resume o segundo', ['x1', 'x2', 'x3']));
    expect(resumo.calls.map((c) => c.id)).toEqual(['x2']);
    expect(r.replyText).toContain('RESUMO[x2]');
  });

  it('"resume o segundo" SEM lista recente: não adivinha, pede para buscar', async () => {
    const { handler, resumo } = build();
    const r = await handler.handle(ctxDe('A', 'resume o segundo')); // sem memória
    expect(resumo.calls).toHaveLength(0);
    expect(r.replyText.toLowerCase()).toContain('busque primeiro');
  });

  it('"resume o contrato ... focando nos prazos": modo novo + foco, doc único', async () => {
    const { handler, resumo } = build();
    const r = await handler.handle(ctxDe('A', 'resume o contrato focando nos prazos'));
    expect(resumo.calls).toHaveLength(1);
    expect(resumo.calls[0]!.id).toBe('a1');
    expect(resumo.calls[0]!.pedido?.foco).toBe('prazos');
    expect(r.replyText).toContain('foco=prazos');
  });

  it('resumir referência que não casa nada: mensagem clara, sem resumir', async () => {
    const { handler, resumo } = build([0, 0, 1]); // semântica fora do piso
    const r = await handler.handle(ctxDe('A', 'resume o do gabriel'));
    expect(resumo.calls).toHaveLength(0);
    expect(r.replyText.toLowerCase()).toContain('não achei');
  });

  it('resumir referência que casa VÁRIOS: desambigua numerado e guarda a ordem', async () => {
    const many = [
      doc({ id: 'a1', assinanteId: 'A', nome: 'contrato-1.pdf', buscaTexto: 'contrato de aluguel joao', vetor: [0, 0, 0] }),
      doc({ id: 'a3', assinanteId: 'A', nome: 'contrato-2.pdf', buscaTexto: 'contrato de aluguel maria', vetor: [0, 0, 0] }),
    ];
    const busca = new BuscarDocumentos({ store: new FakeSearchStore(many), topN: 5, minSimilarity: 0.3, logger: { error: () => {} } });
    const resumo = new FakeResumo();
    const handler = new DocumentSearchHandler({ busca, resumo, storage: new FakeStorage(), urlTtlSec: 300 });
    const r = await handler.handle(ctxDe('A', 'resume o contrato de aluguel'));
    expect(r.replyText.toLowerCase()).toContain('qual');
    expect(r.documentosListados).toEqual(['a1', 'a3']);
    expect(resumo.calls).toHaveLength(0); // ainda não resumiu
  });

  it('ISOLAMENTO: ordinal nunca resolve para doc de B (lista da memória é só de A)', async () => {
    const { handler, resumo } = build();
    // A memória de A só teria ids de A; ainda assim o serviço re-verifica posse.
    await handler.handle(ctxDe('A', 'resume o primeiro', ['a1']));
    expect(resumo.calls.map((c) => c.id)).toEqual(['a1']); // nunca um id de B
  });
});

import { describe, expect, it } from 'vitest';
import { ResumirDocumento } from '../src/application/documentos/resumir-documento';
import type { ExtracaoResultado } from '../src/adapters/documentos/extractors';
import type { DocumentoResumoStore, DocumentoRow } from '../src/core/ports/documentos';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';
import type { StoragePort, PutDocumentInput } from '../src/core/ports/storage';

// --- Fakes ---
function rowDe(over: Partial<DocumentoRow> & { id: string }): DocumentoRow {
  return {
    id: over.id, nome: over.nome ?? 'doc.pdf', tipo: over.tipo ?? 'application/pdf',
    storageRef: over.storageRef ?? `A/${over.id}/doc.pdf`, processoId: null,
    chaves: over.chaves ?? null, resumo: over.resumo ?? null,
    extracaoStatus: over.extracaoStatus ?? 'ok', status: over.status ?? 'guardado',
  };
}

class FakeResumoStore implements DocumentoResumoStore {
  setCalls: Array<{ assinante: string; id: string; resumo: string }> = [];
  constructor(private readonly docs: Record<string, Record<string, DocumentoRow>>) {} // [tenant][id]
  getById(assinanteId: string, id: string): Promise<DocumentoRow | null> {
    return Promise.resolve(this.docs[assinanteId]?.[id] ?? null); // espelha o RLS por tenant
  }
  setResumo(assinanteId: string, id: string, resumo: string): Promise<boolean> {
    this.setCalls.push({ assinante: assinanteId, id, resumo });
    const d = this.docs[assinanteId]?.[id];
    if (!d) return Promise.resolve(false);
    d.resumo = resumo;
    return Promise.resolve(true);
  }
}

class FakeStorage implements StoragePort {
  getCalls: string[] = [];
  constructor(private readonly bytesPorRef: Record<string, Uint8Array> = {}) {}
  putDocument(_i: PutDocumentInput): Promise<{ storageRef: string }> {
    return Promise.resolve({ storageRef: 'x' });
  }
  getDocument(ref: string): Promise<Uint8Array> {
    this.getCalls.push(ref);
    const b = this.bytesPorRef[ref];
    return b ? Promise.resolve(b) : Promise.reject(new Error('not found'));
  }
  getSignedUrl(ref: string): Promise<string> {
    return Promise.resolve(`https://signed/${ref}`);
  }
  deleteDocument(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeLlm implements LlmPort {
  systems: string[] = [];
  generate(p: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.systems.push(p.system ?? '');
    return Promise.resolve({ text: 'RESUMO NOVO GERADO', toolCalls: [], stopReason: 'end_turn' });
  }
}

const extOk = (): Promise<ExtracaoResultado> =>
  Promise.resolve({ texto: 'Texto integral do documento, com prazos e valores.', status: 'ok', formato: 'pdf' });

function build(docs: Record<string, Record<string, DocumentoRow>>, bytes: Record<string, Uint8Array> = {}, ext = extOk) {
  const store = new FakeResumoStore(docs);
  const storage = new FakeStorage(bytes);
  const llm = new FakeLlm();
  const service = new ResumirDocumento({ store, storage, llm, extrair: ext, logger: { error: () => {} } });
  return { service, store, storage, llm };
}

describe('ResumirDocumento — PADRÃO (resumo guardado)', () => {
  it('devolve o resumo salvo, com aviso, SEM LLM e SEM ler Storage', async () => {
    const { service, storage, llm } = build({
      A: { d1: rowDe({ id: 'd1', resumo: 'Resumo guardado do contrato.' }) },
    });
    const r = await service.resumirPorId('A', 'd1');
    expect(r).toContain('Resumo guardado do contrato.');
    expect(r).toContain('Resumo de apoio'); // disclaimer
    expect(llm.systems).toHaveLength(0); // não chamou LLM
    expect(storage.getCalls).toHaveLength(0); // não releu o arquivo
  });

  it('doc ok SEM resumo: gera relendo o Storage e PERSISTE', async () => {
    const { service, store, storage, llm } = build(
      { A: { d1: rowDe({ id: 'd1', resumo: null, storageRef: 'A/d1/doc.pdf' }) } },
      { 'A/d1/doc.pdf': new TextEncoder().encode('PDF') },
    );
    const r = await service.resumirPorId('A', 'd1');
    expect(r).toContain('RESUMO NOVO GERADO');
    expect(storage.getCalls).toEqual(['A/d1/doc.pdf']); // releu do Storage
    expect(llm.systems).toHaveLength(1);
    expect(store.setCalls).toHaveLength(1); // PERSISTIU
    expect(store.setCalls[0]!.resumo).toBe('RESUMO NOVO GERADO');
  });
});

describe('ResumirDocumento — SOB DEMANDA (novo/foco)', () => {
  it('com foco: gera novo, passa o foco ao LLM e NÃO persiste', async () => {
    const { service, store, storage, llm } = build(
      { A: { d1: rowDe({ id: 'd1', resumo: 'Resumo antigo guardado.' }) } },
      { 'A/d1/doc.pdf': new TextEncoder().encode('PDF') },
    );
    const r = await service.resumirPorId('A', 'd1', { foco: 'prazos' });
    expect(r).toContain('RESUMO NOVO GERADO'); // ignorou o guardado
    expect(storage.getCalls).toEqual(['A/d1/doc.pdf']);
    expect(llm.systems[0]).toContain('prazos'); // foco no system
    expect(store.setCalls).toHaveLength(0); // NÃO persistiu (one-off)
  });
});

describe('ResumirDocumento — sem_texto e falhas', () => {
  it('documento escaneado (sem_texto): avisa ponto cego, sem ler Storage', async () => {
    const { service, storage } = build({
      A: { d1: rowDe({ id: 'd1', extracaoStatus: 'sem_texto', resumo: null }) },
    });
    const r = await service.resumirPorId('A', 'd1');
    expect(r.toLowerCase()).toContain('escaneado');
    expect(storage.getCalls).toHaveLength(0);
  });

  it('falha ao reler o Storage: aviso claro (não quebra)', async () => {
    const { service } = build(
      { A: { d1: rowDe({ id: 'd1', resumo: null, storageRef: 'A/d1/doc.pdf' }) } },
      {}, // sem bytes → getDocument rejeita
    );
    const r = await service.resumirPorId('A', 'd1');
    expect(r.toLowerCase()).toContain('não consegui reler');
  });
});

describe('ResumirDocumento — ISOLAMENTO (2 assinantes)', () => {
  it('A pede resumo de doc de B (por id): barrado, Storage NUNCA lido, nada gerado', async () => {
    const { service, store, storage, llm } = build(
      { B: { db: rowDe({ id: 'db', resumo: 'Resumo do doc de B.', storageRef: 'B/db/doc.pdf' }) } },
      { 'B/db/doc.pdf': new TextEncoder().encode('PDF de B') },
    );
    const r = await service.resumirPorId('A', 'db'); // A tenta o id de B
    expect(r).toBe('Não encontrei esse documento no seu acervo.');
    expect(r).not.toContain('Resumo do doc de B');
    expect(storage.getCalls).toHaveLength(0); // arquivo de B NUNCA lido
    expect(llm.systems).toHaveLength(0); // nada gerado
    expect(store.setCalls).toHaveLength(0); // nada persistido
  });
});

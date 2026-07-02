/**
 * Sugestão de pasta no fluxo do 12A (Passo 18): match determinístico escopado,
 * sim/não/número/outra-mensagem, aviso de CNJ sem dono, legenda explícita
 * intocada e ISOLAMENTO A×B com números iguais.
 */
import { describe, expect, it } from 'vitest';
import { DocumentHandler } from '../src/application/documentos/document-handler';
import { DocumentoService } from '../src/application/documentos/documento-service';
import type { ExtracaoResultado } from '../src/adapters/documentos/extractors';
import type {
  ConteudoExtraido,
  DocumentoPastaStore,
  DocumentoRow,
  DocumentoStore,
  NovoDocumento,
  ProcessoPastaRef,
} from '../src/core/ports/documentos';
import type { PendingAction, PendingActionStore } from '../src/core/ports/cerebro1';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';
import type { PutDocumentInput, StoragePort } from '../src/core/ports/storage';

class FakeStorage implements StoragePort {
  files = new Map<string, Uint8Array>();
  putDocument(input: PutDocumentInput): Promise<{ storageRef: string }> {
    this.files.set(input.path, input.content);
    return Promise.resolve({ storageRef: input.path });
  }
  getDocument(ref: string): Promise<Uint8Array> {
    const b = this.files.get(ref);
    return b ? Promise.resolve(b) : Promise.reject(new Error('not found'));
  }
  getSignedUrl(ref: string): Promise<string> {
    return Promise.resolve(`https://signed/${ref}`);
  }
  deleteDocument(ref: string): Promise<void> {
    this.files.delete(ref);
    return Promise.resolve();
  }
}

interface StoredDoc extends NovoDocumento {
  chaves: ConteudoExtraido['chaves'];
  resumo: string | null;
  extracaoStatus: string;
}
class FakeStore implements DocumentoStore {
  data = new Map<string, StoredDoc[]>();
  inserir(assinanteId: string, doc: NovoDocumento): Promise<void> {
    const arr = this.data.get(assinanteId) ?? [];
    arr.push({ ...doc, chaves: null, resumo: null, extracaoStatus: 'ok' });
    this.data.set(assinanteId, arr);
    return Promise.resolve();
  }
  gravarConteudo(assinanteId: string, id: string, c: ConteudoExtraido): Promise<boolean> {
    const d = (this.data.get(assinanteId) ?? []).find((x) => x.id === id);
    if (!d) return Promise.resolve(false);
    Object.assign(d, { chaves: c.chaves, resumo: c.resumo, extracaoStatus: c.extracaoStatus, status: 'guardado' });
    return Promise.resolve(true);
  }
  getById(assinanteId: string, id: string): Promise<DocumentoRow | null> {
    const d = (this.data.get(assinanteId) ?? []).find((x) => x.id === id);
    if (!d) return Promise.resolve(null);
    return Promise.resolve({
      id: d.id,
      nome: d.nome,
      tipo: d.tipo,
      storageRef: d.storageRef,
      processoId: d.processoId,
      chaves: d.chaves,
      resumo: d.resumo,
      extracaoStatus: d.extracaoStatus as 'ok',
      status: d.status,
    });
  }
  pendenteDecisao(): Promise<DocumentoRow | null> {
    return Promise.resolve(null);
  }
  remover(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

/** PastaStore por tenant, honrando o contrato de escopo. */
class FakePastaStore implements DocumentoPastaStore {
  procs = new Map<string, ProcessoPastaRef[]>();
  vinculos: Array<{ tenant: string; docId: string; processoId: string | null }> = [];
  constructor(private readonly docs: FakeStore) {}
  seed(tenant: string, p: ProcessoPastaRef): void {
    const arr = this.procs.get(tenant) ?? [];
    arr.push(p);
    this.procs.set(tenant, arr);
  }
  findProcessosPorNumeros(tenant: string, numeros: string[]): Promise<ProcessoPastaRef[]> {
    const arr = this.procs.get(tenant) ?? []; // SÓ o acervo do próprio tenant
    return Promise.resolve(
      arr.filter((p) => numeros.some((n) => (p.numeroCnj ?? '').includes(n))),
    );
  }
  getProcessoPastaById(tenant: string, id: string): Promise<ProcessoPastaRef | null> {
    return Promise.resolve((this.procs.get(tenant) ?? []).find((p) => p.id === id) ?? null);
  }
  setProcessoId(tenant: string, docId: string, processoId: string | null): Promise<boolean> {
    const d = (this.docs.data.get(tenant) ?? []).find((x) => x.id === docId);
    if (!d) return Promise.resolve(false);
    d.processoId = processoId;
    this.vinculos.push({ tenant, docId, processoId });
    return Promise.resolve(true);
  }
  listarPorPasta(): Promise<never[]> {
    return Promise.resolve([]);
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

/** LLM fake: extrai chaves com os NÚMEROS configurados (o LLM extrai; o código casa). */
class FakeLlm implements LlmPort {
  constructor(private readonly numeros: string[]) {}
  generate(p: LlmGenerateParams): Promise<LlmGenerateResult> {
    if (p.responseFormat) {
      return Promise.resolve({
        text: JSON.stringify({ tipo: 'contrato', partes: [], numeros: this.numeros, datas: [], assunto: 'locação', resumo_curto: '' }),
        toolCalls: [],
        stopReason: 'end_turn',
      });
    }
    return Promise.resolve({ text: 'RESUMO', toolCalls: [], stopReason: 'end_turn' });
  }
}

const extOk = (): Promise<ExtracaoResultado> =>
  Promise.resolve({ texto: 'Contrato que menciona o processo.', status: 'ok', formato: 'pdf' });

const PROC_A: ProcessoPastaRef = { id: 'proc-a', numeroCnj: '00012345620248260100', clienteNome: 'Gabriel Machado' };

function build(numeros: string[], opts: { processos?: Array<[string, ProcessoPastaRef]> } = {}) {
  const storage = new FakeStorage();
  const store = new FakeStore();
  const pastaStore = new FakePastaStore(store);
  for (const [tenant, p] of opts.processos ?? [['A', PROC_A]] as Array<[string, ProcessoPastaRef]>) {
    pastaStore.seed(tenant, p);
  }
  const pending = new InMemoryPending();
  const service = new DocumentoService({
    storage,
    store,
    llm: new FakeLlm(numeros),
    resolveProcessoId: () => Promise.resolve(null),
    pastas: { store: pastaStore, pending },
    extrair: extOk,
    novoId: () => 'doc-1',
    logger: { error: () => {} },
  });
  const handler = new DocumentHandler({ service, store, pending });
  return { service, handler, store, pastaStore, pending };
}

const entrada = { bytes: new Uint8Array([1]), filename: 'contrato.pdf', contentType: 'application/pdf' };

describe('sugestão de pasta na guarda (Passo 18)', () => {
  it('número casa 1 processo → SUGERE (não vincula) e "sim" vincula', async () => {
    const { service, handler, store, pending } = build(['12345']);
    const r1 = await service.processarComAcao('A', entrada, 'salvar');
    expect(r1).toContain('guardo na pasta dele?');
    // sugerir ≠ vincular: o doc segue AVULSO até o sim
    expect((await store.getById('A', 'doc-1'))!.processoId).toBeNull();
    expect((await pending.get('A'))?.acao).toBe('vincular_documento');

    const r2 = await handler.handleDecision('A', 'sim');
    expect(r2).toContain('está na pasta do processo 00012345620248260100');
    expect((await store.getById('A', 'doc-1'))!.processoId).toBe('proc-a');
    expect(await pending.get('A')).toBeNull();
  });

  it('"não" mantém avulso; chaves/resumo intactos (nada é reprocessado)', async () => {
    const { service, handler, store } = build(['12345']);
    await service.processarComAcao('A', entrada, 'salvar');
    const antes = (await store.getById('A', 'doc-1'))!;
    const r = await handler.handleDecision('A', 'nao');
    expect(r).toContain('deixei avulso');
    const depois = (await store.getById('A', 'doc-1'))!;
    expect(depois.processoId).toBeNull();
    expect(depois.chaves).toEqual(antes.chaves);
  });

  it('QUALQUER outra mensagem descarta a sugestão silenciosamente (null → a conversa segue)', async () => {
    const { service, handler, store, pending } = build(['12345']);
    await service.processarComAcao('A', entrada, 'salvar');
    const r = await handler.handleDecision('A', 'qual o prazo da contestacao');
    expect(r).toBeNull(); // não consumiu — orquestrador segue o fluxo normal
    expect(await pending.get('A')).toBeNull(); // pendência descartada
    expect((await store.getById('A', 'doc-1'))!.processoId).toBeNull();
  });

  it('número casa 2 processos → pergunta numerada; o número escolhe', async () => {
    const { service, handler, store } = build(['12345'], {
      processos: [
        ['A', PROC_A],
        ['A', { id: 'proc-b', numeroCnj: '00012345920138260100', clienteNome: 'Maria' }],
      ],
    });
    const r1 = await service.processarComAcao('A', entrada, 'salvar');
    expect(r1).toContain('mais de um processo');
    expect(r1).toContain('1)');
    expect(r1).toContain('2)');
    const r2 = await handler.handleDecision('A', '2');
    expect(r2).toContain('00012345920138260100');
    expect((await store.getById('A', 'doc-1'))!.processoId).toBe('proc-b');
  });

  it('CNJ FORTE sem dono no acervo → guarda avulso com aviso honesto, sem pendência', async () => {
    const { service, pending, store } = build(['00099999920248260100']);
    const r = await service.processarComAcao('A', entrada, 'salvar');
    expect(r).toContain('não achei esse processo no seu acervo — guardei avulso');
    expect(await pending.get('A')).toBeNull();
    expect((await store.getById('A', 'doc-1'))!.processoId).toBeNull();
  });

  it('fragmento sem dono (não-forte) → nada de aviso nem sugestão', async () => {
    const { service, pending } = build(['77777']);
    const r = await service.processarComAcao('A', entrada, 'salvar');
    expect(r).not.toContain('guardo na pasta');
    expect(r).not.toContain('não achei esse processo');
    expect(await pending.get('A')).toBeNull();
  });

  it('legenda explícita (vínculo direto) → SEM sugestão (precedência do usuário)', async () => {
    const { service, pending, store, pastaStore } = build(['12345']);
    pastaStore.seed('A', PROC_A); // (já semeado, garante)
    const svcComResolve = new DocumentoService({
      storage: new FakeStorage(),
      store,
      llm: new FakeLlm(['12345']),
      resolveProcessoId: () => Promise.resolve('proc-a'),
      pastas: { store: pastaStore, pending },
      extrair: extOk,
      novoId: () => 'doc-2',
      logger: { error: () => {} },
    });
    const r = await svcComResolve.processarComAcao(
      'A',
      { ...entrada, numeroCnj: '00012345620248260100' },
      'salvar',
    );
    expect(r).not.toContain('guardo na pasta dele?');
    expect(await pending.get('A')).toBeNull();
    expect((await store.getById('A', 'doc-2'))!.processoId).toBe('proc-a');
    void service;
  });

  it('ISOLAMENTO A×B: número IGUAL nos dois acervos → A só vê sugestão do processo de A', async () => {
    const { service, pending } = build(['12345'], {
      processos: [
        ['A', PROC_A],
        ['B', { id: 'proc-de-b', numeroCnj: '00012345620248260199', clienteNome: 'Cliente B' }],
      ],
    });
    const r = await service.processarComAcao('A', entrada, 'salvar');
    expect(r).toContain('Gabriel Machado'); // sugestão é a de A…
    expect(r).not.toContain('Cliente B'); // …nunca a de B
    expect((await pending.get('A'))!.params.processoId).toBe('proc-a');
  });

  it('ISOLAMENTO A×B: número que SÓ existe em B → para A é como se não existisse', async () => {
    const { service, pending } = build(['99999'], {
      processos: [['B', { id: 'proc-de-b', numeroCnj: '00099999120248260100', clienteNome: 'Cliente B' }]],
    });
    const r = await service.processarComAcao('A', entrada, 'salvar');
    expect(r).not.toContain('guardo na pasta');
    expect(r).not.toContain('Cliente B');
    expect(await pending.get('A')).toBeNull();
  });

  it('pendência FORJADA com processo de B → posse re-verificada nega o vínculo', async () => {
    const { handler, service, store, pending } = build(['12345']);
    await service.processarComAcao('A', entrada, 'salvar');
    // forja: troca o processo sugerido pelo id de um processo que NÃO é de A
    await pending.save('A', {
      acao: 'vincular_documento',
      params: { docId: 'doc-1', processoId: 'proc-de-b' },
      fase: 'confirmando',
      faltando: [],
    });
    const r = await handler.handleDecision('A', 'sim');
    expect(r).toContain('Não encontrei esse processo');
    expect((await store.getById('A', 'doc-1'))!.processoId).toBeNull();
  });
});

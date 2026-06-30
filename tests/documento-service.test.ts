import { describe, expect, it } from 'vitest';
import { DocumentHandler } from '../src/application/documentos/document-handler';
import { DocumentoService } from '../src/application/documentos/documento-service';
import type { ExtracaoResultado } from '../src/adapters/documentos/extractors';
import type {
  ConteudoExtraido,
  DocumentoRow,
  DocumentoStore,
  NovoDocumento,
} from '../src/core/ports/documentos';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';
import type { PutDocumentInput, StoragePort } from '../src/core/ports/storage';

// --- Fakes ---
class FakeStorage implements StoragePort {
  files = new Map<string, Uint8Array>();
  getCalls: string[] = [];
  deleted: string[] = [];
  putDocument(input: PutDocumentInput): Promise<{ storageRef: string }> {
    this.files.set(input.path, input.content);
    return Promise.resolve({ storageRef: input.path });
  }
  getDocument(ref: string): Promise<Uint8Array> {
    this.getCalls.push(ref);
    const b = this.files.get(ref);
    if (!b) return Promise.reject(new Error('not found'));
    return Promise.resolve(b);
  }
  getSignedUrl(ref: string): Promise<string> {
    return Promise.resolve(`https://signed/${ref}`);
  }
  deleteDocument(ref: string): Promise<void> {
    this.deleted.push(ref);
    this.files.delete(ref);
    return Promise.resolve();
  }
}

interface StoredDoc extends NovoDocumento {
  chaves: ConteudoExtraido['chaves'];
  resumo: string | null;
  extracaoStatus: string;
  buscaTexto: string | null;
}
class FakeStore implements DocumentoStore {
  data = new Map<string, StoredDoc[]>(); // por tenant
  inserir(assinanteId: string, doc: NovoDocumento): Promise<void> {
    const arr = this.data.get(assinanteId) ?? [];
    arr.push({ ...doc, chaves: null, resumo: null, extracaoStatus: 'ok', buscaTexto: null });
    this.data.set(assinanteId, arr);
    return Promise.resolve();
  }
  gravarConteudo(assinanteId: string, id: string, c: ConteudoExtraido): Promise<boolean> {
    const d = (this.data.get(assinanteId) ?? []).find((x) => x.id === id);
    if (!d) return Promise.resolve(false);
    Object.assign(d, { ...c, status: 'guardado' });
    return Promise.resolve(true);
  }
  getById(assinanteId: string, id: string): Promise<DocumentoRow | null> {
    const d = (this.data.get(assinanteId) ?? []).find((x) => x.id === id);
    if (!d) return Promise.resolve(null);
    return Promise.resolve({
      id: d.id, nome: d.nome, tipo: d.tipo, storageRef: d.storageRef, processoId: d.processoId,
      chaves: d.chaves, resumo: d.resumo, extracaoStatus: d.extracaoStatus as 'ok', status: d.status,
    });
  }
  pendenteDecisao(assinanteId: string): Promise<DocumentoRow | null> {
    const d = (this.data.get(assinanteId) ?? []).find((x) => x.status === 'aguardando_decisao');
    return d ? this.getById(assinanteId, d.id) : Promise.resolve(null);
  }
  remover(assinanteId: string, id: string): Promise<string | null> {
    const arr = this.data.get(assinanteId) ?? [];
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return Promise.resolve(null);
    const [d] = arr.splice(i, 1);
    return Promise.resolve(d!.storageRef);
  }
}

class FakeLlm implements LlmPort {
  generate(p: LlmGenerateParams): Promise<LlmGenerateResult> {
    if (p.responseFormat) {
      return Promise.resolve({
        text: JSON.stringify({ tipo: 'contrato', partes: ['Maria'], numeros: ['12345'], datas: [], assunto: 'locação', resumo_curto: 'curto' }),
        toolCalls: [], stopReason: 'end_turn',
      });
    }
    return Promise.resolve({ text: 'RESUMO DO DOCUMENTO', toolCalls: [], stopReason: 'end_turn' });
  }
}

const extOk = (): Promise<ExtracaoResultado> => Promise.resolve({ texto: 'Contrato de locação entre Maria e Empresa X. Valor mensal...', status: 'ok', formato: 'pdf' });
const extSemTexto = (): Promise<ExtracaoResultado> => Promise.resolve({ texto: '', status: 'sem_texto', formato: 'imagem', aviso: 'imagem; OCR em breve' });

function build(opts: { ext?: () => Promise<ExtracaoResultado>; processos?: Record<string, string> } = {}) {
  const storage = new FakeStorage();
  const store = new FakeStore();
  let seq = 0;
  const service = new DocumentoService({
    storage, store, llm: new FakeLlm(),
    resolveProcessoId: (_a, cnj) => Promise.resolve(opts.processos?.[cnj] ?? null),
    extrair: opts.ext ?? extOk,
    novoId: () => `doc${++seq}`,
    logger: { error: () => {} },
  });
  return { service, storage, store, handler: new DocumentHandler({ service, store }) };
}
const entrada = (over = {}) => ({ bytes: new TextEncoder().encode('PDFDATA'), filename: 'contrato.pdf', contentType: 'application/pdf', ...over });

describe('DocumentoService — ação direta', () => {
  it('salvar (ok): sobe arquivo, grava chaves+busca, responde guardei', async () => {
    const { service, storage, store } = build();
    const r = await service.processarComAcao('A', entrada(), 'salvar');
    expect(r).toContain('Guardei');
    expect(storage.files.has('A/doc1/contrato.pdf')).toBe(true); // caminho prefixado pelo tenant
    const d = store.data.get('A')![0]!;
    expect(d.status).toBe('guardado');
    expect(d.chaves?.numeros).toEqual(['12345']);
    expect(d.buscaTexto).toContain('Maria');
  });

  it('ambos: responde com resumo + guardei', async () => {
    const { service } = build();
    const r = await service.processarComAcao('A', entrada(), 'ambos');
    expect(r).toContain('RESUMO DO DOCUMENTO');
    expect(r).toContain('Guardei');
  });

  it('resumir: mostra resumo e NÃO guarda (sem linha, sem arquivo)', async () => {
    const { service, storage, store } = build();
    const r = await service.processarComAcao('A', entrada(), 'resumir');
    expect(r).toContain('RESUMO DO DOCUMENTO');
    expect(r.toLowerCase()).toContain('não guardei');
    expect(store.data.get('A') ?? []).toHaveLength(0);
    expect(storage.files.size).toBe(0);
  });

  it('sem_texto + salvar: guarda arquivo, marca sem_texto, avisa ponto cego', async () => {
    const { service, store } = build({ ext: extSemTexto });
    const r = await service.processarComAcao('A', { ...entrada({ filename: 'scan.jpg', contentType: 'image/jpeg' }) }, 'salvar');
    expect(r.toLowerCase()).toMatch(/não poderá ser encontrado por conteúdo/);
    const d = store.data.get('A')![0]!;
    expect(d.extracaoStatus).toBe('sem_texto');
    expect(d.chaves).toBeNull(); // não inventou chaves
  });

  it('vínculo a processo: existente vincula; inexistente guarda solto com aviso', async () => {
    const ok = build({ processos: { '00012345620248260100': 'proc-1' } });
    await ok.service.processarComAcao('A', entrada({ numeroCnj: '00012345620248260100' }), 'salvar');
    expect(ok.store.data.get('A')![0]!.processoId).toBe('proc-1');

    const solto = build();
    const r = await solto.service.processarComAcao('A', entrada({ numeroCnj: '00012345620248260100' }), 'salvar');
    expect(solto.store.data.get('A')![0]!.processoId).toBeNull();
    expect(r).toContain('guardei solto');
  });
});

describe('DocumentoService — decisão (staging)', () => {
  it('receber → pergunta 1/2/3 e deixa em aguardando_decisao', async () => {
    const { service, store, storage } = build();
    const r = await service.receber('A', entrada());
    expect(r).toContain('1 - Resumir');
    expect(store.data.get('A')![0]!.status).toBe('aguardando_decisao');
    expect(storage.files.size).toBe(1); // staged
  });

  it('decidir salvar → promove o staging a guardado (com chaves)', async () => {
    const { service, store } = build();
    await service.receber('A', entrada());
    const id = store.data.get('A')![0]!.id;
    const r = await service.decidir('A', id, 'salvar');
    expect(r).toContain('Guardei');
    expect(store.data.get('A')![0]!.status).toBe('guardado');
    expect(store.data.get('A')![0]!.chaves?.tipo).toBe('contrato');
  });

  it('decidir resumir → resume e APAGA o staging (arquivo e linha)', async () => {
    const { service, store, storage } = build();
    await service.receber('A', entrada());
    const id = store.data.get('A')![0]!.id;
    const r = await service.decidir('A', id, 'resumir');
    expect(r).toContain('RESUMO DO DOCUMENTO');
    expect(store.data.get('A') ?? []).toHaveLength(0);
    expect(storage.files.size).toBe(0);
  });
});

describe('DocumentHandler — decisão por legenda/resposta', () => {
  it('legenda "resuma e guarda" → ambos', async () => {
    const { handler } = build();
    const r = await handler.handleIncoming('A', entrada({ legenda: 'resuma e guarda isso' }));
    expect(r).toContain('RESUMO');
    expect(r).toContain('Guardei');
  });
  it('sem legenda → pergunta; resposta "2" resolve; "9" re-pergunta; sem pendência → null', async () => {
    const { handler, store } = build();
    expect(await handler.handleIncoming('A', entrada())).toContain('1 - Resumir');
    expect(await handler.handleDecision('A', '9')).toContain('Não entendi');
    expect(await handler.handleDecision('A', '2')).toContain('Guardei');
    expect(store.data.get('A')![0]!.status).toBe('guardado');
    // sem documento pendente → null (orquestrador segue o fluxo normal)
    expect(await handler.handleDecision('A', '2')).toBeNull();
  });
});

describe('DocumentoService — ISOLAMENTO do arquivo (2 assinantes)', () => {
  it('A não vê doc de B; B não baixa nem apaga o de A; sem dono → sem acesso', async () => {
    const { service, store, storage } = build();
    // B guarda um documento
    await service.processarComAcao('B', entrada(), 'salvar');
    const bDocId = store.data.get('B')![0]!.id;

    // (a) A não encontra na tabela o documento de B
    expect(await store.getById('A', bDocId)).toBeNull();

    // (b) A tenta decidir sobre o docId de B → barra por não ser dono; NÃO baixa o arquivo
    storage.getCalls = [];
    const r = await service.decidir('A', bDocId, 'salvar');
    expect(r).toContain('Não encontrei');
    expect(storage.getCalls).toHaveLength(0); // nunca tocou o arquivo de B
    expect(store.data.get('B')![0]!.status).toBe('guardado'); // doc de B intacto

    // (c) A apaga 0 documentos de B
    expect(await store.remover('A', bDocId)).toBeNull();
    expect(store.data.get('B')).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { syncCorpus } from '../src/application/cerebro2/sync-corpus';
import type {
  CorpusSyncStore,
  NormaInput,
  NormaSyncState,
  NormaSyncUpdate,
  SyncRunResult,
  TrechoInput,
} from '../src/core/ports/corpus';
import type { EmbeddingsPort } from '../src/core/ports/embeddings';
import type { NormaConteudo, NormaRef, SourcePort } from '../src/core/ports/source';

// --- Fakes ---

interface NormaRow extends NormaSyncState {
  vigenciaStatus: string | null;
  revogadaEm: string | null;
}

class FakeStore implements CorpusSyncStore {
  normas = new Map<string, NormaRow>(); // identificador -> row
  trechos = new Map<string, TrechoInput[]>(); // normaId -> trechos
  runs: SyncRunResult[] = [];
  replaceCalls = 0;
  private nseq = 0;
  private rseq = 0;

  getNormaState(identificador: string): Promise<NormaSyncState | null> {
    const r = this.normas.get(identificador);
    return Promise.resolve(r ? { id: r.id, fonteHash: r.fonteHash, vigenciaStatus: r.vigenciaStatus } : null);
  }
  upsertNorma(n: NormaInput): Promise<string> {
    const existing = this.normas.get(n.identificador);
    const id = existing?.id ?? `n${++this.nseq}`;
    this.normas.set(n.identificador, {
      id,
      fonteHash: existing?.fonteHash ?? null,
      vigenciaStatus: n.vigenciaStatus,
      revogadaEm: existing?.revogadaEm ?? null,
    });
    return Promise.resolve(id);
  }
  replaceTrechos(normaId: string, trechos: TrechoInput[]): Promise<void> {
    this.replaceCalls += 1;
    this.trechos.set(normaId, trechos);
    return Promise.resolve();
  }
  updateNormaSync(normaId: string, s: NormaSyncUpdate): Promise<void> {
    for (const row of this.normas.values()) {
      if (row.id === normaId) {
        row.fonteHash = s.fonteHash;
        if (s.revogadaEm) row.revogadaEm = s.revogadaEm; // coalesce
      }
    }
    return Promise.resolve();
  }
  startRun(): Promise<string> {
    return Promise.resolve(`run${++this.rseq}`);
  }
  finishRun(_id: string, r: SyncRunResult): Promise<void> {
    this.runs.push(r);
    return Promise.resolve();
  }
}

const embeddings: EmbeddingsPort = {
  embed: (texts) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
};

function fonteCom(map: Record<string, NormaConteudo>): SourcePort {
  const refs: NormaRef[] = Object.keys(map).map((id) => ({
    tipo: 'legislacao',
    sigla: 'X',
    titulo: `Titulo ${id}`,
    identificador: id,
    fonteUrl: `https://exemplo/${id}`,
    dataPublicacao: null,
  }));
  return {
    listNormas: () => Promise.resolve(refs),
    fetchNorma: (ref) => {
      const c = map[ref.identificador];
      if (!c) return Promise.reject(new Error('sem conteúdo'));
      return Promise.resolve(c);
    },
  };
}

const textoArt = 'LEI X.\nArt. 1º Primeira regra.\nArt. 2º Segunda regra.';
const now = () => new Date('2026-06-29T12:00:00Z');

describe('syncCorpus (motor de sincronização)', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('idempotência: 2ª execução sem mudança = 0 re-embeds, 0 duplicação', async () => {
    const source = fonteCom({ 'Lei nº 1/2000': { texto: textoArt, vigenciaStatus: 'vigente', fonteVersao: null } });

    const r1 = await syncCorpus({ source, embeddings, store, now });
    expect(r1.normasAtualizadas).toBe(1);
    expect(store.replaceCalls).toBe(1);
    const trechosApos1 = store.trechos.get('n1')!.length;

    const r2 = await syncCorpus({ source, embeddings, store, now });
    expect(r2.normasAtualizadas).toBe(0); // hash igual → skip
    expect(store.replaceCalls).toBe(1); // não chamou de novo
    expect(store.trechos.get('n1')!.length).toBe(trechosApos1); // sem duplicar
  });

  it('alteração: texto muda → re-embeda só aquela norma', async () => {
    const mapa: Record<string, NormaConteudo> = {
      'Lei nº 1/2000': { texto: textoArt, vigenciaStatus: 'vigente', fonteVersao: null },
      'Lei nº 2/2000': { texto: textoArt, vigenciaStatus: 'vigente', fonteVersao: null },
    };
    const source = fonteCom(mapa);
    await syncCorpus({ source, embeddings, store, now });
    expect(store.replaceCalls).toBe(2);

    mapa['Lei nº 1/2000'] = { texto: textoArt + '\nArt. 3º Nova regra.', vigenciaStatus: 'vigente', fonteVersao: null };
    const r = await syncCorpus({ source, embeddings, store, now });
    expect(r.normasAtualizadas).toBe(1); // só a que mudou
    expect(store.replaceCalls).toBe(3); // +1 no total
  });

  it('força (ingestão): re-embeda mesmo sem mudança', async () => {
    const source = fonteCom({ 'Lei nº 1/2000': { texto: textoArt, vigenciaStatus: 'vigente', fonteVersao: null } });
    await syncCorpus({ source, embeddings, store, now });
    const r = await syncCorpus({ source, embeddings, store, now }, { force: true });
    expect(r.normasAtualizadas).toBe(1);
    expect(store.replaceCalls).toBe(2);
  });

  it('revogação: fonte marca revogada → upsert revogada + conta + revogadaEm', async () => {
    const source = fonteCom({ 'Lei nº 9/1916': { texto: textoArt, vigenciaStatus: 'revogada', fonteVersao: null } });
    const r = await syncCorpus({ source, embeddings, store, now });
    expect(r.normasRevogadas).toBe(1);
    expect(store.normas.get('Lei nº 9/1916')!.vigenciaStatus).toBe('revogada');
    expect(store.normas.get('Lei nº 9/1916')!.revogadaEm).toBe('2026-06-29');
  });

  it('sticky: já revogada e marcador some → mantém revogada + aviso (não ressuscita)', async () => {
    store.normas.set('Lei nº 9/1916', { id: 'n1', fonteHash: 'velho', vigenciaStatus: 'revogada', revogadaEm: '2002-01-10' });
    const source = fonteCom({ 'Lei nº 9/1916': { texto: textoArt, vigenciaStatus: 'vigente', fonteVersao: null } });
    const r = await syncCorpus({ source, embeddings, store, now });
    expect(store.normas.get('Lei nº 9/1916')!.vigenciaStatus).toBe('revogada'); // mantida
    expect(r.erros.some((e) => /mantida REVOGADA/i.test(e.erro))).toBe(true);
    expect(r.normasRevogadas).toBe(0); // não é transição nova
  });

  it('resiliência: fonte offline numa norma não corrompe nem aborta as demais', async () => {
    const source: SourcePort = {
      listNormas: () =>
        Promise.resolve([
          { tipo: 'legislacao', sigla: 'A', titulo: 'A', identificador: 'Lei nº 1/2000', fonteUrl: 'u1', dataPublicacao: null },
          { tipo: 'legislacao', sigla: 'B', titulo: 'B', identificador: 'Lei nº 2/2000', fonteUrl: 'u2', dataPublicacao: null },
        ]),
      fetchNorma: (ref) =>
        ref.identificador === 'Lei nº 1/2000'
          ? Promise.reject(new Error('HTTP 503 fonte fora do ar'))
          : Promise.resolve({ texto: textoArt, vigenciaStatus: 'vigente', fonteVersao: null }),
    };
    const r = await syncCorpus({ source, embeddings, store, now });
    expect(r.status).toBe('parcial');
    expect(r.erros.some((e) => /503/.test(e.erro))).toBe(true);
    expect(store.normas.has('Lei nº 2/2000')).toBe(true); // a outra foi processada
    expect(store.replaceCalls).toBe(1); // só a que funcionou
    expect(store.runs).toHaveLength(1); // run sempre fechado
  });

  it('uma norma só: --identificador inexistente → erro registrado', async () => {
    const source = fonteCom({ 'Lei nº 1/2000': { texto: textoArt, vigenciaStatus: 'vigente', fonteVersao: null } });
    const r = await syncCorpus({ source, embeddings, store, now }, { identificador: 'Lei nº 999/9999' });
    expect(r.status).toBe('erro');
    expect(r.normasVerificadas).toBe(0);
  });
});

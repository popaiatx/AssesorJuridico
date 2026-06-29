import { describe, expect, it } from 'vitest';
import { PlanaltoLegislacaoSource } from '../src/adapters/source/legislacao/planalto-source';
import { StubJurisprudenciaSource } from '../src/adapters/source/jurisprudencia/agregador-stub';
import { NotImplementedError } from '../src/core/errors';
import type { HttpGet } from '../src/adapters/source/http';
import type { NormaRef } from '../src/core/ports/source';

function toArrayBuffer(s: string, enc: BufferEncoding = 'utf-8'): ArrayBuffer {
  const b = Buffer.from(s, enc);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function fakeGet(buf: ArrayBuffer, status = 200): HttpGet {
  return () => Promise.resolve({ status, arrayBuffer: () => Promise.resolve(buf) });
}

const ref: NormaRef = {
  tipo: 'legislacao',
  sigla: 'CDC',
  titulo: 'Código de Defesa do Consumidor',
  identificador: 'Lei nº 8.078/1990',
  fonteUrl: 'https://exemplo/cdc.htm',
  dataPublicacao: '1990-09-11',
};

describe('PlanaltoLegislacaoSource', () => {
  it('fetchNorma: extrai texto (sem tags) e marca vigente sem marcador', async () => {
    const html = '<html><body><p>LEI Nº 8.078</p><div>Art. 1&ordm; Protege o consumidor.</div></body></html>';
    const src = new PlanaltoLegislacaoSource(fakeGet(toArrayBuffer(html)));
    const out = await src.fetchNorma(ref);
    expect(out.texto).not.toContain('<');
    expect(out.texto).toContain('Art. 1');
    expect(out.vigenciaStatus).toBe('vigente');
    expect(out.fonteVersao).toBeNull();
  });

  it('fetchNorma: decodifica latin1 (acentos) por padrão', async () => {
    const html = '<p>LEI. Art. 1 Dispõe sobre a proteção.</p>';
    const src = new PlanaltoLegislacaoSource(fakeGet(toArrayBuffer(html, 'latin1')));
    const out = await src.fetchNorma(ref);
    expect(out.texto).toContain('proteção');
  });

  it('fetchNorma: detecta revogação da norma inteira no cabeçalho', async () => {
    const html =
      '<p>CÓDIGO CIVIL DE 1916 (Revogada pela Lei nº 10.406, de 2002)</p><p>Art. 1 ...</p>';
    const src = new PlanaltoLegislacaoSource(fakeGet(toArrayBuffer(html)));
    const out = await src.fetchNorma(ref);
    expect(out.vigenciaStatus).toBe('revogada');
  });

  it('fetchNorma: HTTP != 200 lança', async () => {
    const src = new PlanaltoLegislacaoSource(fakeGet(toArrayBuffer('x'), 503));
    await expect(src.fetchNorma(ref)).rejects.toThrow(/503/);
  });

  it('listNormas: devolve o escopo curado (6 normas de legislação)', async () => {
    const src = new PlanaltoLegislacaoSource(fakeGet(toArrayBuffer('')));
    const refs = await src.listNormas();
    expect(refs).toHaveLength(6);
    expect(refs.every((r) => r.tipo === 'legislacao' && r.identificador && r.fonteUrl)).toBe(true);
    expect(refs.map((r) => r.sigla)).toContain('CDC');
  });
});

describe('StubJurisprudenciaSource', () => {
  it('listNormas e fetchNorma lançam NotImplementedError (PENDENTE)', async () => {
    const src = new StubJurisprudenciaSource();
    expect(() => src.listNormas()).toThrow(NotImplementedError);
    expect(() => src.fetchNorma(ref)).toThrow(NotImplementedError);
  });
});

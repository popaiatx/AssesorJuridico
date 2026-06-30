import { describe, expect, it } from 'vitest';
import { extrairTexto, type ExtratoParsers } from '../src/adapters/documentos/extractors';
import { detectFormato, isMeaningfulText } from '../src/core/domain/documentos/formato';

const fakeParsers = (over: Partial<ExtratoParsers> = {}): ExtratoParsers => ({
  pdf: () => Promise.resolve({ text: 'texto extraído do pdf com conteúdo suficiente aqui.' }),
  docx: () => Promise.resolve({ value: 'texto extraído do docx com conteúdo suficiente aqui.' }),
  ...over,
});

const buf = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('detectFormato', () => {
  it('por extensão', () => {
    expect(detectFormato('a.txt', null)).toBe('txt');
    expect(detectFormato('a.PDF', null)).toBe('pdf');
    expect(detectFormato('a.docx', null)).toBe('docx');
    expect(detectFormato('foto.JPG', null)).toBe('imagem');
    expect(detectFormato('planilha.csv', null)).toBe('planilha');
    expect(detectFormato('arquivo.xyz', null)).toBe('desconhecido');
  });
  it('por content type quando sem extensão', () => {
    expect(detectFormato('arquivo', 'application/pdf')).toBe('pdf');
    expect(detectFormato('arquivo', 'image/png')).toBe('imagem');
    expect(detectFormato('arquivo', 'text/plain')).toBe('txt');
  });
});

describe('isMeaningfulText', () => {
  it('vazio/curto = false; texto real = true', () => {
    expect(isMeaningfulText('   \n  ')).toBe(false);
    expect(isMeaningfulText('abc')).toBe(false);
    expect(isMeaningfulText('Este é um texto com tamanho suficiente.')).toBe(true);
  });
});

describe('extrairTexto', () => {
  it('txt com conteúdo → ok', async () => {
    const r = await extrairTexto(buf('Petição inicial. Autor: Fulano. Réu: Empresa X.'), 'p.txt', null, fakeParsers());
    expect(r.status).toBe('ok');
    expect(r.texto).toContain('Petição');
  });

  it('pdf com texto → ok', async () => {
    const r = await extrairTexto(buf('%PDF'), 'p.pdf', null, fakeParsers());
    expect(r.status).toBe('ok');
    expect(r.formato).toBe('pdf');
  });

  it('PDF escaneado (sem texto) → sem_texto + aviso', async () => {
    const r = await extrairTexto(buf('%PDF'), 'scan.pdf', null, fakeParsers({ pdf: () => Promise.resolve({ text: '   ' }) }));
    expect(r.status).toBe('sem_texto');
    expect(r.aviso).toMatch(/escaneado|OCR/i);
  });

  it('docx → ok', async () => {
    const r = await extrairTexto(buf('PK'), 'p.docx', null, fakeParsers());
    expect(r.status).toBe('ok');
    expect(r.formato).toBe('docx');
  });

  it('imagem → sem_texto + aviso de OCR', async () => {
    const r = await extrairTexto(buf('\xff\xd8'), 'foto.jpg', 'image/jpeg', fakeParsers());
    expect(r.status).toBe('sem_texto');
    expect(r.aviso).toMatch(/imagem|OCR/i);
  });

  it('planilha (csv) → sem_texto + aviso', async () => {
    const r = await extrairTexto(buf('a,b\n1,2'), 'dados.csv', null, fakeParsers());
    expect(r.status).toBe('sem_texto');
    expect(r.aviso).toMatch(/planilha/i);
  });

  it('parser que lança → falha', async () => {
    const r = await extrairTexto(buf('%PDF'), 'p.pdf', null, fakeParsers({ pdf: () => Promise.reject(new Error('corrompido')) }));
    expect(r.status).toBe('falha');
  });
});

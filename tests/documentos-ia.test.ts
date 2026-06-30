import { describe, expect, it } from 'vitest';
import { buscaTextoDe, extrairChaves } from '../src/application/documentos/extrair-chaves';
import { resumir } from '../src/application/documentos/resumir';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../src/core/ports/llm';

class FakeLlm implements LlmPort {
  public calls: LlmGenerateParams[] = [];
  constructor(private readonly responder: (p: LlmGenerateParams, n: number) => LlmGenerateResult) {}
  generate(p: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.calls.push(p);
    return Promise.resolve(this.responder(p, this.calls.length));
  }
}
const json = (o: unknown): LlmGenerateResult => ({ text: JSON.stringify(o), toolCalls: [], stopReason: 'end_turn' });
const txt = (s: string): LlmGenerateResult => ({ text: s, toolCalls: [], stopReason: 'end_turn' });

describe('extrairChaves', () => {
  it('mapeia os campos do JSON estruturado', async () => {
    const llm = new FakeLlm(() =>
      json({
        tipo: 'intimação',
        partes: ['Maria Silva', 'Empresa X'],
        numeros: ['0001234-55.2024.8.26.0100'],
        datas: [{ data: '2026-07-20', descricao: 'prazo de contestação' }],
        assunto: 'citação',
        resumo_curto: 'Intimação para contestar.',
      }),
    );
    const k = await extrairChaves(llm, 'texto do documento...');
    expect(k.tipo).toBe('intimação');
    expect(k.partes).toEqual(['Maria Silva', 'Empresa X']);
    expect(k.numeros).toEqual(['0001234-55.2024.8.26.0100']);
    expect(k.datas[0]).toEqual({ data: '2026-07-20', descricao: 'prazo de contestação' });
    expect(k.resumoCurto).toBe('Intimação para contestar.');
  });

  it('NÃO inventa: campos ausentes ficam vazios', async () => {
    const llm = new FakeLlm(() =>
      json({ tipo: 'contrato', partes: [], numeros: [], datas: [], assunto: '', resumo_curto: '' }),
    );
    const k = await extrairChaves(llm, 'contrato sem números nem datas...');
    expect(k.tipo).toBe('contrato');
    expect(k.partes).toEqual([]);
    expect(k.numeros).toEqual([]);
    expect(k.datas).toEqual([]);
    expect(k.assunto).toBe('');
  });

  it('JSON truncado/inválido → chaves vazias (degrada com segurança)', async () => {
    const llm = new FakeLlm(() => txt('{"tipo":"petição","partes":["Fula'));
    const k = await extrairChaves(llm, 'x');
    expect(k).toEqual({ tipo: '', partes: [], numeros: [], datas: [], assunto: '', resumoCurto: '' });
  });

  it('descarta itens de data sem o campo data (não inventa)', async () => {
    const llm = new FakeLlm(() =>
      json({ tipo: '', partes: [], numeros: [], datas: [{ descricao: 'algo' }], assunto: '', resumo_curto: '' }),
    );
    const k = await extrairChaves(llm, 'x');
    expect(k.datas).toEqual([]);
  });

  it('buscaTextoDe concatena os campos para a busca futura', () => {
    const t = buscaTextoDe({
      tipo: 'intimação',
      partes: ['Maria Silva'],
      numeros: ['12345'],
      datas: [{ data: '2026-07-20', descricao: 'prazo' }],
      assunto: 'citação',
      resumoCurto: 'resumo',
    });
    expect(t).toContain('Maria Silva');
    expect(t).toContain('12345');
    expect(t).toContain('citação');
  });
});

describe('resumir', () => {
  it('documento curto → 1 chamada', async () => {
    const llm = new FakeLlm(() => txt('Resumo do documento.'));
    const r = await resumir(llm, 'Documento curto.');
    expect(r).toBe('Resumo do documento.');
    expect(llm.calls).toHaveLength(1);
  });

  it('documento longo → map-reduce (resume partes e consolida)', async () => {
    const longo = 'palavra '.repeat(4000); // ~32k chars > 10k → várias partes
    const llm = new FakeLlm((_p, n) => txt(n <= 3 ? `parcial ${n}` : 'RESUMO CONSOLIDADO'));
    const r = await resumir(llm, longo);
    expect(llm.calls.length).toBeGreaterThan(1); // várias parciais + consolidação
    expect(r).toBe('RESUMO CONSOLIDADO');
  });
});

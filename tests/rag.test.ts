import { describe, expect, it } from 'vitest';
import { chunkLegislacao } from '../src/core/domain/cerebro2/chunk-legislacao';
import { composeRagReply, type RagTrecho } from '../src/core/domain/cerebro2/rag';

describe('chunkLegislacao', () => {
  it('divide por artigo e monta a citação com a sigla', () => {
    const texto =
      'LEI Nº 8.078. Dispõe sobre... Art. 1º Esta lei estabelece normas. ' +
      'Art. 6º São direitos básicos do consumidor: I - a proteção. Parágrafo único. Vetado. ' +
      'Art. 49 O consumidor pode desistir em 7 dias.';
    const chunks = chunkLegislacao(texto, {
      sigla: 'CDC',
      identificador: 'Lei nº 8.078/1990',
      fonteUrl: 'http://planalto/cdc',
    });
    expect(chunks.map((c) => c.artigo)).toEqual(['art. 1º', 'art. 6º', 'art. 49']);
    expect(chunks[1]!.citacao).toBe('art. 6º do CDC');
    expect(chunks[1]!.texto).toContain('Parágrafo único'); // parágrafo fica no corpo do art.
  });

  it('subdivide artigo grande demais (limite de tokens) em pedaços com a mesma citação', () => {
    // Artigo único com corpo gigante (sem outros marcadores) → vários trechos.
    const corpoGigante = 'palavra '.repeat(5000); // ~40k chars
    const texto = `Art. 58 ${corpoGigante}`;
    const chunks = chunkLegislacao(texto, {
      sigla: 'CLT',
      identificador: 'Decreto-Lei nº 5.452/1943',
      fonteUrl: 'http://planalto/clt',
    });
    expect(chunks.length).toBeGreaterThan(1); // foi subdividido
    expect(chunks.every((c) => c.texto.length <= 12000)).toBe(true); // cada pedaço sob o teto
    expect(chunks.every((c) => c.citacao === 'art. 58 do CLT')).toBe(true); // mesma citação
    expect(chunks.map((c) => c.ordem)).toEqual(chunks.map((_, i) => i + 1)); // ordem sequencial
  });
});

const trechoCDC: RagTrecho = {
  citacao: 'art. 6º do CDC',
  texto: 'São direitos básicos do consumidor...',
  fonteUrl: 'http://planalto/cdc',
};

describe('composeRagReply — antialucinação e os 3 tipos', () => {
  it('A com fonte → afirma e cita (fonte validada)', () => {
    const r = composeRagReply({
      pertinentes: [trechoCDC],
      aproximados: [],
      llm: {
        orientacao: '',
        afirmacoes: [{ texto: 'O consumidor tem direitos básicos.', fonte: 'art. 6º do CDC' }],
        recusou: false,
      },
    });
    expect(r.fontesValidas).toEqual(['art. 6º do CDC']);
    expect(r.reply).toContain('art. 6º do CDC');
    expect(r.reply).toContain('Fontes:');
  });

  it('A sem fonte (citação fabricada pelo LLM) → descarta e NÃO afirma', () => {
    const r = composeRagReply({
      pertinentes: [], // nada pertinente recuperado
      aproximados: [],
      llm: {
        orientacao: '',
        afirmacoes: [{ texto: 'O prazo é de 15 dias.', fonte: 'art. 999 da Lei Inexistente' }],
        recusou: false,
      },
    });
    expect(r.fontesValidas).toEqual([]);
    expect(r.reply).not.toContain('art. 999'); // citação fabricada não aparece
    expect(r.reply).not.toContain('15 dias'); // afirmação sem fonte é descartada
    expect(r.reply.toLowerCase()).toContain('não vou afirmar');
  });

  it('B → orientação geral, sem inventar dispositivo', () => {
    const r = composeRagReply({
      pertinentes: [],
      aproximados: [],
      llm: {
        orientacao: 'Uma contestação é a defesa do réu; em geral trata de preliminares e mérito.',
        afirmacoes: [],
        recusou: false,
      },
    });
    expect(r.reply).toContain('Orientação geral');
    expect(r.reply).toContain('contestação é a defesa do réu');
  });

  it('C → resposta transparente e útil com dispositivos próximos do acervo', () => {
    const r = composeRagReply({
      pertinentes: [],
      aproximados: [{ citacao: 'art. 5º da CF', texto: '...', fonteUrl: 'http://planalto/cf' }],
      llm: { orientacao: '', afirmacoes: [], recusou: true },
    });
    expect(r.reply.toLowerCase()).toContain('não vou afirmar');
    expect(r.reply).toContain('Dispositivos próximos');
    expect(r.reply).toContain('art. 5º da CF');
  });

  it('revogada NUNCA vira afirmação validada — só aviso de revogação', () => {
    const trechoRevogado: RagTrecho = {
      citacao: 'art. 1º do CC/1916',
      texto: 'Toda pessoa é capaz...',
      fonteUrl: 'http://planalto/cc1916',
      vigenciaStatus: 'revogada',
    };
    const r = composeRagReply({
      pertinentes: [trechoRevogado], // recuperado e pertinente, porém revogado
      aproximados: [],
      llm: {
        orientacao: '',
        // o LLM tenta afirmar citando a norma revogada:
        afirmacoes: [{ texto: 'Toda pessoa é capaz de direitos.', fonte: 'art. 1º do CC/1916' }],
        recusou: false,
      },
    });
    expect(r.fontesValidas).toEqual([]); // revogada fora do allowlist
    expect(r.reply).not.toContain('Com base no acervo'); // não afirma
    expect(r.reply).toContain('REVOGADOS'); // aviso de revogação
    expect(r.reply).toContain('art. 1º do CC/1916');
    expect(r.reply.toLowerCase()).toContain('não vou afirmar');
  });

  it('mistura: afirmação válida fica, inválida some', () => {
    const r = composeRagReply({
      pertinentes: [trechoCDC],
      aproximados: [],
      llm: {
        orientacao: '',
        afirmacoes: [
          { texto: 'Direitos básicos.', fonte: 'art. 6º do CDC' },
          { texto: 'Algo inventado.', fonte: 'Súmula 999 falsa' },
        ],
        recusou: false,
      },
    });
    expect(r.fontesValidas).toEqual(['art. 6º do CDC']);
    expect(r.reply).not.toContain('Súmula 999');
    expect(r.reply).not.toContain('Algo inventado');
  });
});

import { describe, expect, it } from 'vitest';
import { formatarFicha } from '../src/core/domain/cerebro1/ficha-format';
import { montarFicha, somarValores } from '../src/core/domain/cerebro1/ficha';
import type { FichaBruta, FichaProcesso } from '../src/core/ports/ficha';

const AGORA = new Date('2026-07-01T12:00:00Z');

function processoBase(over: Partial<FichaBruta['processo']> = {}): FichaBruta['processo'] {
  return {
    id: 'p1',
    numeroCnj: '00012345620248260100',
    clienteNome: 'Maria Silva',
    parteContraria: 'Empresa X',
    vara: '2ª Vara Cível',
    comarca: 'São Paulo',
    area: 'cível',
    valorCausa: '15000.00',
    status: 'ativo',
    fase: 'conhecimento',
    instancia: '1º grau',
    segredoJustica: false,
    ...over,
  };
}

function fichaDe(bruta: FichaBruta): FichaProcesso {
  return montarFicha(bruta, AGORA);
}

describe('somarValores (centavos inteiros, sem float)', () => {
  it('soma decimais exatos', () => {
    expect(somarValores(['0.10', '0.20'])).toBe('0.30'); // 0.1+0.2 quebraria em float
    expect(somarValores(['1000.50', '2500.25'])).toBe('3500.75');
    expect(somarValores([])).toBe('0.00');
  });
});

describe('montarFicha (pura)', () => {
  it('separa futuros de recentes e soma o financeiro por status', () => {
    const f = fichaDe({
      processo: processoBase(),
      compromissos: [
        { id: 'c1', tipo: 'audiencia', dataHora: '2026-06-20T14:00:00Z', descricao: 'passada' },
        { id: 'c2', tipo: 'reuniao', dataHora: '2026-07-10T14:00:00Z', descricao: 'futura' },
      ],
      documentos: [],
      lancamentos: [
        { id: 'l1', tipo: 'honorario', valor: '1000.00', vencimento: '2026-08-01', status: 'pendente' },
        { id: 'l2', tipo: 'honorario', valor: '500.50', vencimento: '2026-06-01', status: 'pago' },
        { id: 'l3', tipo: 'custo', valor: '99.99', vencimento: null, status: 'cancelado' },
      ],
    });
    expect(f.agenda.futuros.map((c) => c.id)).toEqual(['c2']);
    expect(f.agenda.recentes.map((c) => c.id)).toEqual(['c1']);
    expect(f.financeiro.totalPendente).toBe('1000.00');
    expect(f.financeiro.totalPago).toBe('500.50'); // cancelado fora das somas
  });
});

describe('formatarFicha (texto WhatsApp)', () => {
  it('ficha completa: dados, agenda, documentos, financeiro e rodapé de apoio', () => {
    const txt = formatarFicha(
      fichaDe({
        processo: processoBase(),
        compromissos: [
          { id: 'c1', tipo: 'audiencia', dataHora: '2026-07-15T17:00:00Z', descricao: 'Instrução' },
        ],
        documentos: [{ id: 'd1', nome: 'contrato.pdf', extracaoStatus: 'ok', enviadoEm: '2026-06-01T00:00:00Z' }],
        lancamentos: [
          { id: 'l1', tipo: 'honorario', valor: '1000.00', vencimento: '2026-08-01', status: 'pendente' },
        ],
      }),
    );
    expect(txt).toContain('📁 *Ficha do processo*');
    expect(txt).toContain('nº 00012345620248260100');
    expect(txt).toContain('👤 Cliente: Maria Silva');
    expect(txt).toContain('⚖️ Contra: Empresa X');
    expect(txt).toContain('🏛️ 2ª Vara Cível — São Paulo');
    expect(txt).toContain('fase: conhecimento');
    expect(txt).toContain('instância: 1º grau');
    expect(txt).toContain('audiência 15/07/26'); // hora local BRT (14:00)
    expect(txt).toContain('contrato.pdf');
    expect(txt).toContain('1 pendente(s)');
    expect(txt).toContain('confira nos autos');
  });

  it('FICHA HONESTA: seções vazias aparecem vazias com clareza (não somem)', () => {
    const txt = formatarFicha(
      fichaDe({ processo: processoBase(), compromissos: [], documentos: [], lancamentos: [] }),
    );
    expect(txt).toContain('sem compromissos vinculados ainda.');
    expect(txt).toContain('nenhum vinculado ainda.');
    expect(txt).toContain('sem lançamentos ainda.');
  });

  it('documento por OCR mantém a marca; sem_texto avisa o ponto cego', () => {
    const txt = formatarFicha(
      fichaDe({
        processo: processoBase(),
        compromissos: [],
        documentos: [
          { id: 'd1', nome: 'escaneado.pdf', extracaoStatus: 'ok_ocr', enviadoEm: '2026-06-01T00:00:00Z' },
          { id: 'd2', nome: 'foto.jpg', extracaoStatus: 'sem_texto', enviadoEm: '2026-06-02T00:00:00Z' },
        ],
        lancamentos: [],
      }),
    );
    expect(txt).toContain('escaneado.pdf 🔎 lido por OCR — confira');
    expect(txt).toContain('foto.jpg (conteúdo não lido — escaneado/ilegível)');
  });

  it('anti-paredão: acima do teto vira contagem + oferta de lista', () => {
    const docs = Array.from({ length: 8 }, (_, i) => ({
      id: `d${i}`,
      nome: `doc${i}.pdf`,
      extracaoStatus: 'ok',
      enviadoEm: '2026-06-01T00:00:00Z',
    }));
    const comps = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      tipo: 'prazo',
      dataHora: `2026-07-1${i}T10:00:00Z`,
      descricao: null,
    }));
    const txt = formatarFicha(
      fichaDe({ processo: processoBase(), compromissos: comps, documentos: docs, lancamentos: [] }),
    );
    expect(txt).toContain('*Documentos (8)*');
    expect(txt).toContain('… e mais 3 — quer a lista completa?');
    expect(txt).toContain('… e mais 2 futuros — quer a lista?');
  });

  it('segredo de justiça ganha 🔒; campos nulos são omitidos (sem "—" vazio)', () => {
    const txt = formatarFicha(
      fichaDe({
        processo: processoBase({
          segredoJustica: true,
          vara: null,
          comarca: null,
          valorCausa: null,
          parteContraria: null,
        }),
        compromissos: [],
        documentos: [],
        lancamentos: [],
      }),
    );
    expect(txt).toContain('🔒 segredo de justiça');
    expect(txt).not.toContain('🏛️');
    expect(txt).not.toContain('💵');
    expect(txt).not.toContain('⚖️');
  });
});

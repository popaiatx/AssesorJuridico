import { describe, expect, it } from 'vitest';
import type { Intent } from '../src/core/domain/intents';
import {
  KeywordIntentClassifier,
  normalize,
} from '../src/adapters/classifier/keyword-classifier';

const classifier = new KeywordIntentClassifier();

// Fixture rotulado: casos-chave por intenção, com variações realistas de PT
// (informal, sem acento, abreviações). Cada caso é asserido individualmente.
const FIXTURE: Array<{ text: string; expect: Intent }> = [
  // consulta_dados
  { text: 'quais são meus processos ativos?', expect: 'consulta_dados' },
  { text: 'me mostra meus clientes', expect: 'consulta_dados' },
  { text: 'quantos processos eu tenho', expect: 'consulta_dados' },
  { text: 'lista de processos por favor', expect: 'consulta_dados' },
  // duvida_juridica
  { text: 'o que diz a lei sobre despejo', expect: 'duvida_juridica' },
  { text: 'qual artigo do codigo civil trata disso', expect: 'duvida_juridica' },
  { text: 'tenho direito a ferias proporcionais?', expect: 'duvida_juridica' },
  { text: 'qual o prazo recursal da apelacao', expect: 'duvida_juridica' },
  // consulta_andamento
  { text: 'teve algum andamento no meu processo?', expect: 'consulta_andamento' },
  { text: 'saiu alguma intimacao?', expect: 'consulta_andamento' },
  { text: 'meu processo teve movimentacao?', expect: 'consulta_andamento' },
  { text: 'consultar andamento do 0801234', expect: 'consulta_andamento' },
  // agendar
  { text: 'quero marcar uma audiencia', expect: 'agendar' },
  { text: 'me lembra do prazo amanha', expect: 'agendar' },
  { text: 'agendar reuniao com cliente', expect: 'agendar' },
  { text: 'preciso marcar um compromisso pra sexta', expect: 'agendar' },
  // financeiro
  { text: 'lancar honorarios do caso', expect: 'financeiro' },
  { text: 'preciso cobrar o cliente', expect: 'financeiro' },
  { text: 'quais custas do processo', expect: 'financeiro' },
  { text: 'tenho honorario a receber', expect: 'financeiro' },
  // documento
  { text: 'segue o contrato em pdf', expect: 'documento' },
  { text: 'manda o arquivo da procuracao', expect: 'documento' },
  { text: 'preciso enviar um documento', expect: 'documento' },
  { text: 'voce recebeu meu anexo?', expect: 'documento' },
  // assinatura
  { text: 'quero ver meu plano', expect: 'assinatura' },
  { text: 'como cancelar minha assinatura', expect: 'assinatura' },
  { text: 'qual o valor da mensalidade', expect: 'assinatura' },
  { text: 'quero fazer upgrade do plano', expect: 'assinatura' },
  // ajuda
  { text: 'me ajuda', expect: 'ajuda' },
  { text: 'o que voce faz?', expect: 'ajuda' },
  { text: 'como funciona isso aqui', expect: 'ajuda' },
  { text: 'menu', expect: 'ajuda' },
  // onboarding
  { text: 'quero me cadastrar', expect: 'onboarding' },
  { text: 'sou novo aqui', expect: 'onboarding' },
  // outro (sem match)
  { text: 'oi tudo bem?', expect: 'outro' },
  { text: 'bom dia', expect: 'outro' },
  { text: 'kkk valeu', expect: 'outro' },
];

describe('normalize', () => {
  it('minúsculas, sem acento, espaços colapsados', () => {
    expect(normalize('Dúvida  sobre  Audiência!')).toBe('duvida sobre audiencia!');
  });
});

describe('KeywordIntentClassifier — casos-chave', () => {
  it.each(FIXTURE)('"$text" → $expect', async ({ text, expect: exp }) => {
    const r = await classifier.classify(text);
    expect(r.intent).toBe(exp);
    expect(r.ambiguous).toBe(false);
  });

  it('acurácia agregada ≥ 90% (piso)', async () => {
    let ok = 0;
    for (const c of FIXTURE) {
      const r = await classifier.classify(c.text);
      if (r.intent === c.expect) ok++;
    }
    expect(ok / FIXTURE.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('KeywordIntentClassifier — empate e fallback', () => {
  it('empate no topo → ambíguo com candidatos', async () => {
    // 'ajuda' (2) e 'honorarios' (2) empatam, sem acúmulo de pesos.
    const r = await classifier.classify('preciso de ajuda com honorarios');
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toEqual(expect.arrayContaining(['financeiro', 'ajuda']));
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('sem nenhuma palavra-chave → outro (não ambíguo)', async () => {
    const r = await classifier.classify('blá blá xpto 123');
    expect(r.intent).toBe('outro');
    expect(r.ambiguous).toBe(false);
    expect(r.confidence).toBe(0);
  });

  it('é insensível a acento (mesmo resultado com/sem acento)', async () => {
    const a = await classifier.classify('tenho direito a férias?');
    const b = await classifier.classify('tenho direito a ferias?');
    expect(a.intent).toBe('duvida_juridica');
    expect(b.intent).toBe('duvida_juridica');
  });
});

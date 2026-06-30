/**
 * Decisão sobre o documento (PURO/testável): resumir, salvar ou ambos. A ação vem
 * da LEGENDA (ex.: "resume e guarda") ou da resposta numerada (1/2/3) à pergunta.
 */
export type DocAcao = 'resumir' | 'salvar' | 'ambos';

const RE_RESUMIR = /\bresum/i;
const RE_GUARDAR = /\b(salv|guard|arquiv)/i;

/** Ação a partir de um texto livre (legenda). Null se nada claro. */
export function acaoDoTexto(texto: string): DocAcao | null {
  const t = texto.toLowerCase();
  const resume = RE_RESUMIR.test(t);
  const guarda = RE_GUARDAR.test(t);
  if (resume && guarda) return 'ambos';
  if (resume) return 'resumir';
  if (guarda) return 'salvar';
  return null;
}

/** Ação a partir da resposta à pergunta (1/2/3 ou palavra). Null = re-perguntar. */
export function acaoDaResposta(norm: string): DocAcao | null {
  const digito = norm.replace(/\D/g, '');
  if (digito === '1') return 'resumir';
  if (digito === '2') return 'salvar';
  if (digito === '3') return 'ambos';
  return acaoDoTexto(norm);
}

/** CNJ (20 dígitos) citado na legenda, se houver (ex.: "guarda no processo …"). */
export function cnjDoTexto(texto: string): string | null {
  const digits = texto.replace(/\D/g, '');
  // procura uma sequência de exatamente 20 dígitos no texto (com ou sem máscara)
  const m = texto.match(/(?:\d[.\-\s]*){20}/);
  if (m) {
    const only = m[0].replace(/\D/g, '');
    if (only.length === 20) return only;
  }
  return digits.length === 20 ? digits : null;
}

export const PERGUNTA_DECISAO =
  'Recebi seu documento. O que você quer fazer?\n' +
  '1 - Resumir\n' +
  '2 - Salvar (guardo no seu acervo)\n' +
  '3 - Resumir e salvar';

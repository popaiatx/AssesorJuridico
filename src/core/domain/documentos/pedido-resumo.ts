/**
 * Interpretação PURA do pedido do usuário no intent `documento` (Passo 12C):
 * distingue BUSCAR de RESUMIR e, no resumir, identifica o alvo (ordinal da última
 * lista vs referência por nome/número), o modo (guardado vs novo) e um foco custom.
 * Sem I/O — testável isolado. NÃO resolve o documento (isso é do handler, escopado
 * por tenant); aqui só lê a intenção do texto.
 */

export type AlvoResumo =
  | { tipo: 'ordinal'; indice: number } // 1-based; -1 = "o último"
  | { tipo: 'referencia'; termo: string }; // termo '' => usar o contexto (doc único)

export type PedidoDocumento =
  | { acao: 'buscar'; referencia: string }
  | { acao: 'resumir'; alvo: AlvoResumo; modo: 'guardado' | 'novo'; foco?: string };

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Stems de ordinais por extenso → posição (1-based).
const ORDINAIS: Array<[RegExp, number]> = [
  [/\bprimeir[oa]\b/, 1],
  [/\bsegund[oa]\b/, 2],
  [/\bterceir[oa]\b/, 3],
  [/\bquart[oa]\b/, 4],
  [/\bquint[oa]\b/, 5],
  [/\bsext[oa]\b/, 6],
  [/\bsetim[oa]\b/, 7],
  [/\boitav[oa]\b/, 8],
  [/\bnon[oa]\b/, 9],
  [/\bdecim[oa]\b/, 10],
];

/** A mensagem é um pedido de RESUMO? (verbo "resum*"). */
export function ehPedidoResumo(texto: string): boolean {
  return /\bresum/.test(normalize(texto));
}

/** Extrai o ordinal da última lista, se houver. -1 = "o último". */
function extrairOrdinal(norm: string): number | null {
  if (/\bultim[oa]\b/.test(norm)) return -1;
  for (const [re, n] of ORDINAIS) if (re.test(norm)) return n;
  // numérico SÓ com pista de posição (evita confundir com protocolo/processo):
  //  "o 2", "numero 2", "#2", "2o/2º" — sempre 1–2 dígitos.
  const m =
    /(?:\bnumero\s+|\bo\s+|#)(\d{1,2})\b/.exec(norm) ?? /\b(\d{1,2})\s*[ºo]\b/.exec(norm);
  return m ? Number(m[1]) : null;
}

/** Detecta modo "novo" + foco custom (ex.: "focando nos prazos"). */
function extrairModoFoco(norm: string): { modo: 'guardado' | 'novo'; foco?: string } {
  const fm = /(?:focad[oa]s?|focando|foco|foca)\s+(?:em\s+|n[oa]s?\s+|sobre\s+)?(.+)$/.exec(norm);
  if (fm && fm[1] && fm[1].trim()) return { modo: 'novo', foco: fm[1].trim() };
  if (/\b(detalhad[oa]|mais detalh|a fundo|aprofund|completo|mais long|de novo|novamente)\b/.test(norm)) {
    return { modo: 'novo' };
  }
  return { modo: 'guardado' };
}

/** Remove a cláusula de foco e os verbos/fillers de resumo → sobra a referência. */
function extrairReferencia(texto: string): string {
  return texto
    .replace(/(?:focad[oa]s?|focando|foco|foca)\s+(?:em\s+|n[oa]s?\s+|sobre\s+)?.*$/i, ' ')
    .replace(
      /\b(resum\w*|me|por favor|pf|faz|faca|faça|gera|gere|novamente|de novo|mais|detalhad[oa]s?|completo|a fundo)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Interpreta a mensagem do intent `documento`. */
export function interpretarPedido(texto: string): PedidoDocumento {
  const norm = normalize(texto);
  if (!/\bresum/.test(norm)) return { acao: 'buscar', referencia: texto.trim() };

  const { modo, foco } = extrairModoFoco(norm);
  const ordinal = extrairOrdinal(norm);
  if (ordinal !== null) {
    return foco
      ? { acao: 'resumir', alvo: { tipo: 'ordinal', indice: ordinal }, modo, foco }
      : { acao: 'resumir', alvo: { tipo: 'ordinal', indice: ordinal }, modo };
  }
  const termo = extrairReferencia(texto);
  return foco
    ? { acao: 'resumir', alvo: { tipo: 'referencia', termo }, modo, foco }
    : { acao: 'resumir', alvo: { tipo: 'referencia', termo }, modo };
}

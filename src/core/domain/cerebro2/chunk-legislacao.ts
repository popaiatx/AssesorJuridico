/**
 * Chunking de legislação por ESTRUTURA (artigo), para a citação ser precisa.
 * Puro/testável. Cada trecho = um artigo (com seus parágrafos/incisos no corpo).
 * Granularidade no nível do artigo — suficiente para citar o dispositivo certo;
 * divisão mais fina (parágrafo/inciso) fica como evolução.
 */
export interface ChunkMeta {
  /** Sigla curta para a citação (ex.: "CDC"). */
  sigla?: string;
  identificador: string; // ex.: "Lei nº 8.078/1990"
  fonteUrl: string | null;
}

export interface LegChunk {
  artigo: string;
  paragrafo: string | null;
  inciso: string | null;
  ordem: number;
  texto: string;
  citacao: string;
}

const ART_RE = /\bart(?:igo)?\.?\s*(\d+(?:º|o|°)?(?:-[A-Za-z])?)/gi;

// Teto de caracteres por trecho. O modelo de embeddings tem limite de 8192 TOKENS
// por input; um artigo muito longo (ou um trecho sem marcadores `art.`) precisa ser
// subdividido. ~12k chars fica com folga sob 8192 tokens mesmo em PT-BR acentuado.
const MAX_CHARS = 12000;

/** Quebra um texto longo em pedaços <= max, preferindo cortar em quebra de linha
 *  ou espaço (nunca no meio de palavra). Mantém todo o conteúdo. */
function splitLongo(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const partes: string[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + max, s.length);
    if (end < s.length) {
      const corte = Math.max(s.lastIndexOf('\n', end), s.lastIndexOf(' ', end));
      if (corte > i) end = corte;
    }
    const parte = s.slice(i, end).trim();
    if (parte.length > 0) partes.push(parte);
    i = end;
  }
  return partes.length > 0 ? partes : [s.slice(0, max)];
}

function normalizeNum(raw: string): string {
  const m = raw.match(/^(\d+)(?:º|o|°)?(-[A-Za-z])?$/);
  if (!m) return raw;
  const n = m[1]!;
  const suf = (m[2] ?? '').toUpperCase();
  // Convenção PT-BR: ordinais até 9 usam "º"; a partir de 10, cardinal.
  const base = Number(n) <= 9 ? `${n}º` : n;
  return base + suf;
}

export function chunkLegislacao(texto: string, meta: ChunkMeta): LegChunk[] {
  const matches = [...texto.matchAll(ART_RE)];
  const chunks: LegChunk[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? texto.length) : texto.length;
    const corpo = texto.slice(start, end).trim();
    if (corpo.length < 3) continue;
    const artigo = `art. ${normalizeNum(m[1]!)}`;
    const citacao = meta.sigla
      ? `${artigo} do ${meta.sigla}`
      : `${artigo} — ${meta.identificador}`;
    // Subdivide artigos longos demais para o limite de tokens do embedding. Cada
    // pedaço vira um trecho com a MESMA citação (todos são aquele artigo).
    for (const parte of splitLongo(corpo, MAX_CHARS)) {
      chunks.push({
        artigo,
        paragrafo: null,
        inciso: null,
        ordem: chunks.length + 1,
        texto: parte,
        citacao,
      });
    }
  }
  return chunks;
}

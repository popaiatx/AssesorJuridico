/**
 * Interpretação PURA do pedido de MOVER documento entre pastas (Passo 18) e dos
 * filtros de listagem por pasta. Sem I/O — testável isolado. NÃO resolve
 * documento/processo (isso é do handler, escopado por tenant); aqui só se lê a
 * intenção do texto.
 */

export type AlvoMover =
  | { tipo: 'ordinal'; indice: number } // 1-based; -1 = "o último"
  | { tipo: 'referencia'; termo: string };

export type DestinoMover =
  | { tipo: 'processo'; ref: string } // nº (CNJ/trecho) ou nome do cliente
  | { tipo: 'avulso' } // "tira da pasta"
  | { tipo: 'contexto' }; // "pasta dele" — resolve pela memória (última ficha)

export interface PedidoMover {
  alvo: AlvoMover;
  destino: DestinoMover;
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** A mensagem é um pedido de MOVER/vincular a pasta? */
export function ehPedidoMover(texto: string): boolean {
  const n = normalize(texto);
  if (/\b(move|mova|mover|transfere|transfira)\b/.test(n)) return true;
  if (/\b(tira|tire|solta|solte)\b.*\bpasta\b/.test(n)) return true;
  if (/\bguard\w*\b.*\bna pasta\b/.test(n)) return true; // "guarda na pasta dele"
  return false;
}

const ORDINAIS: Array<[RegExp, number]> = [
  [/\bprimeir[oa]\b/, 1],
  [/\bsegund[oa]\b/, 2],
  [/\bterceir[oa]\b/, 3],
  [/\bquart[oa]\b/, 4],
  [/\bquint[oa]\b/, 5],
];

function alvoDe(parte: string): AlvoMover {
  const n = normalize(parte)
    .replace(/\b(move|mova|mover|transfere|transfira|tira|tire|solta|solte|guarda|guarde|esse|essa|este|esta|o|a)\b/g, ' ')
    .replace(/\bdocumento\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\bultim[oa]\b/.test(n)) return { tipo: 'ordinal', indice: -1 };
  for (const [re, i] of ORDINAIS) if (re.test(n)) return { tipo: 'ordinal', indice: i };
  const num = /^(?:#|numero\s+)?(\d{1,2})$/.exec(n);
  if (num) return { tipo: 'ordinal', indice: Number(num[1]) };
  return { tipo: 'referencia', termo: n };
}

/** null = não parece um mover (deixa o resto do fluxo tratar). */
export function interpretarMover(texto: string): PedidoMover | null {
  if (!ehPedidoMover(texto)) return null;
  const n = normalize(texto);

  // "tira X da pasta" / "solta X da pasta" → avulso
  const tira = /\b(?:tira|tire|solta|solte)\b\s*(.*?)\s*\bd[ae] pasta\b/.exec(n);
  if (tira) return { alvo: alvoDe(tira[1] ?? ''), destino: { tipo: 'avulso' } };

  // "... para a pasta ..." / "... na pasta ..."
  const m = /^(.*?)\s*\b(?:para|pra|na)\s+a?\s*pasta\s*(.*)$/.exec(n);
  if (!m) return null;
  const alvo = alvoDe(m[1] ?? '');
  const resto = (m[2] ?? '').trim();

  if (/^(dele|dela|nele|nela)\b/.test(resto)) return { alvo, destino: { tipo: 'contexto' } };
  const proc = /^d[oa]\s+processo\s+(.+)$/.exec(resto) ?? /^d[oa]\s+(.+)$/.exec(resto);
  const ref = (proc?.[1] ?? resto).trim();
  if (ref === '') return { alvo, destino: { tipo: 'contexto' } };
  return { alvo, destino: { tipo: 'processo', ref } };
}

/** Filtros de LISTAGEM por pasta: "documentos avulsos" / "documentos do processo X". */
export type FiltroPasta = { tipo: 'avulsos' } | { tipo: 'processo'; ref: string };

export function interpretarFiltroPasta(texto: string): FiltroPasta | null {
  const n = normalize(texto);
  if (/^(?:quais\s+|lista(?:r)?\s+|mostra(?:r)?\s+)?(?:os\s+)?(?:documentos?|docs?|arquivos?)\s+(?:avulsos?|soltos?|sem pasta|fora de pasta)\??$/.test(n)) {
    return { tipo: 'avulsos' };
  }
  const m = /^(?:quais\s+|lista(?:r)?\s+|mostra(?:r)?\s+)?(?:os\s+)?(?:documentos?|docs?|arquivos?)\s+(?:da pasta\s+)?d[oa] processo\s+(.+?)\??$/.exec(n);
  if (m) return { tipo: 'processo', ref: m[1]!.trim() };
  return null;
}

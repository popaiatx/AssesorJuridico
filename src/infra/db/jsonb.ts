/**
 * Cura de leitura para jsonb DUPLAMENTE codificado.
 *
 * Bug corrigido no Passo 16: com o postgres.js, `${JSON.stringify(x)}::jsonb`
 * serializa o parâmetro DUAS vezes (o driver aplica o cast e re-serializa a
 * string como JSON) — o banco guarda uma STRING JSON em vez do objeto. A
 * escrita correta é passar o OBJETO (`${x}::jsonb`). Esta função conserta a
 * LEITURA de linhas gravadas antes do fix (e é inócua para linhas corretas).
 */
export function jsonbParse<T>(v: unknown, fallback: T): T {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return (v ?? fallback) as T;
}

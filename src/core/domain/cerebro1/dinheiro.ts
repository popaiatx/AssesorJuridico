/**
 * Dinheiro em CENTAVOS INTEIROS (Passo 16) — nunca float. Puro, sem I/O.
 *
 * `parseValorBRL` interpreta o que o advogado digita ("R$ 10.000,00", "1000",
 * "1.000,50"). Formato AMBÍGUO devolve null — quem chama PERGUNTA em vez de
 * adivinhar (dinheiro errado é pior que uma pergunta a mais).
 */

/** "R$ 10.000,00" | "10000" | "1.000,5" → centavos. null = inválido/ambíguo. */
export function parseValorBRL(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/r\$\s*/g, '').replace(/\s+/g, '');
  if (!/^[\d.,]+$/.test(s) || s.length === 0) return null;

  let inteiro: string;
  let decimal = '';

  if (s.includes(',')) {
    // Vírgula = separador decimal pt-BR; pontos (se houver) são de milhar.
    const [i, d, sobra] = s.split(',');
    if (sobra !== undefined || !d || d.length > 2) return null;
    if (i!.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(i!)) return null; // milhar malformado
    inteiro = i!.replace(/\./g, '');
    decimal = d;
  } else if (s.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      inteiro = s.replace(/\./g, ''); // "1.000" / "10.000.000" = milhar pt-BR
    } else if (/^\d+\.\d{1,2}$/.test(s)) {
      const [i, d] = s.split('.');
      inteiro = i!; // "1000.50" = decimal com ponto (comum no teclado)
      decimal = d!;
    } else {
      return null; // ex.: "1.5000" — ambíguo → pergunta
    }
  } else {
    if (!/^\d+$/.test(s)) return null;
    inteiro = s;
  }

  if (inteiro.length === 0 || inteiro.length > 13) return null; // cabe em numeric(15,2)
  return Number.parseInt(inteiro, 10) * 100 + Number.parseInt(decimal.padEnd(2, '0') || '0', 10);
}

/** Centavos → decimal do Postgres ("123456" ← 1234.56). */
export function centavosParaDecimal(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Decimal do Postgres ("1234.56") → centavos. NaN-safe: null se malformado. */
export function decimalParaCentavos(decimal: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(decimal.trim());
  if (!m) return null;
  const sinal = m[1] === '-' ? -1 : 1;
  return sinal * (Number.parseInt(m[2]!, 10) * 100 + Number.parseInt((m[3] ?? '0').padEnd(2, '0'), 10));
}

/** Centavos → "R$ 1.234,56" (exibição). */
export function formatarCentavos(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

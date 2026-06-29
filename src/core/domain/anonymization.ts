/**
 * Anonimização para o LLM (pura, testável). Fecha o ponto marcado desde o Passo 4.
 *
 * Antes de enviar dados do banco ao LLM (ex.: ao redigir uma listagem), os campos
 * sensíveis (nome de cliente, parte contrária) são substituídos por rótulos
 * estáveis ("Cliente A", "Parte A"). O LLM redige com os rótulos; depois
 * `reidentify` restaura os valores reais localmente, na resposta final.
 */
export interface Anonymizer {
  /** Mascara `value` com um rótulo estável (mesmo valor → mesmo rótulo). */
  mask(value: string, kind?: string): string;
  /** Restaura os valores reais a partir dos rótulos, no texto do LLM. */
  reidentify(text: string): string;
}

function letras(n: number): string {
  // 1→A, 26→Z, 27→AA, ...
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function createAnonymizer(): Anonymizer {
  const placeholderToOriginal = new Map<string, string>();
  const originalToPlaceholder = new Map<string, string>();
  const counters = new Map<string, number>();

  function mask(value: string, kind = 'Item'): string {
    const v = (value ?? '').trim();
    if (!v) return value;
    const existing = originalToPlaceholder.get(v);
    if (existing) return existing;
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    const placeholder = `${kind} ${letras(n)}`;
    originalToPlaceholder.set(v, placeholder);
    placeholderToOriginal.set(placeholder, value);
    return placeholder;
  }

  function reidentify(text: string): string {
    let out = text;
    // Substitui os rótulos mais longos primeiro evita colisões ("Cliente AA" vs "Cliente A").
    const placeholders = [...placeholderToOriginal.keys()].sort((a, b) => b.length - a.length);
    for (const ph of placeholders) {
      out = out.split(ph).join(placeholderToOriginal.get(ph)!);
    }
    return out;
  }

  return { mask, reidentify };
}

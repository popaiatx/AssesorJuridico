/**
 * Fronteira DETERMINÍSTICA do RAG jurídico (pura). Decide o que vira resposta a
 * partir do que foi recuperado e da saída do LLM — o LLM redige, mas NÃO afrouxa
 * a regra de citação.
 *
 * Trata os três tipos de pedido com antialucinação inviolável para afirmações:
 *  A) afirmação jurídica → só sobrevive com `fonte` validada contra o recuperado;
 *  B) orientação geral → exibida, rotulada como apoio (sem dispositivo concreto);
 *  C) sem fonte → resposta transparente e útil (orientação + dispositivos próximos
 *     que EXISTEM no acervo), nunca citação fabricada.
 */
export interface RagTrecho {
  citacao: string;
  texto: string;
  fonteUrl: string | null;
}

export interface RagAfirmacao {
  texto: string;
  fonte: string;
}

export interface LlmRagOutput {
  /** Orientação geral de apoio (sem citar dispositivo concreto). */
  orientacao: string;
  /** Afirmações jurídicas; cada uma DEVE citar uma `fonte` do recuperado. */
  afirmacoes: RagAfirmacao[];
  recusou: boolean;
}

export interface RagComposition {
  reply: string;
  fontesValidas: string[];
}

const DISCLAIMER =
  'ℹ️ Informação de apoio — confira sempre na fonte oficial; não substitui análise profissional.';

export function composeRagReply(input: {
  pertinentes: RagTrecho[];
  aproximados: RagTrecho[];
  llm: LlmRagOutput;
}): RagComposition {
  const { pertinentes, aproximados, llm } = input;

  // Allowlist: afirmação só vale se a fonte estiver entre os trechos recuperados.
  const validSet = new Set(pertinentes.map((t) => t.citacao));
  const validas = llm.recusou ? [] : llm.afirmacoes.filter((a) => validSet.has(a.fonte));
  const fontesValidas = [...new Set(validas.map((a) => a.fonte))];

  const parts: string[] = [];

  if (validas.length > 0) {
    parts.push('📚 Com base no acervo:');
    for (const a of validas) parts.push(`• ${a.texto} (${a.fonte})`);
    const linhas = fontesValidas.map((f) => {
      const t = pertinentes.find((p) => p.citacao === f);
      return t?.fonteUrl ? `${f} — ${t.fonteUrl}` : f;
    });
    parts.push(`Fontes: ${linhas.join('; ')}`);
  }

  const orientacao = llm.orientacao.trim();
  if (orientacao) {
    parts.push(`Orientação geral (de apoio, confira na fonte): ${orientacao}`);
  }

  if (validas.length === 0) {
    // Tipo C (ou A sem fonte): transparente e útil, sem citação fabricada.
    parts.push(
      'Não encontrei no acervo base para *afirmar* isso com citação — então não vou ' +
        'afirmar nada sem fonte.',
    );
    if (aproximados.length > 0) {
      const ptr = aproximados
        .slice(0, 3)
        .map((t) => (t.fonteUrl ? `${t.citacao} (${t.fonteUrl})` : t.citacao));
      parts.push(`Dispositivos próximos no acervo (confira se ajudam): ${ptr.join('; ')}`);
    }
    parts.push('Você pode reformular a pergunta ou conferir direto na fonte oficial.');
  }

  parts.push(DISCLAIMER);
  return { reply: parts.join('\n\n'), fontesValidas };
}

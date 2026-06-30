/**
 * Termos para a BUSCA EXATA de documentos (Passo 12B). Função pura: quebra a
 * referência do usuário em tokens úteis (palavras de conteúdo + fragmentos de
 * número), descartando artigos/preposições e palavras de comando ("busca",
 * "aquele"). Não decide nada de negócio — só prepara os ILIKE da busca exata.
 */

// Artigos, preposições, pronomes e verbos de comando que não ajudam a casar.
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'o', 'a', 'os', 'as', 'e', 'ou', 'em', 'no',
  'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas', 'que', 'com', 'para', 'pra',
  'por', 'ao', 'aos', 'meu', 'minha', 'meus', 'minhas', 'me', 'lo', 'la',
  'aquele', 'aquela', 'aqueles', 'aquelas', 'aquilo', 'esse', 'essa', 'esses',
  'essas', 'este', 'esta', 'isso', 'isto', 'sobre', 'qual', 'quais', 'onde',
  'manda', 'mandar', 'acha', 'achar', 'busca', 'buscar', 'procura', 'procurar',
  'encontra', 'encontrar', 'localiza', 'localizar', 'mostra', 'mostrar', 'ver',
  'quero', 'queria', 'preciso', 'documento', 'documentos', 'arquivo', 'arquivos',
  'aquele', 'tal', 'falamos', 'falei', 'comentamos', 'conversamos',
]);

/**
 * Extrai os tokens de busca da referência. Mantém:
 *  - palavras de conteúdo com 3+ caracteres (fora da stoplist);
 *  - sequências numéricas com 2+ dígitos (fragmento de protocolo/CNJ/processo),
 *    inclusive as embutidas em tokens alfanuméricos.
 * Deduplica preservando a ordem.
 */
export function tokensDeBusca(referencia: string): string[] {
  const bruto = (referencia ?? '').toLowerCase();
  const tokens: string[] = [];
  const vistos = new Set<string>();
  const add = (t: string): void => {
    if (t && !vistos.has(t)) {
      vistos.add(t);
      tokens.push(t);
    }
  };
  for (const raw of bruto.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const digitos = raw.replace(/\D/g, '');
    if (digitos.length >= 2) add(digitos); // fragmento numérico (protocolo etc.)
    if (STOPWORDS.has(raw)) continue;
    const soLetras = /\p{L}/u.test(raw);
    if (soLetras && raw.length >= 3) add(raw); // palavra de conteúdo
  }
  return tokens;
}

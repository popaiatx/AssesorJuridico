/**
 * Detecção DEFENSIVA de revogação de NORMA INTEIRA no texto consolidado do Planalto.
 *
 * Princípio (reforço do 8B): nunca marcar uma norma vigente como revogada por engano.
 * Por isso a detecção é conservadora e atua SÓ no cabeçalho/ementa (antes do primeiro
 * artigo), exigindo a frase clássica "Revogad[ao] (pela|por) Lei/Decreto/MP/Emenda".
 * Assim não confunde com a revogação de ARTIGOS isolados (ex.: "(Revogado)" no corpo)
 * nem com prosa solta ("os atos revogados tinham por objeto..."). Em dúvida → vigente.
 */

// Primeiro artigo: delimita o fim do cabeçalho/ementa. "1\b" casa só "Art. 1"/"1º",
// não "Art. 10"/"Art. 100".
const PRIMEIRO_ARTIGO = /\bart(?:igo)?\.?\s*1\b/i;

// Marcador de revogação da norma inteira, no cabeçalho. Aceita gênero (Revogada/
// Revogado) e "pela/pelo/por", seguido do tipo de norma revogadora.
const REVOGACAO_NORMA =
  /revogad[ao]\s+(?:pel[ao]|por)\s+(?:lei|decreto|medida\s+provis[óo]ria|emenda)/i;

/** True só quando há marcador forte de revogação da norma inteira no cabeçalho. */
export function detectarRevogacaoNorma(texto: string): boolean {
  if (!texto) return false;
  const m = PRIMEIRO_ARTIGO.exec(texto);
  const cabecalho = m ? texto.slice(0, m.index) : texto.slice(0, 1500);
  return REVOGACAO_NORMA.test(cabecalho);
}

/**
 * Heurística PURA de follow-up vs novo assunto (Passo 9). FALHA PARA O LADO SEGURO:
 * na dúvida, trata como NOVO foco (não injeta contexto). Injetar contexto errado
 * faria o assessor responder sobre a lei errada — pior que não resolver uma anáfora.
 *
 * O contexto, quando injetado, SÓ desambigua ("dela" = qual lei); a mensagem atual
 * domina a busca (vai primeiro; o contexto é uma cauda curta). A memória nunca é
 * fonte: o Cérebro 2 segue recuperando e validando citação contra o corpus.
 */
import { fontesRecentes, type RecentContext } from '../conversation/memory.js';

// "Sujeito jurídico próprio" = a mensagem nomeia uma norma CONCRETA → é novo foco,
// não injeta contexto. (Genérico como "o artigo seguinte" NÃO conta como concreto.)
const SIGLA = /\b(cf|cpc|cc|clt|cdc|cp|ctn|eca)\b/i;
const LEI_NUM = /\blei\s+(n[ºo.]|complementar|\d)/i;
const ART_NUM = /\bart(?:igo)?\.?\s*\d/i;
const CODIGO_NOME = /\bc[oó]digo\s+\p{L}+/iu;
const CONSTITUICAO = /\bconstitui[cç][aã]o\b/i;
const SUMULA_NUM = /\bs[uú]mula\s+\d/i;

function temSujeitoProprio(txt: string): boolean {
  return (
    SIGLA.test(txt) ||
    LEI_NUM.test(txt) ||
    ART_NUM.test(txt) ||
    CODIGO_NOME.test(txt) ||
    CONSTITUICAO.test(txt) ||
    SUMULA_NUM.test(txt)
  );
}

// Anáforas / conectores de continuação.
const ANAFORA = /\b(dela|dele|disso|nisso|nela|nele|dessa|desse|seguinte|anterior|mesma|mesmo)\b/i;
const SOBRE_ISSO = /\bsobre\s+isso\b/i;

/**
 * Decide se injeta o contexto da memória para interpretar a mensagem. Conservador:
 * só quando há citações recentes E a mensagem NÃO traz norma concreta E parece
 * follow-up (anáfora, ou curta começando por conector). Na dúvida → false.
 */
export function deveInjetarContexto(message: string, recentContext?: RecentContext): boolean {
  if (!recentContext || fontesRecentes(recentContext.turnos).length === 0) return false;
  const txt = message.trim();
  if (!txt) return false;
  if (temSujeitoProprio(txt)) return false; // assunto próprio → novo foco
  const palavras = txt.split(/\s+/).filter(Boolean).length;
  const comecaConector = /^(e|também|tambem|ainda|além|alem)\b/i.test(txt);
  const temAnafora = ANAFORA.test(txt) || SOBRE_ISSO.test(txt);
  return temAnafora || (palavras <= 6 && comecaConector);
}

/**
 * Consulta de recuperação: a MENSAGEM ATUAL vem primeiro (domina a busca); o
 * contexto (até 2 citações recentes) é uma cauda curta só para desambiguar.
 */
export function montarConsulta(message: string, recentContext: RecentContext): string {
  const fontes = fontesRecentes(recentContext.turnos).slice(0, 2);
  return fontes.length > 0 ? `${message} (${fontes.join('; ')})` : message;
}

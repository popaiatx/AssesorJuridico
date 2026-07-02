/**
 * SUGESTÃO DE PASTA (Passo 18) — parte PURA do match determinístico.
 *
 * O LLM só EXTRAI números (chaves do 12A); aqui normalizamos os candidatos e o
 * código casa contra os processos DO PRÓPRIO tenant (store escopado). O usuário
 * decide — sugerir nunca vincula sozinho.
 */
import type { KeyInfo } from '../../ports/documentos.js';

const MIN_DIGITOS = 4;
const MAX_CANDIDATOS = 8;

/** Números candidatos ao match: só dígitos, ≥4, sem duplicatas (ordem preservada). */
export function numerosCandidatos(chaves: KeyInfo | null): string[] {
  if (!chaves) return [];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const raw of chaves.numeros ?? []) {
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < MIN_DIGITOS || vistos.has(digits)) continue;
    vistos.add(digits);
    out.push(digits);
    if (out.length >= MAX_CANDIDATOS) break;
  }
  return out;
}

/** Primeiro número "FORTE" (CNJ completo, 20 dígitos) — para o aviso honesto
 *  quando o processo mencionado NÃO existe no acervo do assinante. */
export function cnjForte(numeros: string[]): string | null {
  return numeros.find((n) => n.length === 20) ?? null;
}

export interface ProcessoSugestao {
  id: string;
  numeroCnj: string | null;
  clienteNome: string | null;
}

export function rotuloSugestao(p: ProcessoSugestao): string {
  const num = p.numeroCnj ? `processo ${p.numeroCnj}` : 'processo';
  return p.clienteNome ? `${num} (cliente ${p.clienteNome})` : num;
}

/** Pergunta da sugestão ÚNICA (sim/não). */
export function perguntaSugestao(p: ProcessoSugestao): string {
  return `📁 Esse documento menciona o ${rotuloSugestao(p)} — guardo na pasta dele? (responda *sim* ou *não*)`;
}

/** Pergunta quando MAIS DE UM processo casa (lista numerada — nunca adivinha). */
export function perguntaSugestaoMultipla(processos: ProcessoSugestao[]): string {
  const lista = processos.map((p, i) => `${i + 1}) ${rotuloSugestao(p)}`).join('\n');
  return (
    `📁 Esse documento menciona números que casam com mais de um processo seu. ` +
    `Guardo na pasta de qual?\n${lista}\nResponda com o número (ou *não* para deixar avulso).`
  );
}

/** Aviso honesto: CNJ completo lido no documento, mas SEM dono no acervo. */
export function avisoCnjSemDono(cnj: string): string {
  return ` (li o nº ${cnj} no documento, mas não achei esse processo no seu acervo — guardei avulso)`;
}

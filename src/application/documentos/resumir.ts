/**
 * Resumo de documento para o advogado (Passo 12A). Documento LONGO é resumido em
 * PARTES e consolidado (map-reduce), sem quebrar. Contexto mínimo ao LLM. O aviso de
 * apoio/conferência é acrescentado por quem exibe (serviço/handler), não aqui.
 */
import type { LlmPort } from '../../core/ports/llm.js';

const MAX_PEDACO = 10000;

const SYSTEM_RESUMO = [
  'Resuma o documento para um advogado, de forma objetiva: tipo, partes, datas/prazos,',
  'pontos principais e pendências. Baseie-se SOMENTE no texto; não invente.',
].join('\n');

/** Acrescenta um foco custom ao system do resumo (12C — resumo sob demanda). */
function systemComFoco(foco: string | undefined): string {
  const f = (foco ?? '').trim();
  return f ? `${SYSTEM_RESUMO}\nDê atenção especial a: ${f}.` : SYSTEM_RESUMO;
}

const SYSTEM_CONSOLIDA = [
  'Você recebe resumos parciais de um mesmo documento (em ordem). Consolide em um',
  'resumo único e coerente para um advogado (tipo, partes, datas/prazos, pontos,',
  'pendências), sem repetir e sem inventar nada além do que está nos resumos.',
].join('\n');

/** Quebra em pedaços <= max, cortando em espaço/linha (nunca no meio de palavra). */
function splitBySize(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + max, s.length);
    if (end < s.length) {
      const corte = Math.max(s.lastIndexOf('\n', end), s.lastIndexOf(' ', end));
      if (corte > i) end = corte;
    }
    const parte = s.slice(i, end).trim();
    if (parte) out.push(parte);
    i = end;
  }
  return out.length > 0 ? out : [s.slice(0, max)];
}

async function resumirPedaco(llm: LlmPort, texto: string, system: string): Promise<string> {
  const r = await llm.generate({
    system,
    messages: [{ role: 'user', content: texto }],
    maxTokens: 800,
  });
  return r.text.trim();
}

export async function resumir(llm: LlmPort, texto: string, foco?: string): Promise<string> {
  const system = systemComFoco(foco);
  if (texto.length <= MAX_PEDACO) {
    return resumirPedaco(llm, texto, system);
  }
  // Map: resume cada parte (com o foco). Reduce: consolida.
  const partes = splitBySize(texto, MAX_PEDACO);
  const parciais: string[] = [];
  for (const p of partes) parciais.push(await resumirPedaco(llm, p, system));
  return resumirPedaco(llm, parciais.join('\n\n---\n\n'), SYSTEM_CONSOLIDA);
}

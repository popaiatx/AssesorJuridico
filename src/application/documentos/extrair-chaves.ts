/**
 * Extração de INFORMAÇÕES-CHAVE de um documento (Passo 12A) — alimenta a busca do
 * 12B. Uma chamada de LLM com saída estruturada. REGRA DURA: só preenche o que está
 * no texto; campo ausente fica VAZIO ('' ou []), NUNCA por suposição (um número ou
 * nome inventado faria a busca futura achar o documento errado). Contexto mínimo.
 */
import type { KeyInfo } from '../../core/ports/documentos.js';
import type { LlmPort, LlmResponseFormat } from '../../core/ports/llm.js';

// As chaves costumam estar no começo; mandamos um trecho limitado (contexto mínimo).
const MAX_CHARS_CHAVES = 12000;

const SYSTEM = [
  'Você extrai INFORMAÇÕES-CHAVE de um documento jurídico para indexação.',
  'Use SOMENTE o que está escrito no texto. Se um campo NÃO aparece, deixe-o VAZIO',
  '("" para texto, [] para listas). NUNCA invente número, nome, data ou tipo —',
  'um dado inventado é PIOR que vazio. Responda apenas no formato estruturado.',
].join('\n');

const RESPONSE_FORMAT: LlmResponseFormat = {
  type: 'json_schema',
  name: 'chaves_documento',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo: { type: 'string', description: 'Tipo do documento (petição, contrato, intimação…) ou ""' },
      partes: { type: 'array', items: { type: 'string' }, description: 'Pessoas/empresas envolvidas' },
      numeros: { type: 'array', items: { type: 'string' }, description: 'Números de protocolo/processo/CNJ' },
      datas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { data: { type: 'string' }, descricao: { type: 'string' } },
          required: ['data', 'descricao'],
        },
      },
      assunto: { type: 'string' },
      resumo_curto: { type: 'string', description: 'Uma a duas frases' },
    },
    required: ['tipo', 'partes', 'numeros', 'datas', 'assunto', 'resumo_curto'],
  },
};

export function chavesVazias(): KeyInfo {
  return { tipo: '', partes: [], numeros: [], datas: [], assunto: '', resumoCurto: '' };
}

function listaDeStrings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : [];
}

function parseChaves(text: string): KeyInfo {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return chavesVazias(); // truncado/inválido → vazio (nunca inventa)
  }
  const datasRaw = Array.isArray(p.datas) ? p.datas : [];
  const datas = datasRaw
    .filter((d): d is { data?: unknown; descricao?: unknown } => !!d && typeof d === 'object')
    .filter((d) => typeof d.data === 'string' && (d.data as string).trim() !== '')
    .map((d) => ({
      data: String(d.data).trim(),
      descricao: typeof d.descricao === 'string' ? d.descricao.trim() : '',
    }));
  return {
    tipo: typeof p.tipo === 'string' ? p.tipo.trim() : '',
    partes: listaDeStrings(p.partes),
    numeros: listaDeStrings(p.numeros),
    datas,
    assunto: typeof p.assunto === 'string' ? p.assunto.trim() : '',
    resumoCurto: typeof p.resumo_curto === 'string' ? p.resumo_curto.trim() : '',
  };
}

export async function extrairChaves(llm: LlmPort, texto: string): Promise<KeyInfo> {
  const result = await llm.generate({
    system: SYSTEM,
    messages: [{ role: 'user', content: texto.slice(0, MAX_CHARS_CHAVES) }],
    responseFormat: RESPONSE_FORMAT,
    maxTokens: 900,
  });
  return parseChaves(result.text);
}

/** Texto denormalizado para a busca do 12B (partes/números/assunto/resumo/datas). */
export function buscaTextoDe(chaves: KeyInfo): string {
  const partes = [
    chaves.tipo,
    ...chaves.partes,
    ...chaves.numeros,
    chaves.assunto,
    chaves.resumoCurto,
    ...chaves.datas.map((d) => `${d.data} ${d.descricao}`),
  ];
  return partes.map((s) => s.trim()).filter(Boolean).join(' · ');
}

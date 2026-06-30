/**
 * Geração do RAG: o LLM redige DENTRO dos limites — separa `orientacao` (apoio
 * geral, sem dispositivo) de `afirmacoes` (cada uma cita uma `fonte` dos trechos).
 * Contexto mínimo: a pergunta + os trechos recuperados (nada além do top-k).
 */
import type { CorpusTrecho } from '../../core/ports/corpus.js';
import type { LlmRagOutput } from '../../core/domain/cerebro2/rag.js';
import type { LlmPort, LlmResponseFormat } from '../../core/ports/llm.js';

const SYSTEM = [
  'Você é um assistente jurídico. Responda à pergunta do usuário com base nos TRECHOS fornecidos.',
  'REGRAS (invioláveis):',
  '- AFIRMAÇÕES JURÍDICAS (citar lei/artigo/súmula, prazos, base legal) só podem sair dos TRECHOS.',
  '  Cada item de `afirmacoes` deve trazer `fonte` IGUAL ao rótulo do trecho usado (ex.: "art. 6º do CDC").',
  '- Se os trechos não sustentam a resposta, deixe `afirmacoes` vazio e `recusou` = true.',
  '- Você PODE dar `orientacao` geral de apoio (conceitos, estrutura, o que costuma importar)',
  '  SEM citar dispositivo concreto, número de artigo, prazo específico ou súmula (isso é afirmação e exige fonte).',
  '- NUNCA invente número de artigo, lei, súmula ou precedente.',
].join('\n');

const RESPONSE_FORMAT: LlmResponseFormat = {
  type: 'json_schema',
  name: 'resposta_juridica',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      orientacao: { type: 'string' },
      afirmacoes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { texto: { type: 'string' }, fonte: { type: 'string' } },
          required: ['texto', 'fonte'],
        },
      },
      recusou: { type: 'boolean' },
    },
    required: ['orientacao', 'afirmacoes', 'recusou'],
  },
};

export async function ragGenerate(
  llm: LlmPort,
  pergunta: string,
  pertinentes: CorpusTrecho[],
): Promise<LlmRagOutput> {
  const trechos = pertinentes.map((t) => ({ fonte: t.citacao, texto: t.texto }));
  const result = await llm.generate({
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ pergunta, trechos }) }],
    responseFormat: RESPONSE_FORMAT,
    // Folga para a resposta estruturada não ser cortada (várias afirmações +
    // orientação). Se ainda assim vier truncada, o parse degrada com segurança.
    maxTokens: 1500,
  });

  let parsed: Partial<LlmRagOutput>;
  try {
    parsed = JSON.parse(result.text) as Partial<LlmRagOutput>;
  } catch {
    // JSON truncado/ inválido (ex.: estourou maxTokens) → NUNCA derruba o Cérebro 2:
    // degrada para recusa segura (vira resposta transparente tipo C no compose).
    return { orientacao: '', afirmacoes: [], recusou: true };
  }
  const afirmacoes = Array.isArray(parsed.afirmacoes)
    ? parsed.afirmacoes.filter(
        (a): a is { texto: string; fonte: string } =>
          !!a && typeof a.texto === 'string' && typeof a.fonte === 'string',
      )
    : [];
  return {
    orientacao: typeof parsed.orientacao === 'string' ? parsed.orientacao : '',
    afirmacoes,
    recusou: parsed.recusou === true,
  };
}

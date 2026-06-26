/**
 * Classificador de intenção DETERMINÍSTICO (palavras-chave), sem LLM.
 *
 * Estratégia: normaliza o texto (minúsculas, sem acento) e pontua cada intenção
 * por regras de palavra-chave (peso 1 fraca, 2 forte), casadas com fronteira de
 * palavra. A normalização sem acento dá tolerância ao erro mais comum em PT
 * (acento faltando/errado): "dúvida"→"duvida", "audiência"→"audiencia".
 *
 * Regra de decisão:
 *  - maior score único > 0  → essa intenção (confidence = max / soma);
 *  - empate no topo (≥2)     → ambiguous=true, candidates = empatadas;
 *  - nenhum match (max == 0) → 'outro' (fallback), não ambíguo.
 *
 * Não superajustar (handlers ainda são placeholders): cobre os casos-chave e
 * variações realistas; o resto cai em 'outro' honestamente.
 */
import type { Intent } from '../../core/domain/intents.js';
import { INTENTS } from '../../core/domain/intents.js';
import type {
  ClassificationResult,
  IntentClassifier,
} from '../../core/ports/intent-classifier.js';

interface Rule {
  kw: string;
  w: number;
}

// Regras por intenção. 'outro' não tem regras (é o fallback).
const RULES: Record<Exclude<Intent, 'outro'>, Rule[]> = {
  onboarding: [
    { kw: 'cadastro', w: 2 },
    { kw: 'me cadastrar', w: 2 },
    { kw: 'criar conta', w: 2 },
    { kw: 'quero me cadastrar', w: 2 },
    { kw: 'sou novo', w: 1 },
    { kw: 'primeiro acesso', w: 1 },
    { kw: 'comecar', w: 1 },
  ],
  consulta_dados: [
    { kw: 'meus processos', w: 2 },
    { kw: 'meu processo', w: 2 },
    { kw: 'meus casos', w: 2 },
    { kw: 'meus clientes', w: 2 },
    { kw: 'meu cliente', w: 1 },
    { kw: 'quais processos', w: 2 },
    { kw: 'quantos processos', w: 2 },
    { kw: 'lista de processos', w: 2 },
    { kw: 'lista de clientes', w: 2 },
    { kw: 'processos ativos', w: 2 },
    { kw: 'meus dados', w: 1 },
    { kw: 'ver processo', w: 1 },
  ],
  duvida_juridica: [
    { kw: 'lei', w: 2 },
    { kw: 'artigo', w: 2 },
    { kw: 'codigo civil', w: 2 },
    { kw: 'codigo penal', w: 2 },
    { kw: 'direito civil', w: 2 },
    { kw: 'direito penal', w: 2 },
    { kw: 'cpc', w: 2 },
    { kw: 'clt', w: 2 },
    { kw: 'jurisprudencia', w: 2 },
    { kw: 'sumula', w: 2 },
    { kw: 'constituicao', w: 2 },
    { kw: 'tenho direito', w: 2 },
    { kw: 'o que diz a lei', w: 2 },
    { kw: 'prazo legal', w: 2 },
    { kw: 'prazo recursal', w: 2 },
    { kw: 'e legal', w: 1 },
    { kw: 'usucapiao', w: 1 },
    { kw: 'habeas corpus', w: 1 },
  ],
  consulta_andamento: [
    { kw: 'andamento', w: 2 },
    { kw: 'movimentacao', w: 2 },
    { kw: 'movimentou', w: 2 },
    { kw: 'novidade no processo', w: 2 },
    { kw: 'atualizacao do processo', w: 2 },
    { kw: 'intimacao', w: 2 },
    { kw: 'publicacao', w: 2 },
    { kw: 'despacho', w: 2 },
    { kw: 'foi julgado', w: 2 },
    { kw: 'consultar andamento', w: 2 },
    { kw: 'sentenca', w: 1 },
    { kw: 'houve atualizacao', w: 1 },
  ],
  agendar: [
    { kw: 'agendar', w: 2 },
    { kw: 'marcar', w: 2 },
    { kw: 'audiencia', w: 2 },
    { kw: 'reuniao', w: 2 },
    { kw: 'compromisso', w: 2 },
    { kw: 'lembrete', w: 2 },
    { kw: 'me lembra', w: 2 },
    { kw: 'remarcar', w: 2 },
    { kw: 'agendamento', w: 2 },
    { kw: 'agenda', w: 1 },
    { kw: 'anota', w: 1 },
    { kw: 'prazo', w: 1 },
  ],
  financeiro: [
    { kw: 'honorario', w: 2 },
    { kw: 'honorarios', w: 2 },
    { kw: 'custas', w: 2 },
    { kw: 'cobranca', w: 2 },
    { kw: 'cobrar', w: 2 },
    { kw: 'a receber', w: 2 },
    { kw: 'valor a receber', w: 2 },
    { kw: 'despesa', w: 2 },
    { kw: 'pagamento do cliente', w: 2 },
    { kw: 'reembolso', w: 1 },
    { kw: 'custo', w: 1 },
    { kw: 'recebi', w: 1 },
  ],
  documento: [
    { kw: 'documento', w: 2 },
    { kw: 'documentos', w: 2 },
    { kw: 'arquivo', w: 2 },
    { kw: 'pdf', w: 2 },
    { kw: 'anexo', w: 2 },
    { kw: 'contrato', w: 2 },
    { kw: 'procuracao', w: 2 },
    { kw: 'comprovante', w: 2 },
    { kw: 'manda o arquivo', w: 2 },
    { kw: 'enviar documento', w: 2 },
    { kw: 'peticao', w: 1 },
    { kw: 'foto', w: 1 },
  ],
  assinatura: [
    { kw: 'assinatura', w: 2 },
    { kw: 'meu plano', w: 2 },
    { kw: 'mensalidade', w: 2 },
    { kw: 'cancelar assinatura', w: 2 },
    { kw: 'cancelar meu plano', w: 2 },
    { kw: 'mudar de plano', w: 2 },
    { kw: 'trocar plano', w: 2 },
    { kw: 'renovar assinatura', w: 2 },
    { kw: 'pagar a assinatura', w: 2 },
    { kw: 'upgrade', w: 2 },
    { kw: 'minha conta', w: 1 },
    { kw: 'plano', w: 1 },
  ],
  ajuda: [
    { kw: 'ajuda', w: 2 },
    { kw: 'help', w: 2 },
    { kw: 'o que voce faz', w: 2 },
    { kw: 'o que vc faz', w: 2 },
    { kw: 'como funciona', w: 2 },
    { kw: 'o que da pra fazer', w: 2 },
    { kw: 'o que voce pode fazer', w: 2 },
    { kw: 'menu', w: 2 },
    { kw: 'comandos', w: 2 },
    { kw: 'socorro', w: 1 },
  ],
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pré-compila as regras em regex com fronteira de palavra.
const COMPILED: Array<{ intent: Intent; re: RegExp; w: number }> = Object.entries(
  RULES,
).flatMap(([intent, rules]) =>
  rules.map((r) => ({
    intent: intent as Intent,
    re: new RegExp(`(^|\\W)${escapeRegex(r.kw)}(\\W|$)`),
    w: r.w,
  })),
);

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (diacríticos combinantes)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export class KeywordIntentClassifier implements IntentClassifier {
  classify(text: string): Promise<ClassificationResult> {
    const norm = normalize(text);
    const scores = new Map<Intent, number>();
    for (const { intent, re, w } of COMPILED) {
      if (re.test(norm)) {
        scores.set(intent, (scores.get(intent) ?? 0) + w);
      }
    }

    let max = 0;
    for (const v of scores.values()) if (v > max) max = v;

    if (max === 0) {
      return Promise.resolve({
        intent: 'outro',
        confidence: 0,
        candidates: ['outro'],
        ambiguous: false,
      });
    }

    // Empatadas no topo, em ordem canônica de INTENTS (determinístico).
    const tied = INTENTS.filter((i) => scores.get(i) === max);
    let total = 0;
    for (const v of scores.values()) total += v;
    const confidence = max / total;

    const intent = tied[0] as Intent;
    if (tied.length > 1) {
      return Promise.resolve({ intent, confidence, candidates: tied, ambiguous: true });
    }
    return Promise.resolve({ intent, confidence, candidates: [intent], ambiguous: false });
  }
}

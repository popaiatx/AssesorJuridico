/**
 * Classificador de intenção via LLM (primeiro uso real do LLM).
 *
 * Usa saída estruturada (JSON Schema) para obter `{intent, confidence}`. É
 * robusto: se o LLM falhar (erro, JSON inválido, intenção desconhecida), delega
 * ao `KeywordIntentClassifier` (fallback). Contexto mínimo ao LLM — vai só o
 * texto da mensagem + system prompt; nenhum dado de assinante.
 */
import type { Intent } from '../../core/domain/intents.js';
import { INTENTS, INTENT_LABEL } from '../../core/domain/intents.js';
import type {
  ClassificationResult,
  IntentClassifier,
} from '../../core/ports/intent-classifier.js';
import type { LlmPort, LlmResponseFormat } from '../../core/ports/llm.js';

const AMBIGUOUS_THRESHOLD = 0.5;

const SYSTEM_PROMPT = [
  'Você classifica a intenção de mensagens de advogados num assistente jurídico no WhatsApp.',
  'Escolha UMA intenção da lista e dê uma confiança de 0 a 1.',
  'Responda apenas no formato estruturado pedido. Intenções:',
  ...INTENTS.map((i) => `- ${i}: ${INTENT_LABEL[i]}`),
].join('\n');

const RESPONSE_FORMAT: LlmResponseFormat = {
  type: 'json_schema',
  name: 'intent_classification',
  schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: [...INTENTS] },
      confidence: { type: 'number' },
    },
    required: ['intent', 'confidence'],
    additionalProperties: false,
  },
};

function isIntent(value: unknown): value is Intent {
  return typeof value === 'string' && (INTENTS as readonly string[]).includes(value);
}

export class LlmIntentClassifier implements IntentClassifier {
  constructor(
    private readonly llm: LlmPort,
    private readonly fallback: IntentClassifier,
  ) {}

  async classify(text: string): Promise<ClassificationResult> {
    try {
      const result = await this.llm.generate({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
        maxTokens: 256,
        responseFormat: RESPONSE_FORMAT,
      });
      const parsed = JSON.parse(result.text) as { intent?: unknown; confidence?: unknown };
      if (!isIntent(parsed.intent)) {
        return this.fallback.classify(text);
      }
      const confidence =
        typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
      return {
        intent: parsed.intent,
        confidence,
        candidates: [parsed.intent],
        ambiguous: confidence < AMBIGUOUS_THRESHOLD,
      };
    } catch {
      // Qualquer falha (rede, JSON inválido, etc.) → fallback determinístico.
      return this.fallback.classify(text);
    }
  }
}

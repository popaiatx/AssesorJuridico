/**
 * Port de CLASSIFICAÇÃO DE INTENÇÃO. A implementação atual é determinística
 * (palavras-chave), sem LLM. A interface é assíncrona para, no futuro, permitir
 * um classificador via `LlmPort` sem mudar o orquestrador.
 */
import type { RecentContext } from '../domain/conversation/memory.js';
import type { Intent } from '../domain/intents.js';

export interface ClassificationResult {
  /** Melhor intenção. Em caso de empate, é a primeira de `candidates`. */
  intent: Intent;
  /** Confiança normalizada [0..1] (heurística do classificador). */
  confidence: number;
  /** Quando ambíguo, as intenções empatadas no topo; senão, `[intent]`. */
  candidates: Intent[];
  /** True quando há empate real no topo → o orquestrador deve PERGUNTAR. */
  ambiguous: boolean;
}

export interface IntentClassifier {
  /**
   * Classifica a intenção. `recentContext` (opcional) é a memória de conversa para
   * desambiguar follow-ups curtos; implementações determinísticas podem ignorá-lo.
   */
  classify(text: string, recentContext?: RecentContext): Promise<ClassificationResult>;
}

import type { Intent } from '../src/core/domain/intents';
import { INTENTS } from '../src/core/domain/intents';
import type { HandlerRegistry, IntentHandler } from '../src/core/orchestration/handler';
import type {
  ClassificationResult,
  IntentClassifier,
} from '../src/core/ports/intent-classifier';
import type {
  InteractionLogEntry,
  InteractionLogPort,
} from '../src/core/ports/interaction-log';
import type { InboundMessage } from '../src/core/ports/whatsapp';

export function makeMessage(text: string, from = '+5511999990001'): InboundMessage {
  return { messageId: 'msg-1', from, text, timestamp: '2026-06-26T12:00:00.000Z' };
}

/** Classificador de teste com resultado fixo e contador de chamadas. */
export class FakeClassifier implements IntentClassifier {
  public calls = 0;
  constructor(private readonly result: ClassificationResult) {}
  classify(): Promise<ClassificationResult> {
    this.calls++;
    return Promise.resolve(this.result);
  }
}

/** Registro de handlers espiões: cada chamada empurra a intenção em `calls`. */
export function spyRegistry(calls: Intent[]): HandlerRegistry {
  const m = new Map<Intent, IntentHandler>();
  for (const intent of INTENTS) {
    m.set(intent, {
      intent,
      handle: () => {
        calls.push(intent);
        return Promise.resolve({ replyText: `handled:${intent}` });
      },
    });
  }
  return m;
}

/** Log de interação em memória (para asserções, sem banco). */
export class InMemoryInteractionLog implements InteractionLogPort {
  public entries: InteractionLogEntry[] = [];
  record(entry: InteractionLogEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

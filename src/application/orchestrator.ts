/**
 * Orquestrador — a porta de entrada (ver skill whatsapp-orquestracao).
 *
 * Fluxo de cada mensagem:
 *  1. resolve telefone → assinante_id (caminho pré-tenant);
 *  2. telefone desconhecido → intenção `onboarding` (sem classificar);
 *  3. classifica a intenção;
 *  4. se ambígua → PERGUNTA em linguagem natural (R-A), sem acionar nada;
 *  5. senão roteia para UM único handler (um-cérebro-por-mensagem);
 *  6. registra a interação;
 *  7. devolve a resposta a enviar (o envio é responsabilidade do canal).
 *
 * Não depende de WhatsApp real nem de LLM; tudo via ports injetados.
 */
import type { Intent } from '../core/domain/intents.js';
import { INTENT_LABEL } from '../core/domain/intents.js';
import type { HandlerResult, HandlerRegistry, MessageContext } from '../core/orchestration/handler.js';
import type { IntentClassifier } from '../core/ports/intent-classifier.js';
import type { InteractionLogPort } from '../core/ports/interaction-log.js';
import type { SubscriptionGate } from '../core/ports/subscription-gate.js';
import type { InboundMessage } from '../core/ports/whatsapp.js';

/** Resolve a identidade do assinante a partir do telefone (pré-tenant, R4). */
export type ResolveAssinante = (phone: string) => Promise<string | null>;

/** Handler para onde o porteiro desvia quando o acesso está bloqueado. */
export interface BlockedHandler {
  handle(ctx: MessageContext): Promise<HandlerResult>;
}

export interface OrchestratorResult {
  assinanteId: string | null;
  intent: Intent;
  ambiguous: boolean;
  replyText: string;
}

export interface OrchestratorDeps {
  resolveAssinante: ResolveAssinante;
  classifier: IntentClassifier;
  registry: HandlerRegistry;
  interactionLog: InteractionLogPort;
  /** Porteiro de acesso (opcional). Sem ele, não há bloqueio. */
  gate?: SubscriptionGate;
  /** Handler de pagamento, acionado quando o porteiro bloqueia. */
  paymentRequiredHandler?: BlockedHandler;
  /** Relógio injetável (default: agora). */
  clock?: () => Date;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async handleInboundMessage(message: InboundMessage): Promise<OrchestratorResult> {
    const assinanteId = await this.deps.resolveAssinante(message.from);

    // Pré-tenant: telefone desconhecido → onboarding, sem classificar.
    if (assinanteId === null) {
      const replyText = await this.runHandler('onboarding', { assinanteId, intent: 'onboarding', message });
      await this.record(assinanteId, 'onboarding');
      return { assinanteId, intent: 'onboarding', ambiguous: false, replyText };
    }

    // PORTEIRO (fail-closed): sem confirmação positiva de acesso, desvia TUDO
    // para o fluxo de pagamento — independentemente do que a pessoa pediu.
    // (Onboarding acima e o próprio pagamento continuam acessíveis.)
    if (this.deps.gate && this.deps.paymentRequiredHandler) {
      const decision = await this.deps.gate.evaluate(assinanteId, this.now());
      if (!decision.allowed) {
        const { replyText } = await this.deps.paymentRequiredHandler.handle({
          assinanteId,
          intent: 'assinatura',
          message,
        });
        await this.record(assinanteId, 'assinatura');
        return { assinanteId, intent: 'assinatura', ambiguous: false, replyText };
      }
    }

    const result = await this.deps.classifier.classify(message.text);

    // Ambíguo: pergunta em vez de adivinhar. Nenhum handler de negócio acionado.
    if (result.ambiguous) {
      const replyText = this.buildClarification(result.candidates);
      await this.record(assinanteId, result.intent);
      return { assinanteId, intent: result.intent, ambiguous: true, replyText };
    }

    const intent = result.intent;
    const replyText = await this.runHandler(intent, { assinanteId, intent, message });
    await this.record(assinanteId, intent);
    return { assinanteId, intent, ambiguous: false, replyText };
  }

  private now(): Date {
    return (this.deps.clock ?? (() => new Date()))();
  }

  /** Roteia para EXATAMENTE um handler. Fallback seguro para 'outro'. */
  private async runHandler(intent: Intent, ctx: MessageContext): Promise<string> {
    const handler = this.deps.registry.get(intent) ?? this.deps.registry.get('outro');
    if (!handler) {
      // Registro incompleto é bug de programação (completude é testada).
      throw new Error(`Sem handler para a intenção "${intent}" e sem fallback "outro".`);
    }
    const { replyText } = await handler.handle(ctx);
    return replyText;
  }

  /** Mensagem de desambiguação em linguagem natural (R-A): nunca nomes internos. */
  private buildClarification(candidates: Intent[]): string {
    const labels = candidates.map((c) => INTENT_LABEL[c]);
    let list: string;
    if (labels.length <= 1) {
      list = labels[0] ?? 'me dar mais detalhes';
    } else {
      list = `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1]}`;
    }
    return `Só para eu te ajudar do jeito certo: você quer ${list}? Pode me explicar com mais detalhes?`;
  }

  /**
   * Registra a interação. cerebro=null neste passo (placeholders não acionam
   * cérebro); entrada/saida ficam fora até existir anonimização.
   */
  private record(assinanteId: string | null, intent: Intent): Promise<void> {
    return this.deps.interactionLog.record({
      assinanteId,
      intent,
      cerebro: null,
      anonimizado: false,
      fontesCitadas: [],
    });
  }
}

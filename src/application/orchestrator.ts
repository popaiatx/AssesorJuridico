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
import { isWarm, trimTurnos, type RecentContext } from '../core/domain/conversation/memory.js';
import type { Intent } from '../core/domain/intents.js';
import { INTENT_LABEL } from '../core/domain/intents.js';
import type {
  HandlerResult,
  HandlerRegistry,
  MessageContext,
} from '../core/orchestration/handler.js';
import type {
  ConversationMemoryStore,
  ConversationTurn,
} from '../core/ports/conversation-memory.js';
import type { IntentClassifier } from '../core/ports/intent-classifier.js';
import type { InteractionLogPort } from '../core/ports/interaction-log.js';
import type { SubscriptionGate } from '../core/ports/subscription-gate.js';
import type { InboundMessage } from '../core/ports/whatsapp.js';

/** Resolve a identidade do assinante a partir do telefone (pré-tenant, R4). */
export type ResolveAssinante = (phone: string) => Promise<string | null>;

const MEDIA_PLACEHOLDER =
  '📎 Recebi seu arquivo, mas o processamento de documentos ainda está em ' +
  'desenvolvimento. Em breve poderei lê-lo e guardá-lo. 🚧';

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
  /**
   * Decisão sobre documento pendente (Passo 12A). Se devolver texto, a mensagem é a
   * resposta 1/2/3 a um documento aguardando decisão → responde sem classificar. Null
   * = não há documento pendente; segue o fluxo normal. Sem a dep, fluxo idêntico.
   */
  documentDecision?: (assinanteId: string, text: string) => Promise<string | null>;
  /**
   * Documento recebido (mídia). Recebe os bytes (baixa internamente) e responde
   * (resumir/salvar/perguntar). Roda APÓS o porteiro (um bloqueado não processa
   * arquivo). Sem a dep → placeholder honesto.
   */
  incomingDocument?: (assinanteId: string, message: InboundMessage) => Promise<string>;
  /** Memória de conversa (opcional). Sem ela, o fluxo é idêntico ao atual. */
  memory?: ConversationMemoryStore;
  /** Config da memória; sem ela (ou enabled=false), a memória fica inativa. */
  memoriaConfig?: { enabled: boolean; turnos: number; ttlMin: number };
  /** Relógio injetável (default: agora). */
  clock?: () => Date;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async handleInboundMessage(message: InboundMessage): Promise<OrchestratorResult> {
    const assinanteId = await this.deps.resolveAssinante(message.from);

    // Pré-tenant: telefone desconhecido → onboarding, sem classificar.
    if (assinanteId === null) {
      const result = await this.runHandler('onboarding', { assinanteId, intent: 'onboarding', message });
      await this.record(assinanteId, 'onboarding', result);
      return { assinanteId, intent: 'onboarding', ambiguous: false, replyText: result.replyText };
    }

    // PORTEIRO (fail-closed): sem confirmação positiva de acesso, desvia TUDO
    // para o fluxo de pagamento — independentemente do que a pessoa pediu.
    // (Onboarding acima e o próprio pagamento continuam acessíveis.)
    if (this.deps.gate && this.deps.paymentRequiredHandler) {
      const decision = await this.deps.gate.evaluate(assinanteId, this.now());
      if (!decision.allowed) {
        const result = await this.deps.paymentRequiredHandler.handle({
          assinanteId,
          intent: 'assinatura',
          message,
        });
        await this.record(assinanteId, 'assinatura', result);
        return { assinanteId, intent: 'assinatura', ambiguous: false, replyText: result.replyText };
      }
    }

    // Mídia (documento): tratada após o porteiro. Sem handler → placeholder honesto.
    if (message.media) {
      const reply = this.deps.incomingDocument
        ? await this.deps.incomingDocument(assinanteId, message)
        : MEDIA_PLACEHOLDER;
      await this.record(assinanteId, 'outro');
      return { assinanteId, intent: 'outro', ambiguous: false, replyText: reply };
    }

    // Documento aguardando decisão? A resposta 1/2/3 resolve antes de classificar.
    if (this.deps.documentDecision) {
      const docReply = await this.deps.documentDecision(assinanteId, message.text);
      if (docReply !== null) {
        await this.record(assinanteId, 'outro');
        return { assinanteId, intent: 'outro', ambiguous: false, replyText: docReply };
      }
    }

    // Memória de conversa (se ativa e quente): cauda curta p/ interpretar a mensagem.
    const memoriaTurnos = await this.loadWarmMemory(assinanteId);
    const recentContext: RecentContext | undefined =
      memoriaTurnos.length > 0 ? { turnos: memoriaTurnos } : undefined;

    const result = await this.deps.classifier.classify(message.text, recentContext);

    // Ambíguo: pergunta em vez de adivinhar. Nenhum handler de negócio acionado.
    if (result.ambiguous) {
      const replyText = this.buildClarification(result.candidates);
      await this.record(assinanteId, result.intent);
      return { assinanteId, intent: result.intent, ambiguous: true, replyText };
    }

    const intent = result.intent;
    const ctx: MessageContext = recentContext
      ? { assinanteId, intent, message, recentContext }
      : { assinanteId, intent, message };
    const handled = await this.runHandler(intent, ctx);
    await this.record(assinanteId, intent, handled);
    await this.appendMemory(assinanteId, memoriaTurnos, intent, handled);
    return { assinanteId, intent, ambiguous: false, replyText: handled.replyText };
  }

  /** Lê a memória; se fria (TTL) ou inativa, devolve [] (e limpa a fria). */
  private async loadWarmMemory(assinanteId: string): Promise<ConversationTurn[]> {
    const memory = this.deps.memory;
    const cfg = this.deps.memoriaConfig;
    if (!memory || !cfg?.enabled) return [];
    const stored = await memory.load(assinanteId);
    if (!isWarm(stored.atualizadoEm, this.now(), cfg.ttlMin)) {
      if (stored.turnos.length > 0) await memory.clear(assinanteId);
      return [];
    }
    return trimTurnos(stored.turnos, cfg.turnos);
  }

  /** Anexa o turno do usuário + do assistente (só intenção + citações públicas). */
  private async appendMemory(
    assinanteId: string,
    anteriores: ConversationTurn[],
    intent: Intent,
    handled: HandlerResult,
  ): Promise<void> {
    const memory = this.deps.memory;
    const cfg = this.deps.memoriaConfig;
    if (!memory || !cfg?.enabled) return;
    const em = this.now().toISOString();
    const assistant: ConversationTurn = { papel: 'assistant', intent, fontes: handled.fontesCitadas ?? [], em };
    // 12C: guarda os ids listados (ordem) para resolver "resume o segundo" depois.
    if (handled.documentosListados && handled.documentosListados.length > 0) {
      assistant.docIds = handled.documentosListados;
    }
    const novos: ConversationTurn[] = [{ papel: 'user', intent, em }, assistant];
    const turnos = trimTurnos([...anteriores, ...novos], cfg.turnos);
    await memory.save(assinanteId, turnos);
  }

  private now(): Date {
    return (this.deps.clock ?? (() => new Date()))();
  }

  /** Roteia para EXATAMENTE um handler. Fallback seguro para 'outro'. */
  private async runHandler(intent: Intent, ctx: MessageContext): Promise<HandlerResult> {
    const handler = this.deps.registry.get(intent) ?? this.deps.registry.get('outro');
    if (!handler) {
      // Registro incompleto é bug de programação (completude é testada).
      throw new Error(`Sem handler para a intenção "${intent}" e sem fallback "outro".`);
    }
    return handler.handle(ctx);
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
   * Registra a interação. O cérebro e as fontes citadas vêm do handler (ex.: RAG);
   * entrada/saida ficam fora até existir anonimização do conteúdo.
   */
  private record(
    assinanteId: string | null,
    intent: Intent,
    result?: HandlerResult,
  ): Promise<void> {
    return this.deps.interactionLog.record({
      assinanteId,
      intent,
      cerebro: result?.cerebro ?? null,
      anonimizado: false,
      fontesCitadas: result?.fontesCitadas ?? [],
    });
  }
}

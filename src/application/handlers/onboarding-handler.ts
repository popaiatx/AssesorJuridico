/**
 * Handler de ONBOARDING (intenção `onboarding`, acionada para número novo).
 *
 * Conduz a máquina de estados determinística: carrega o estado por telefone,
 * avança com `advanceOnboarding` (puro), persiste, audita e, na etapa final,
 * cria o assinante (trial) pelo ponto único controlado. Criado o assinante, a
 * próxima mensagem do telefone resolve para o tenant e segue o caminho normal.
 */
import { advanceOnboarding, CONSENT_VERSION, TRIAL_DIAS } from '../../core/domain/onboarding.js';
import type { HandlerResult, IntentHandler, MessageContext } from '../../core/orchestration/handler.js';
import type { Intent } from '../../core/domain/intents.js';
import type { AssinanteCreator } from '../../core/ports/assinante-creator.js';
import type { OnboardingStore } from '../../core/ports/onboarding-store.js';
import type { PreTenantAuditPort } from '../../core/ports/pre-tenant-audit.js';

export interface OnboardingHandlerDeps {
  store: OnboardingStore;
  audit: PreTenantAuditPort;
  createAssinante: AssinanteCreator;
}

export class OnboardingHandler implements IntentHandler {
  readonly intent: Intent = 'onboarding';

  constructor(private readonly deps: OnboardingHandlerDeps) {}

  async handle(ctx: MessageContext): Promise<HandlerResult> {
    const phone = ctx.message.from;
    const state = await this.deps.store.get(phone);
    const outcome = advanceOnboarding(state, ctx.message.text);

    if (outcome.kind === 'criar') {
      await this.deps.createAssinante({
        telefone: phone,
        nome: outcome.dados.nome,
        email: outcome.dados.email,
        consentVersao: CONSENT_VERSION,
        canal: 'whatsapp',
        trialDias: TRIAL_DIAS,
      });
      await this.deps.store.clear(phone);
      await this.deps.audit.record({ phone, etapa: 'concluido', evento: outcome.evento });
      return { replyText: outcome.reply };
    }

    await this.deps.store.save(phone, { etapa: outcome.etapa, dados: outcome.dados });
    await this.deps.audit.record({ phone, etapa: outcome.etapa, evento: outcome.evento });
    return { replyText: outcome.reply };
  }
}

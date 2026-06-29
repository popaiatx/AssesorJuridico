import { describe, expect, it } from 'vitest';
import { OnboardingHandler } from '../src/application/handlers/onboarding-handler';
import { Orchestrator } from '../src/application/orchestrator';
import { buildDefaultRegistry } from '../src/application/handlers/placeholder-handlers';
import type { MessageContext } from '../src/core/orchestration/handler';
import type { OnboardingState } from '../src/core/domain/onboarding';
import type { OnboardingStore } from '../src/core/ports/onboarding-store';
import type { CreateAssinanteInput } from '../src/core/ports/assinante-creator';
import type { PreTenantAuditEvent } from '../src/core/ports/pre-tenant-audit';
import { FakeClassifier, InMemoryInteractionLog, makeMessage } from './helpers';

class InMemoryStore implements OnboardingStore {
  private m = new Map<string, OnboardingState>();
  get(phone: string): Promise<OnboardingState | null> {
    return Promise.resolve(this.m.get(phone) ?? null);
  }
  save(phone: string, state: OnboardingState): Promise<void> {
    this.m.set(phone, state);
    return Promise.resolve();
  }
  clear(phone: string): Promise<void> {
    this.m.delete(phone);
    return Promise.resolve();
  }
}

function ctx(text: string, from = '5511999990001'): MessageContext {
  return { assinanteId: null, intent: 'onboarding', message: makeMessage(text, from) };
}

function build() {
  const store = new InMemoryStore();
  const audit: PreTenantAuditEvent[] = [];
  const created: CreateAssinanteInput[] = [];
  const handler = new OnboardingHandler({
    store,
    audit: { record: (e) => (audit.push(e), Promise.resolve()) },
    createAssinante: (i) => {
      created.push(i);
      return Promise.resolve('novo-id');
    },
  });
  return { handler, store, audit, created };
}

describe('OnboardingHandler', () => {
  it('conduz o fluxo completo e cria o assinante no aceite', async () => {
    const { handler, store, audit, created } = build();
    const phone = '5511999990001';

    await handler.handle(ctx('oi')); // primeiro contato
    await handler.handle(ctx('Maria Silva'));
    await handler.handle(ctx('123456/SP'));
    await handler.handle(ctx('111.444.777-35'));
    await handler.handle(ctx('maria@adv.com'));
    const final = await handler.handle(ctx('aceito'));

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      telefone: phone,
      nome: 'Maria Silva',
      oabNumero: '123456',
      oabSeccional: 'SP',
      documento: '11144477735',
      email: 'maria@adv.com',
      consentVersao: '1.0',
      canal: 'whatsapp',
    });
    expect(await store.get(phone)).toBeNull(); // estado limpo
    expect(audit.at(-1)).toEqual({ phone, etapa: 'concluido', evento: 'consentiu' });
    expect(final.replyText.toLowerCase()).toContain('trial');
  });

  it('persiste o estado entre mensagens e audita cada etapa', async () => {
    const { handler, store, audit } = build();
    await handler.handle(ctx('oi'));
    expect((await store.get('5511999990001'))?.etapa).toBe('aguardando_nome');
    await handler.handle(ctx('Maria'));
    expect((await store.get('5511999990001'))?.etapa).toBe('aguardando_oab');
    expect(audit.map((e) => e.evento)).toContain('validou_nome');
  });
});

describe('transição número-desconhecido → onboarding → assinante → tenant', () => {
  it('após criar, a próxima mensagem segue o caminho de tenant', async () => {
    const flag = { created: false };
    const store = new InMemoryStore();
    const handler = new OnboardingHandler({
      store,
      audit: { record: () => Promise.resolve() },
      createAssinante: () => {
        flag.created = true;
        return Promise.resolve('assinante-id');
      },
    });
    const orch = new Orchestrator({
      resolveAssinante: () => Promise.resolve(flag.created ? 'assinante-id' : null),
      classifier: new FakeClassifier({ intent: 'ajuda', confidence: 1, candidates: ['ajuda'], ambiguous: false }),
      registry: buildDefaultRegistry({ onboarding: handler }),
      interactionLog: new InMemoryInteractionLog(),
    });

    const seq = ['oi', 'Maria Silva', '123456/SP', '111.444.777-35', 'maria@adv.com', 'aceito'];
    let last;
    for (const t of seq) last = await orch.handleInboundMessage(makeMessage(t));
    expect(last!.intent).toBe('onboarding'); // ainda onboarding (resolve era null no início da msg)
    expect(flag.created).toBe(true);

    // Próxima mensagem: já é assinante → caminho de tenant.
    const next = await orch.handleInboundMessage(makeMessage('me ajuda'));
    expect(next.assinanteId).toBe('assinante-id');
    expect(next.intent).toBe('ajuda');
  });
});

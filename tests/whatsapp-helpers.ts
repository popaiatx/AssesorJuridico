import type {
  Clock,
  MessageDeduplicator,
  WindowStore,
} from '../src/adapters/whatsapp/abstractions';
import type { HttpPost, HttpResponseLite } from '../src/adapters/whatsapp/cloud-api-client';
import type { WhatsappConfig } from '../src/adapters/whatsapp/config';
import type {
  InboundMessage,
  TemplateMessage,
  WhatsappPort,
} from '../src/core/ports/whatsapp';

export const fakeConfig: WhatsappConfig = {
  phoneNumberId: '123456',
  accessToken: 'token',
  verifyToken: 'verify-token',
  appSecret: 'app-secret',
};

export function fixedClock(iso: string): Clock {
  return () => new Date(iso);
}

export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** HttpPost que grava as requisições e devolve um status configurável. */
export function recordingHttpPost(status = 200): {
  post: HttpPost;
  calls: Array<{ url: string; headers: Record<string, string>; body: string }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const post: HttpPost = (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const res: HttpResponseLite = { status, text: () => Promise.resolve('') };
    return Promise.resolve(res);
  };
  return { post, calls };
}

/** Dedup em memória com as mesmas semânticas do lease (processing/done). */
export class InMemoryDedup implements MessageDeduplicator {
  done = new Set<string>();
  processing = new Set<string>();
  claimCalls: string[] = [];
  doneCalls: string[] = [];
  releaseCalls: string[] = [];

  claim(messageId: string): Promise<boolean> {
    this.claimCalls.push(messageId);
    if (this.done.has(messageId) || this.processing.has(messageId)) return Promise.resolve(false);
    this.processing.add(messageId);
    return Promise.resolve(true);
  }
  markDone(messageId: string): Promise<void> {
    this.doneCalls.push(messageId);
    this.processing.delete(messageId);
    this.done.add(messageId);
    return Promise.resolve();
  }
  release(messageId: string): Promise<void> {
    this.releaseCalls.push(messageId);
    this.processing.delete(messageId);
    return Promise.resolve();
  }
}

export class InMemoryWindow implements WindowStore {
  last = new Map<string, Date>();
  recordInbound(phone: string, at: Date): Promise<void> {
    this.last.set(phone, at);
    return Promise.resolve();
  }
  lastInbound(phone: string): Promise<Date | null> {
    return Promise.resolve(this.last.get(phone) ?? null);
  }
}

/** WhatsappPort falso para o processor: parse fixo + registro de envios. */
export class FakeWhatsapp implements WhatsappPort {
  sent: Array<{ to: string; text: string }> = [];
  constructor(
    private readonly messages: InboundMessage[],
    private readonly sendBehavior: 'ok' | 'throw' = 'ok',
  ) {}
  parseInboundMessages(): InboundMessage[] {
    return this.messages;
  }
  sendFreeFormMessage(to: string, text: string): Promise<void> {
    if (this.sendBehavior === 'throw') return Promise.reject(new Error('envio falhou'));
    this.sent.push({ to, text });
    return Promise.resolve();
  }
  sendTemplate(_message: TemplateMessage): Promise<void> {
    return Promise.reject(new Error('não usado no teste'));
  }
  verifyWebhook(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

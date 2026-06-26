/**
 * Converte o payload do webhook da Cloud API em `InboundMessage[]` que o
 * orquestrador consome. Trata texto; reconhece mídia (imagem/documento/áudio/
 * vídeo/sticker) preenchendo `media` — o download/Storage fica PENDENTE.
 * Ignora payloads que não são mensagens (ex.: `statuses` de entrega).
 */
import type { InboundMedia, InboundMessage } from '../../core/ports/whatsapp.js';

interface CloudMedia {
  id?: string;
  filename?: string;
  caption?: string;
}
interface CloudMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: CloudMedia;
  document?: CloudMedia;
  audio?: CloudMedia;
  video?: CloudMedia;
  sticker?: CloudMedia;
}
interface CloudPayload {
  entry?: Array<{ changes?: Array<{ value?: { messages?: CloudMessage[] } }> }>;
}

function toIso(timestamp: string | undefined): string {
  const secs = Number(timestamp);
  if (!Number.isFinite(secs) || secs <= 0) return new Date(0).toISOString();
  return new Date(secs * 1000).toISOString();
}

function mediaOf(m: CloudMessage): InboundMedia | null {
  switch (m.type) {
    case 'image':
      return { type: 'image', mediaId: m.image?.id ?? '' };
    case 'audio':
      return { type: 'audio', mediaId: m.audio?.id ?? '' };
    case 'video':
      return { type: 'video', mediaId: m.video?.id ?? '' };
    case 'sticker':
      return { type: 'sticker', mediaId: m.sticker?.id ?? '' };
    case 'document': {
      const media: InboundMedia = { type: 'document', mediaId: m.document?.id ?? '' };
      if (m.document?.filename) media.filename = m.document.filename;
      return media;
    }
    case 'text':
      return null;
    default:
      // Tipos não suportados (location, contacts, interactive, ...) → mídia 'unknown'.
      return { type: 'unknown', mediaId: '' };
  }
}

function captionOf(m: CloudMessage): string {
  return m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? '';
}

function toInbound(m: CloudMessage): InboundMessage {
  const base: InboundMessage = {
    messageId: m.id ?? '',
    from: m.from ?? '',
    text: m.type === 'text' ? (m.text?.body ?? '') : captionOf(m),
    timestamp: toIso(m.timestamp),
  };
  const media = mediaOf(m);
  if (media) base.media = media;
  return base;
}

export function parseInboundMessages(rawBody: Buffer): InboundMessage[] {
  const text = rawBody.toString('utf8').trim();
  if (!text) return [];
  const payload = JSON.parse(text) as CloudPayload;

  const out: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        out.push(toInbound(m));
      }
    }
  }
  return out;
}

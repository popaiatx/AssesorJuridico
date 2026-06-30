/**
 * Download de mídia do WhatsApp (Cloud API) — implementa `MediaDownloader`.
 * Dois passos: GET /{mediaId} → metadados (url, mime); GET {url} (com Bearer) → bytes.
 *
 * DEPENDE DO CHIP: só funciona com WHATSAPP_ACCESS_TOKEN válido. Não é testado por
 * unidade (rede); a validação é manual quando o número estiver ativo. HTTP injetável.
 */
import type { MediaDownloader, MidiaBaixada } from '../../core/ports/media-downloader.js';
import type { WhatsappConfig } from './config.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

export type HttpGetJson = (url: string, headers: Record<string, string>) => Promise<{ status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

const fetchGet: HttpGetJson = async (url, headers) => {
  const res = await fetch(url, { method: 'GET', headers });
  return { status: res.status, json: () => res.json(), arrayBuffer: () => res.arrayBuffer() };
};

export class WhatsappMediaDownloader implements MediaDownloader {
  constructor(
    private readonly config: WhatsappConfig,
    private readonly httpGet: HttpGetJson = fetchGet,
  ) {}

  async download(mediaId: string): Promise<MidiaBaixada> {
    const auth = { Authorization: `Bearer ${this.config.accessToken}` };
    const meta = await this.httpGet(`${GRAPH}/${mediaId}`, auth);
    if (meta.status < 200 || meta.status >= 300) throw new Error(`Metadados da mídia: HTTP ${meta.status}`);
    const info = (await meta.json()) as { url?: string; mime_type?: string };
    if (!info.url) throw new Error('Mídia sem URL de download.');
    const file = await this.httpGet(info.url, auth);
    if (file.status < 200 || file.status >= 300) throw new Error(`Download da mídia: HTTP ${file.status}`);
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: info.mime_type ?? null,
      filename: null,
    };
  }
}

/**
 * Cliente da WhatsApp Cloud API (envio). O transporte HTTP é INJETADO
 * (`HttpPost`) para testar o shape da requisição sem rede; o default usa `fetch`.
 */
import type { WhatsappConfig } from './config.js';
import type { TemplateDefinition } from './templates.js';

export interface HttpResponseLite {
  status: number;
  text(): Promise<string>;
}

export type HttpPost = (
  url: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<HttpResponseLite>;

export const fetchHttpPost: HttpPost = async (url, init) => {
  const res = await fetch(url, { method: 'POST', headers: init.headers, body: init.body });
  return { status: res.status, text: () => res.text() };
};

const GRAPH_VERSION = 'v20.0';

export class CloudApiClient {
  constructor(
    private readonly config: WhatsappConfig,
    private readonly httpPost: HttpPost = fetchHttpPost,
  ) {}

  private url(): string {
    return `https://graph.facebook.com/${GRAPH_VERSION}/${this.config.phoneNumberId}/messages`;
  }

  private async post(payload: unknown): Promise<void> {
    const res = await this.httpPost(this.url(), {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) {
      const body = await res.text();
      // Erro transitório/permanente da Cloud API — propaga para o caller decidir.
      throw new Error(`Cloud API respondeu ${res.status}: ${body.slice(0, 300)}`);
    }
  }

  sendText(to: string, body: string): Promise<void> {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  }

  sendTemplate(
    to: string,
    template: TemplateDefinition,
    variables: Record<string, string>,
  ): Promise<void> {
    const parameters = template.params.map((p) => ({ type: 'text', text: variables[p] ?? '' }));
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: parameters.length ? [{ type: 'body', parameters }] : [],
      },
    });
  }
}

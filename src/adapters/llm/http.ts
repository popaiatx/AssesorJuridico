/**
 * Transporte HTTP injetável para os adapters de LLM (raw HTTP, sem SDK). O
 * default usa `fetch`; os testes injetam um fake para verificar o shape da
 * requisição sem rede. Mesmo padrão do CloudApiClient do WhatsApp.
 */
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

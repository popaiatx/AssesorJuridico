/**
 * Transporte HTTP injetável para o adapter Asaas (GET/POST). Default usa `fetch`;
 * os testes injetam um fake para verificar o shape das requisições sem rede.
 */
export interface HttpResponseLite {
  status: number;
  text(): Promise<string>;
}

export type HttpRequest = (
  method: 'GET' | 'POST',
  url: string,
  init: { headers: Record<string, string>; body?: string },
) => Promise<HttpResponseLite>;

export const fetchHttpRequest: HttpRequest = async (method, url, init) => {
  const res = await fetch(url, {
    method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  return { status: res.status, text: () => res.text() };
};

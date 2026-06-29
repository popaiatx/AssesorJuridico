/**
 * Transporte HTTP GET injetável para os adapters de FONTE (raw HTTP, sem SDK).
 * Default usa `fetch`; testes injetam um fake para verificar parsing sem rede.
 * Devolve bytes crus (arrayBuffer) porque a fonte decide a codificação
 * (o Planalto serve latin1; outras fontes, utf-8).
 */
export interface HttpGetResponseLite {
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type HttpGet = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpGetResponseLite>;

export const fetchHttpGet: HttpGet = async (url, init) => {
  const res = await fetch(url, { method: 'GET', headers: init?.headers ?? {} });
  return { status: res.status, arrayBuffer: () => res.arrayBuffer() };
};

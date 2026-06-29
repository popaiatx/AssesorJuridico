/**
 * Adapter de FONTE de legislação oficial — Planalto (texto consolidado).
 *
 * Implementa `SourcePort`: `listNormas()` vem do escopo curado (manifesto);
 * `fetchNorma()` baixa a página consolidada, decodifica (latin1/utf-8), extrai o
 * texto e detecta revogação da norma inteira por marcador (defensivo, ver
 * `detectarRevogacaoNorma`). HTTP injetável (mesmo padrão dos outros adapters).
 */
import { detectarRevogacaoNorma } from '../../../core/domain/cerebro2/revogacao.js';
import type { NormaConteudo, NormaRef, SourcePort } from '../../../core/ports/source.js';
import { fetchHttpGet, type HttpGet } from '../http.js';
import { CORPUS_MANIFEST } from './manifest.js';

function decodeHtml(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Detecta charset no início; Planalto é latin1, mas respeitamos utf-8 quando declarado.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).toLowerCase();
  const charset = /charset=\s*["']?([\w-]+)/.exec(head)?.[1];
  const enc = charset && /utf-?8/.test(charset) ? 'utf-8' : 'latin1';
  return new TextDecoder(enc).decode(bytes);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export class PlanaltoLegislacaoSource implements SourcePort {
  constructor(private readonly httpGet: HttpGet = fetchHttpGet) {}

  listNormas(): Promise<NormaRef[]> {
    return Promise.resolve(
      CORPUS_MANIFEST.map((m) => ({
        tipo: 'legislacao' as const,
        sigla: m.sigla,
        titulo: m.titulo,
        identificador: m.identificador,
        fonteUrl: m.fonteUrl,
        dataPublicacao: m.dataPublicacao ?? null,
      })),
    );
  }

  async fetchNorma(ref: NormaRef): Promise<NormaConteudo> {
    const res = await this.httpGet(ref.fonteUrl);
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} ao baixar ${ref.fonteUrl}`);
    }
    const texto = htmlToText(decodeHtml(await res.arrayBuffer()));
    const vigenciaStatus = detectarRevogacaoNorma(texto) ? 'revogada' : 'vigente';
    return { texto, vigenciaStatus, fonteVersao: null };
  }
}

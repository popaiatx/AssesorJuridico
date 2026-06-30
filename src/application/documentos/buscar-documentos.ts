/**
 * Busca de DOCUMENTOS (Passo 12B). Combina DUAS buscas, ambas escopadas por
 * tenant na própria query (o assinanteId vem SEMPRE da identidade; RLS backstop):
 *   1) EXATA   — ILIKE dos tokens da referência em busca_texto/nome (casa número).
 *   2) SEMÂNTICA — vizinhos do embedding da referência entre os docs DO TENANT.
 * Combina com PRIORIDADE para a exata, deduplica por id e devolve o Top N. Conta
 * o "ponto cego" (documentos sem texto) só do próprio tenant. NÃO gera URL aqui:
 * a posse já está garantida pela query escopada; o link fica a cargo do handler.
 */
import { tokensDeBusca } from '../../core/domain/documentos/busca.js';
import type { DocumentoResultado, DocumentoSearchStore } from '../../core/ports/documentos.js';
import type { EmbeddingsPort } from '../../core/ports/embeddings.js';

interface Logger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface BuscarDocumentosDeps {
  store: DocumentoSearchStore;
  /** Sem embeddings → só busca exata (semântica fica vazia). */
  embeddings?: EmbeddingsPort;
  topN: number;
  /** Piso de similaridade da semântica (evita devolver vizinho irrelevante). */
  minSimilarity: number;
  logger: Logger;
}

export interface BuscaDocumentosResultado {
  /** Top N combinado (exata primeiro, depois semânticos inéditos). */
  documentos: DocumentoResultado[];
  /** Documentos do tenant sem texto (não aparecem na busca por conteúdo). */
  semTexto: number;
  /** Houve mais candidatos do que o teto (para avisar "refine"). */
  truncado: boolean;
}

export class BuscarDocumentos {
  constructor(private readonly deps: BuscarDocumentosDeps) {}

  async buscar(assinanteId: string, referencia: string): Promise<BuscaDocumentosResultado> {
    const { store, topN } = this.deps;
    const termos = tokensDeBusca(referencia);

    // Ambas as buscas SÓ enxergam documentos do próprio assinante (filtro embutido).
    const exatos = termos.length ? await store.buscarExato(assinanteId, termos, topN) : [];
    const semanticos = await this.semantico(assinanteId, referencia, topN);
    const semTexto = await store.contarSemTexto(assinanteId);

    // Combina com prioridade da exata; deduplica por id.
    const vistos = new Set<string>();
    const combinado: DocumentoResultado[] = [];
    for (const doc of [...exatos, ...semanticos]) {
      if (vistos.has(doc.id)) continue;
      vistos.add(doc.id);
      combinado.push(doc);
    }
    const truncado = combinado.length > topN || exatos.length >= topN;
    return { documentos: combinado.slice(0, topN), semTexto, truncado };
  }

  /** Busca semântica resiliente: sem embeddings ou falha do provider → []. */
  private async semantico(
    assinanteId: string,
    referencia: string,
    topN: number,
  ): Promise<DocumentoResultado[]> {
    if (!this.deps.embeddings || !referencia.trim()) return [];
    try {
      const [vetor] = await this.deps.embeddings.embed([referencia]);
      if (!vetor) return [];
      const vizinhos = await this.deps.store.buscarSemantico(assinanteId, vetor, topN);
      // Só vizinhos relevantes: o nearest-neighbor sempre devolve algo, mesmo longe.
      return vizinhos.filter((d) => (d.similarity ?? 0) >= this.deps.minSimilarity);
    } catch (err) {
      this.deps.logger.error({ err }, 'busca de documentos: falha na semântica (segue só exata)');
      return [];
    }
  }
}

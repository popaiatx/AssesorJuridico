/**
 * Portas de DOCUMENTOS (Passo 12A). O índice "de quem é cada documento" vive na
 * tabela `documentos` (RLS force por tenant, via withTenant) — NUNCA por
 * service_role. O arquivo em si fica no Storage privado (StoragePort); a resolução
 * de dono é SEMPRE pela tabela, e só então se gera URL/baixa o arquivo.
 */

/** Informações-chave estruturadas (alimentam a busca do 12B). Sem inventar:
 *  campo ausente no documento fica vazio, nunca preenchido por suposição. */
export interface KeyInfo {
  tipo: string;
  partes: string[];
  numeros: string[];
  datas: Array<{ data: string; descricao: string }>;
  assunto: string;
  resumoCurto: string;
}

export type ExtracaoStatus = 'ok' | 'sem_texto' | 'falha';
export type DocumentoStatus = 'aguardando_decisao' | 'guardado';

export interface NovoDocumento {
  /** Id gerado pela aplicação (compõe o caminho no bucket: ${assinanteId}/${id}/…). */
  id: string;
  nome: string;
  /** Content type (mime). */
  tipo: string | null;
  storageRef: string;
  processoId: string | null;
  legenda: string | null;
  status: DocumentoStatus;
}

export interface ConteudoExtraido {
  chaves: KeyInfo | null;
  resumo: string | null;
  extracaoStatus: ExtracaoStatus;
  buscaTexto: string | null;
  /** Embedding semântico (do busca_texto). Null quando sem texto (escaneado). */
  embedding: number[] | null;
}

export interface DocumentoRow {
  id: string;
  nome: string;
  tipo: string | null;
  storageRef: string;
  processoId: string | null;
  chaves: KeyInfo | null;
  resumo: string | null;
  extracaoStatus: ExtracaoStatus;
  status: string;
}

/** Resultado de busca: o documento + (no semântico) a similaridade. */
export interface DocumentoResultado extends DocumentoRow {
  similarity?: number;
}

/**
 * Busca de documentos (Passo 12B) — SEMPRE escopada por tenant na própria query
 * (o `assinanteId` vem da identidade, nunca do usuário/LLM). RLS é o backstop.
 */
export interface DocumentoSearchStore {
  /** Exata: ILIKE de cada token em busca_texto/nome (casa fragmento de número),
   *  ranqueado pelo nº de tokens que casaram. Por tenant. */
  buscarExato(assinanteId: string, termos: string[], limite: number): Promise<DocumentoResultado[]>;
  /** Semântica: vizinhos do embedding ENTRE os documentos do próprio tenant. */
  buscarSemantico(
    assinanteId: string,
    embedding: number[],
    limite: number,
  ): Promise<DocumentoResultado[]>;
  /** Quantos documentos do tenant ficaram sem texto (ponto cego da busca). */
  contarSemTexto(assinanteId: string): Promise<number>;
}

export interface DocumentoStore {
  /** Insere o registro (staging ou já guardado), escopado por tenant. */
  inserir(assinanteId: string, doc: NovoDocumento): Promise<void>;
  /** Grava chaves/resumo/busca e marca 'guardado'. Retorna se alterou 1 linha. */
  gravarConteudo(assinanteId: string, id: string, c: ConteudoExtraido): Promise<boolean>;
  /** Busca por id RE-VERIFICANDO o dono (RLS). Null se não for do assinante. */
  getById(assinanteId: string, id: string): Promise<DocumentoRow | null>;
  /** Documento do tenant aguardando decisão (estado do fluxo 1/2/3). */
  pendenteDecisao(assinanteId: string): Promise<DocumentoRow | null>;
  /** Remove a linha do tenant e devolve o storage_ref (para apagar o arquivo). */
  remover(assinanteId: string, id: string): Promise<string | null>;
}

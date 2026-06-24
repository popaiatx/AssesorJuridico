/**
 * Port de STORAGE (driven). Documentos de processo em buckets PRIVADOS, acesso
 * por URL assinada de expiração curta (sigilo — skill banco-supabase).
 *
 * Apenas assinaturas; sem implementação nesta fase (ver adapters/storage).
 */

export interface PutDocumentInput {
  assinanteId: string; // escopo de tenant também no Storage
  /** Caminho lógico dentro do bucket (ex.: `${assinanteId}/${processoId}/arquivo.pdf`). */
  path: string;
  content: Uint8Array;
  contentType: string;
}

export interface StoragePort {
  putDocument(input: PutDocumentInput): Promise<{ storageRef: string }>;
  /** URL assinada com expiração curta, gerada sob demanda. */
  getSignedUrl(storageRef: string, expiresInSeconds: number): Promise<string>;
  deleteDocument(storageRef: string): Promise<void>;
}

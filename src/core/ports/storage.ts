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
  /** Baixa os bytes de um documento. O `storageRef` SÓ deve vir de uma linha já
   *  verificada como do dono (tabela `documentos`/RLS) — nunca do usuário. */
  getDocument(storageRef: string): Promise<Uint8Array>;
  /** URL assinada com expiração curta, gerada sob demanda (idem dono verificado). */
  getSignedUrl(storageRef: string, expiresInSeconds: number): Promise<string>;
  deleteDocument(storageRef: string): Promise<void>;
}

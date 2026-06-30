/**
 * Adapter de STORAGE — STUB (PENDENTE).
 *
 * Implementa `StoragePort`, mas NÃO funciona: cada método lança
 * NotImplementedError. O adapter real (Supabase Storage, buckets privados +
 * URLs assinadas) será implementado na fase de documentos.
 */
import { NotImplementedError } from '../../core/errors.js';
import type { PutDocumentInput, StoragePort } from '../../core/ports/storage.js';

const PENDENTE = 'Adapter de storage ainda não implementado (PENDENTE).';

export class StubStorageAdapter implements StoragePort {
  putDocument(_input: PutDocumentInput): Promise<{ storageRef: string }> {
    throw new NotImplementedError(PENDENTE);
  }
  getDocument(_storageRef: string): Promise<Uint8Array> {
    throw new NotImplementedError(PENDENTE);
  }
  getSignedUrl(_storageRef: string, _expiresInSeconds: number): Promise<string> {
    throw new NotImplementedError(PENDENTE);
  }
  deleteDocument(_storageRef: string): Promise<void> {
    throw new NotImplementedError(PENDENTE);
  }
}

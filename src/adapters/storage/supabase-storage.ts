/**
 * Adapter de STORAGE — Supabase Storage (bucket PRIVADO). É o ÚNICO lugar onde a
 * chave privilegiada (service_role) toca ARQUIVO — porque o Storage não tem RLS por
 * tenant sem Supabase Auth (identificamos por telefone, não por JWT).
 *
 * O isolamento do arquivo é garantido FORA daqui: (1) o caminho é sempre
 * `${assinanteId}/${docId}/…` com o assinanteId vindo da identidade; (2) "de quem é
 * o documento" é decidido na tabela `documentos` (RLS, withTenant) — o `storageRef`
 * só chega aqui depois de a posse ter sido confirmada; nunca vem do usuário.
 */
import { getAdminClient } from '../../infra/db/admin.js';
import { config } from '../../infra/config/index.js';
import type { PutDocumentInput, StoragePort } from '../../core/ports/storage.js';

function bucket() {
  return getAdminClient().storage.from(config.DOCUMENTOS_BUCKET);
}

/** Traduz erros do Storage em mensagem acionável (bucket ausente é o mais comum). */
function explicaErroStorage(msg: string): string {
  if (/bucket not found/i.test(msg)) {
    return (
      `o bucket "${config.DOCUMENTOS_BUCKET}" não existe. Crie-o (privado) no painel ` +
      'do Supabase › Storage, ou rode "npm run doc:bucket". (' +
      'configure o nome em DOCUMENTOS_BUCKET).'
    );
  }
  return msg;
}

export const supabaseStorage: StoragePort = {
  async putDocument(input: PutDocumentInput): Promise<{ storageRef: string }> {
    const { error } = await bucket().upload(input.path, Buffer.from(input.content), {
      contentType: input.contentType,
      upsert: true,
    });
    if (error) throw new Error(`Falha ao subir documento: ${explicaErroStorage(error.message)}`);
    return { storageRef: input.path };
  },

  async getDocument(storageRef: string): Promise<Uint8Array> {
    const { data, error } = await bucket().download(storageRef);
    if (error || !data) throw new Error(`Falha ao baixar documento: ${error?.message ?? 'vazio'}`);
    return new Uint8Array(await data.arrayBuffer());
  },

  async getSignedUrl(storageRef: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await bucket().createSignedUrl(storageRef, expiresInSeconds);
    if (error || !data) throw new Error(`Falha ao gerar URL assinada: ${error?.message ?? 'vazio'}`);
    return data.signedUrl;
  },

  async deleteDocument(storageRef: string): Promise<void> {
    const { error } = await bucket().remove([storageRef]);
    if (error) throw new Error(`Falha ao apagar documento: ${error.message}`);
  },
};

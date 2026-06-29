/**
 * Port de criação de assinante (ponto único, caminho controlado). A implementação
 * usa a função SECURITY DEFINER `app.create_assinante_onboarding` (sem service_role
 * no caminho da mensagem).
 */
export interface CreateAssinanteInput {
  telefone: string;
  nome: string;
  oabNumero: string;
  oabSeccional: string;
  documento: string;
  email: string | null;
  consentVersao: string;
  canal: string;
}

/** Cria o assinante (trial) + consentimento e retorna o `assinante_id`. */
export type AssinanteCreator = (input: CreateAssinanteInput) => Promise<string>;

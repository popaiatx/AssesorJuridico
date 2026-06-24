/**
 * Port de LLM (driven). Provedor com política de não-treinamento + DPA.
 *
 * Regras (CLAUDE.md / skills): contexto mínimo ao LLM; anonimizar dado de
 * cliente antes do envio quando possível. A geração de texto é SEPARADA da
 * recuperação de dados — este port é só o acesso ao modelo; orquestração e os
 * três cérebros vêm em fases seguintes.
 *
 * Apenas assinaturas; sem implementação nesta fase (ver adapters/llm).
 */

export interface LlmGenerateParams {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmGenerateResult {
  text: string;
}

export interface LlmPort {
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
  /** Embeddings para o corpus/consulta do RAG (Cérebro 2, Fase 2). */
  embed(texts: string[]): Promise<number[][]>;
}

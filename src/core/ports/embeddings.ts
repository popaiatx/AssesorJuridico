/**
 * Port de EMBEDDINGS (driven), separado do `LlmPort`: o chat pode ser Anthropic,
 * mas embeddings exigem outro provedor (OpenAI/Voyage). Provider-agnostic.
 */
export interface EmbeddingsPort {
  /** Gera um vetor por texto, na ordem de entrada. */
  embed(texts: string[]): Promise<number[][]>;
}

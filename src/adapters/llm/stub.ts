/**
 * Adapter de LLM — STUB (PENDENTE).
 *
 * Implementa `LlmPort`, mas NÃO funciona: cada método lança
 * NotImplementedError. O adapter real (provedor com não-treinamento + DPA) será
 * implementado junto da orquestração/cérebros.
 */
import { NotImplementedError } from '../../core/errors.js';
import type { LlmGenerateParams, LlmGenerateResult, LlmPort } from '../../core/ports/llm.js';

const PENDENTE = 'Adapter de LLM ainda não implementado (PENDENTE).';

export class StubLlmAdapter implements LlmPort {
  generate(_params: LlmGenerateParams): Promise<LlmGenerateResult> {
    throw new NotImplementedError(PENDENTE);
  }
  embed(_texts: string[]): Promise<number[][]> {
    throw new NotImplementedError(PENDENTE);
  }
}

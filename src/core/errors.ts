/**
 * Erros do núcleo. Tratados explicitamente, nunca silenciados (CLAUDE.md).
 */

/**
 * Marca código que ainda NÃO foi implementado. Usado pelos adapters-stub desta
 * fase de fundação: eles lançam isto em vez de fingir funcionar.
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/**
 * Adapter de FONTE de jurisprudência — STUB (PENDENTE).
 *
 * Implementa `SourcePort`, mas NÃO funciona: cada método lança NotImplementedError.
 * O adapter real é um agregador pago (Judit/Escavador/Codilo/Digesto), plugado
 * quando assinado — respeitando os TERMOS DE USO do provedor. A mesma ingestão/sync
 * (chunk → embed → grava) serve a esta fonte (source-agnostic).
 */
import { NotImplementedError } from '../../../core/errors.js';
import type { NormaConteudo, NormaRef, SourcePort } from '../../../core/ports/source.js';

const PENDENTE = 'Fonte de jurisprudência (agregador pago) ainda não implementada (PENDENTE).';

export class StubJurisprudenciaSource implements SourcePort {
  listNormas(): Promise<NormaRef[]> {
    throw new NotImplementedError(PENDENTE);
  }
  fetchNorma(_ref: NormaRef): Promise<NormaConteudo> {
    throw new NotImplementedError(PENDENTE);
  }
}

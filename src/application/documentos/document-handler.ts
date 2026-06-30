/**
 * Handler de DOCUMENTOS (Passo 12A). Liga a mensagem ao serviço:
 *  - `handleIncoming`: mídia recebida (bytes já baixados pela camada de transporte).
 *    Legenda com ação ("resume", "guarda") → executa direto; senão → pergunta 1/2/3.
 *  - `handleDecision`: texto que pode ser a resposta 1/2/3 a um documento pendente.
 *    Sem documento pendente → devolve null (não é para nós; o orquestrador segue).
 */
import {
  acaoDaResposta,
  acaoDoTexto,
  cnjDoTexto,
  PERGUNTA_DECISAO,
} from '../../core/domain/documentos/decisao.js';
import type { DocumentoStore } from '../../core/ports/documentos.js';
import type { DocumentoEntrada, DocumentoService } from './documento-service.js';

export interface DocumentHandlerDeps {
  service: DocumentoService;
  store: DocumentoStore;
}

export class DocumentHandler {
  constructor(private readonly deps: DocumentHandlerDeps) {}

  async handleIncoming(assinanteId: string, entrada: DocumentoEntrada): Promise<string> {
    const legenda = entrada.legenda ?? '';
    const cnj = legenda ? cnjDoTexto(legenda) : null;
    const comCnj: DocumentoEntrada = cnj ? { ...entrada, numeroCnj: cnj } : entrada;
    const acao = legenda ? acaoDoTexto(legenda) : null;
    if (acao) return this.deps.service.processarComAcao(assinanteId, comCnj, acao);
    return this.deps.service.receber(assinanteId, comCnj);
  }

  /** Retorna a resposta, ou null se NÃO há documento aguardando decisão. */
  async handleDecision(assinanteId: string, norm: string): Promise<string | null> {
    const pend = await this.deps.store.pendenteDecisao(assinanteId);
    if (!pend) return null;
    const acao = acaoDaResposta(norm);
    if (!acao) return `Não entendi. ${PERGUNTA_DECISAO}`;
    return this.deps.service.decidir(assinanteId, pend.id, acao);
  }
}

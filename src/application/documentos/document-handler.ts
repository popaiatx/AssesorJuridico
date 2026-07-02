/**
 * Handler de DOCUMENTOS (Passo 12A + 18). Liga a mensagem ao serviço:
 *  - `handleIncoming`: mídia recebida (bytes já baixados pela camada de transporte).
 *    Legenda com ação ("resume", "guarda") → executa direto; senão → pergunta 1/2/3.
 *  - `handleDecision`: texto que pode responder uma pendência nossa, na ordem:
 *    (a) VÍNCULO/MOVER de pasta (Passo 18): sim executa, não cancela, número
 *        resolve a desambiguação — e QUALQUER outra mensagem descarta a pendência
 *        silenciosamente e devolve null (a conversa segue; sugerir nunca trava);
 *    (b) decisão 1/2/3 do 12A. Sem pendência → null (não é para nós).
 */
import {
  acaoDaResposta,
  acaoDoTexto,
  cnjDoTexto,
  PERGUNTA_DECISAO,
} from '../../core/domain/documentos/decisao.js';
import { isAffirmative, isNegative } from '../../core/domain/cerebro1-actions.js';
import type { DocumentoStore } from '../../core/ports/documentos.js';
import type { PendingAction, PendingActionStore } from '../../core/ports/cerebro1.js';
import type { DocumentoEntrada, DocumentoService } from './documento-service.js';

/** Pendências DESTE fluxo (as demais são de outros handlers — não tocamos). */
const PENDENCIAS_PASTA = new Set(['vincular_documento', 'mover_documento']);

export interface DocumentHandlerDeps {
  service: DocumentoService;
  store: DocumentoStore;
  /** Pendências de pasta (Passo 18). Ausente → só o fluxo 1/2/3 do 12A. */
  pending?: PendingActionStore;
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

  /** Retorna a resposta, ou null se NÃO há pendência nossa (o orquestrador segue). */
  async handleDecision(assinanteId: string, norm: string): Promise<string | null> {
    // (a) Pendência de pasta (Passo 18) tem prioridade — é o turno imediato.
    if (this.deps.pending) {
      const pend = await this.deps.pending.get(assinanteId);
      if (pend && PENDENCIAS_PASTA.has(pend.acao)) {
        return this.resolverPendenciaPasta(assinanteId, pend, norm);
      }
    }
    // (b) Decisão 1/2/3 do 12A.
    const pendDoc = await this.deps.store.pendenteDecisao(assinanteId);
    if (!pendDoc) return null;
    const acao = acaoDaResposta(norm);
    if (!acao) return `Não entendi. ${PERGUNTA_DECISAO}`;
    return this.deps.service.decidir(assinanteId, pendDoc.id, acao);
  }

  /**
   * sim → executa (posse de doc E processo re-verificadas no serviço); não →
   * cancela com resposta; número → resolve a desambiguação; QUALQUER OUTRA
   * mensagem → descarta a pendência e devolve null (a conversa segue normal).
   */
  private async resolverPendenciaPasta(
    assinanteId: string,
    pend: PendingAction,
    norm: string,
  ): Promise<string | null> {
    const pending = this.deps.pending!;
    const docId = typeof pend.params.docId === 'string' ? pend.params.docId : null;

    if (isNegative(norm)) {
      await pending.clear(assinanteId);
      return pend.acao === 'vincular_documento' ? 'Ok, deixei avulso. 👍' : 'Ok, não movi. 👍';
    }

    if (pend.fase === 'desambiguando') {
      const cands = Array.isArray(pend.params._candidatos)
        ? (pend.params._candidatos as Array<{ id: string; label: string }>)
        : [];
      const n = Number.parseInt(norm.replace(/\D/g, ''), 10);
      if (Number.isInteger(n) && n >= 1 && n <= cands.length && docId) {
        await pending.clear(assinanteId);
        return this.deps.service.vincularPasta(assinanteId, docId, cands[n - 1]!.id);
      }
      // Não foi um número da lista → descarta e segue (sugerir nunca trava).
      await pending.clear(assinanteId);
      return null;
    }

    if (isAffirmative(norm) && docId) {
      const processoId = typeof pend.params.processoId === 'string' ? pend.params.processoId : null;
      await pending.clear(assinanteId);
      return this.deps.service.vincularPasta(assinanteId, docId, processoId);
    }

    await pending.clear(assinanteId);
    return null;
  }
}

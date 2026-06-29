/**
 * Handler do Cérebro 2 (RAG jurídico). Atende `duvida_juridica`.
 *
 * Pipeline: embed(pergunta) → busca vetorial no corpus (compartilhado) → separa
 * trechos pertinentes (acima do limiar) dos próximos → LLM redige dentro dos
 * limites → `composeRagReply` (determinístico) valida citação e compõe a resposta
 * (A/B/C). Falha de embeddings/busca → mensagem transitória (sem inventar);
 * falha do LLM → recusa segura. Corpus é público; só a pergunta vai ao LLM (sem PII).
 */
import { composeRagReply, type RagTrecho } from '../../core/domain/cerebro2/rag.js';
import type { Intent } from '../../core/domain/intents.js';
import type { HandlerResult, IntentHandler, MessageContext } from '../../core/orchestration/handler.js';
import type { CorpusStore, CorpusTrecho } from '../../core/ports/corpus.js';
import type { EmbeddingsPort } from '../../core/ports/embeddings.js';
import type { LlmPort } from '../../core/ports/llm.js';
import { ragGenerate } from './rag-generate.js';

interface Logger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

const K = 6;
const INDISPONIVEL =
  'Não consegui consultar o acervo jurídico agora. Pode tentar de novo em instantes? 🙏';

export interface Cerebro2HandlerDeps {
  llm: LlmPort;
  embeddings: EmbeddingsPort;
  corpus: CorpusStore;
  minSimilarity: number;
  logger: Logger;
}

function toRag(t: CorpusTrecho): RagTrecho {
  return { citacao: t.citacao, texto: t.texto, fonteUrl: t.fonteUrl, vigenciaStatus: t.vigenciaStatus };
}

export class Cerebro2Handler implements IntentHandler {
  readonly intent: Intent = 'duvida_juridica';

  constructor(private readonly deps: Cerebro2HandlerDeps) {}

  async handle(ctx: MessageContext): Promise<HandlerResult> {
    const pergunta = (ctx.message.text ?? '').trim();
    if (!pergunta) return { replyText: 'Sobre qual tema jurídico posso ajudar?' };

    let vetor: number[] | undefined;
    try {
      vetor = (await this.deps.embeddings.embed([pergunta]))[0];
    } catch (err) {
      this.deps.logger.error({ err }, 'cerebro2: falha no embedding');
      return { replyText: INDISPONIVEL };
    }
    if (!vetor) return { replyText: INDISPONIVEL };

    let rows: CorpusTrecho[];
    try {
      rows = await this.deps.corpus.search(vetor, K);
    } catch (err) {
      this.deps.logger.error({ err }, 'cerebro2: falha na busca do corpus');
      return { replyText: INDISPONIVEL };
    }

    const pertinentes = rows.filter((r) => r.similarity >= this.deps.minSimilarity);
    const aproximados = rows.filter((r) => r.similarity < this.deps.minSimilarity);

    let llmOut;
    try {
      llmOut = await ragGenerate(this.deps.llm, pergunta, pertinentes);
    } catch (err) {
      // Falha do LLM → recusa segura (nunca inventa).
      this.deps.logger.error({ err }, 'cerebro2: falha ao gerar resposta');
      llmOut = { orientacao: '', afirmacoes: [], recusou: true };
    }

    const comp = composeRagReply({
      pertinentes: pertinentes.map(toRag),
      aproximados: aproximados.map(toRag),
      llm: llmOut,
    });

    return { replyText: comp.reply, cerebro: 'juridico_rag', fontesCitadas: comp.fontesValidas };
  }
}

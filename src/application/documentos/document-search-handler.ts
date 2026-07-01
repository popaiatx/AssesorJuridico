/**
 * Handler do intent `documento` por TEXTO (Passos 12B + 12C). Despacha:
 *  - BUSCAR (12B): lista os documentos que casam com a referência (exata+semântica).
 *  - RESUMIR (12C): devolve o resumo de um documento já guardado, referido por
 *    ordinal da última lista ("o segundo"), por nome/número, ou pelo contexto.
 * (Receber arquivo/mídia segue pelo fluxo do 12A no orquestrador.)
 *
 * Isolamento: o tenant vem SEMPRE de ctx.assinanteId (identidade), nunca do texto.
 * A busca é escopada por tenant; o resumo re-verifica a posse por tenant (getById)
 * antes de reler o arquivo do Storage. A lista da última busca (para "o segundo")
 * vem da MEMÓRIA do próprio assinante — e cada id ainda passa por getById ao usar.
 */
import { marcaOcr } from '../../core/domain/documentos/formato.js';
import { interpretarPedido, type AlvoResumo } from '../../core/domain/documentos/pedido-resumo.js';
import { ultimaListaDocumentos } from '../../core/domain/conversation/memory.js';
import type { DocumentoResultado } from '../../core/ports/documentos.js';
import type { StoragePort } from '../../core/ports/storage.js';
import type {
  HandlerResult,
  IntentHandler,
  MessageContext,
} from '../../core/orchestration/handler.js';
import type { BuscarDocumentos } from './buscar-documentos.js';
import type { PedidoResumo, ResumidorDocumento } from './resumir-documento.js';

export interface DocumentSearchHandlerDeps {
  busca: BuscarDocumentos;
  resumo: ResumidorDocumento;
  storage: StoragePort;
  urlTtlSec: number;
}

function avisoPontoCego(n: number): string {
  return (
    `ℹ️ Você tem ${n} documento(s) escaneado(s) sem texto, que não entram na busca ` +
    'por conteúdo. Posso localizá-los por nome ou data, se precisar.'
  );
}

/** Descrição curta de um resultado (nome + tipo/assunto/partes, sem inventar). */
function descreve(d: DocumentoResultado): string {
  const c = d.chaves;
  const detalhes = [c?.tipo, c?.assunto].filter((s): s is string => !!s && s.trim() !== '');
  const partes = c?.partes?.filter((p) => p.trim() !== '') ?? [];
  if (partes.length) detalhes.push(partes.slice(0, 3).join(', '));
  const sufixo = detalhes.length ? ` — ${detalhes.join(' · ')}` : '';
  const marca = marcaOcr(d.extracaoStatus); // transparência: conteúdo veio de OCR
  return `*${d.nome}*${sufixo}${marca ? ` _(${marca})_` : ''}`;
}

export class DocumentSearchHandler implements IntentHandler {
  readonly intent = 'documento' as const;
  constructor(private readonly deps: DocumentSearchHandlerDeps) {}

  async handle(ctx: MessageContext): Promise<HandlerResult> {
    if (!ctx.assinanteId) {
      return { replyText: 'Preciso te identificar antes de mexer nos documentos.', cerebro: 'dados' };
    }
    const texto = (ctx.message.text ?? '').trim();
    if (!texto) {
      return {
        replyText:
          'Me diga o que procura ou o que resumir (assunto, nome, número do processo ' +
          'ou da parte). Ex.: "acha o contrato do João" ou "resume o contrato do João".',
        cerebro: 'dados',
      };
    }

    const pedido = interpretarPedido(texto);
    if (pedido.acao === 'resumir') {
      const req: PedidoResumo = pedido.foco
        ? { modo: pedido.modo, foco: pedido.foco }
        : { modo: pedido.modo };
      return this.resumir(ctx.assinanteId, pedido.alvo, req, ctx);
    }
    return this.buscar(ctx.assinanteId, pedido.referencia);
  }

  // --- BUSCAR (12B) ---
  private async buscar(assinanteId: string, referencia: string): Promise<HandlerResult> {
    const { documentos, semTexto, truncado } = await this.deps.busca.buscar(assinanteId, referencia);
    if (documentos.length === 0) {
      const base =
        'Não achei nenhum documento com essa referência. Tente outro termo ' +
        '(assunto, nome da parte ou número), ou me envie o arquivo para guardar.';
      const txt = semTexto > 0 ? `${base}\n\n${avisoPontoCego(semTexto)}` : base;
      return { replyText: txt, cerebro: 'dados' };
    }
    // URL assinada só para documentos que vieram da query escopada (dono confirmado).
    const linhas = await Promise.all(
      documentos.map(async (d, i) => {
        const url = await this.deps.storage.getSignedUrl(d.storageRef, this.deps.urlTtlSec);
        return `${i + 1}. ${descreve(d)}\n🔗 ${url}`;
      }),
    );
    const cabecalho =
      documentos.length === 1 ? 'Achei 1 documento:' : `Achei ${documentos.length} documentos:`;
    let texto = `${cabecalho}\n\n${linhas.join('\n\n')}`;
    if (truncado) {
      texto += '\n\n(Mostrei os mais relevantes — me dê mais detalhes se não for nenhum desses.)';
    }
    texto += '\n\n_Para o resumo de um deles, peça "resume o 1", "resume o 2"…_';
    if (semTexto > 0) texto += `\n\n${avisoPontoCego(semTexto)}`;
    // Guarda a ordem na memória (via orquestrador) para "resume o segundo".
    return { replyText: texto, cerebro: 'dados', documentosListados: documentos.map((d) => d.id) };
  }

  // --- RESUMIR (12C) ---
  private async resumir(
    assinanteId: string,
    alvo: AlvoResumo,
    pedido: PedidoResumo,
    ctx: MessageContext,
  ): Promise<HandlerResult> {
    const lista = ctx.recentContext ? ultimaListaDocumentos(ctx.recentContext.turnos) : [];

    if (alvo.tipo === 'ordinal') {
      if (lista.length === 0) {
        return {
          replyText:
            'Não tenho uma busca recente para saber qual é esse. Busque primeiro ' +
            '(ex.: "acha o contrato do João") e depois peça "resume o segundo".',
          cerebro: 'dados',
        };
      }
      const idx = alvo.indice === -1 ? lista.length - 1 : alvo.indice - 1;
      const id = lista[idx];
      if (!id) {
        return {
          replyText:
            `Sua última busca listou ${lista.length} documento(s). Diga um número dentro ` +
            'disso (ex.: "resume o 1") ou faça uma nova busca.',
          cerebro: 'dados',
        };
      }
      return { replyText: await this.deps.resumo.resumirPorId(assinanteId, id, pedido), cerebro: 'dados' };
    }

    // Referência por nome/número — ou vazia (usa o contexto).
    if (alvo.termo.trim() === '') {
      if (lista.length === 1) {
        return {
          replyText: await this.deps.resumo.resumirPorId(assinanteId, lista[0]!, pedido),
          cerebro: 'dados',
        };
      }
      return {
        replyText:
          'Qual documento você quer que eu resuma? Me diga o assunto, o nome ou o número — ' +
          'ou busque primeiro (ex.: "acha o contrato do João").',
        cerebro: 'dados',
      };
    }

    const { documentos, semTexto } = await this.deps.busca.buscar(assinanteId, alvo.termo);
    if (documentos.length === 0) {
      const base = 'Não achei nenhum documento com essa referência para resumir. Tente outro termo.';
      const txt = semTexto > 0 ? `${base}\n\n${avisoPontoCego(semTexto)}` : base;
      return { replyText: txt, cerebro: 'dados' };
    }
    if (documentos.length === 1) {
      return {
        replyText: await this.deps.resumo.resumirPorId(assinanteId, documentos[0]!.id, pedido),
        cerebro: 'dados',
      };
    }
    // Vários → desambigua (numerado) e guarda a ordem para "resume o N".
    const lst = documentos.map((d, i) => `${i + 1}. ${descreve(d)}`).join('\n');
    return {
      replyText:
        `Achei ${documentos.length} documentos com essa referência. Qual você quer que eu ` +
        `resuma?\n\n${lst}\n\nResponda, por exemplo, "resume o 2".`,
      cerebro: 'dados',
      documentosListados: documentos.map((d) => d.id),
    };
  }
}

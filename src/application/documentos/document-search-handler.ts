/**
 * Handler da BUSCA de documentos (Passo 12B) — intent `documento` por TEXTO.
 * (O recebimento de arquivo/mídia segue pelo fluxo do 12A no orquestrador.)
 *
 * Resolve o tenant SEMPRE da identidade (ctx.assinanteId, do telefone
 * autenticado) — nunca do texto. Chama a busca combinada (já escopada por tenant)
 * e só então gera a URL assinada de cada resultado: o storage_ref vem de uma
 * linha que passou pela query do dono, então o link nunca aponta para doc alheio.
 */
import type { DocumentoResultado } from '../../core/ports/documentos.js';
import type { StoragePort } from '../../core/ports/storage.js';
import type {
  HandlerResult,
  IntentHandler,
  MessageContext,
} from '../../core/orchestration/handler.js';
import type { BuscarDocumentos } from './buscar-documentos.js';

export interface DocumentSearchHandlerDeps {
  busca: BuscarDocumentos;
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
  return `*${d.nome}*${sufixo}`;
}

export class DocumentSearchHandler implements IntentHandler {
  readonly intent = 'documento' as const;
  constructor(private readonly deps: DocumentSearchHandlerDeps) {}

  async handle(ctx: MessageContext): Promise<HandlerResult> {
    if (!ctx.assinanteId) {
      return { replyText: 'Preciso te identificar antes de buscar documentos.', cerebro: 'dados' };
    }
    const referencia = (ctx.message.text ?? '').trim();
    if (!referencia) {
      return {
        replyText:
          'Me diga o que procura (assunto, nome, número do processo ou da parte) ' +
          'que eu busco no seu acervo. Ex.: "acha o contrato de aluguel do João".',
        cerebro: 'dados',
      };
    }

    const { documentos, semTexto, truncado } = await this.deps.busca.buscar(
      ctx.assinanteId,
      referencia,
    );

    if (documentos.length === 0) {
      const base =
        'Não achei nenhum documento com essa referência. Tente outro termo ' +
        '(assunto, nome da parte ou número), ou me envie o arquivo para guardar.';
      const texto = semTexto > 0 ? `${base}\n\n${avisoPontoCego(semTexto)}` : base;
      return { replyText: texto, cerebro: 'dados' };
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
    if (semTexto > 0) texto += `\n\n${avisoPontoCego(semTexto)}`;
    return { replyText: texto, cerebro: 'dados' };
  }
}

/**
 * Handler do Cérebro 1 (dados do escritório). Atende `consulta_dados` e `agendar`.
 *
 * Fluxo: (1) ação pendente? (confirmando → sim/não; coletando → completa); senão
 * (2) o LLM escolhe a ação e extrai params (contexto mínimo); (3) valida; (4)
 * escrita → CONFIRMA antes de gravar; leitura → executa e responde.
 *
 * ISOLAMENTO: o `assinante_id` vem SEMPRE de `ctx.assinanteId` (identidade); as
 * ações e a pendência são por tenant (RLS). Nada do texto/modelo escolhe o tenant.
 */
import type { Intent } from '../../core/domain/intents.js';
import { normalizeText } from '../../core/domain/validators.js';
import {
  ACTIONS_BY_NAME,
  isAffirmative,
  isNegative,
  PERGUNTAS,
  type ActionDef,
  type ValidationResult,
} from '../../core/domain/cerebro1-actions.js';
import type { HandlerResult, IntentHandler, MessageContext } from '../../core/orchestration/handler.js';
import type { Cerebro1Store, PendingAction, PendingActionStore } from '../../core/ports/cerebro1.js';
import type { LlmPort } from '../../core/ports/llm.js';
import { selectAction } from './select-action.js';
import { formatCompromissos, respondProcessos } from './read-responder.js';

interface Logger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface Cerebro1HandlerDeps {
  llm: LlmPort;
  store: Cerebro1Store;
  pending: PendingActionStore;
  clock: () => Date;
  logger: Logger;
}

const FALHA_GENERICA =
  'Tive um problema para processar isso agora. Pode tentar de novo em instantes? 🙏';

const AJUDA_TEXT =
  'Eu organizo a rotina do seu escritório: posso *cadastrar e consultar processos* e ' +
  '*agendar compromissos e prazos* (audiências, reuniões). É só dizer, ex.: "cadastrar ' +
  'processo do cliente João" ou "agendar audiência amanhã 14h". Dúvidas jurídicas com ' +
  'lei/jurisprudência virão com a fonte citada, em breve.';

function perguntasPara(faltando: string[]): string {
  return faltando.map((f) => PERGUNTAS[f] ?? `Pode me informar: ${f}?`).join(' ');
}

export class Cerebro1Handler implements IntentHandler {
  readonly intent: Intent = 'consulta_dados';

  constructor(private readonly deps: Cerebro1HandlerDeps) {}

  async handle(ctx: MessageContext): Promise<HandlerResult> {
    const assinanteId = ctx.assinanteId;
    if (!assinanteId) return { replyText: 'Preciso te identificar primeiro.' };

    const text = ctx.message.text ?? '';
    const norm = normalizeText(text);
    const pend = await this.deps.pending.get(assinanteId);

    if (pend?.fase === 'confirmando') {
      if (isAffirmative(norm)) {
        try {
          const reply = await this.executeWrite(assinanteId, pend);
          await this.deps.pending.clear(assinanteId);
          return { replyText: reply };
        } catch (err) {
          this.deps.logger.error({ err }, 'cerebro1: falha ao gravar');
          return { replyText: FALHA_GENERICA };
        }
      }
      if (isNegative(norm)) {
        await this.deps.pending.clear(assinanteId);
        return { replyText: 'Ok, cancelei. 👍' };
      }
      // Mudou de ideia → descarta a pendência e trata como novo pedido.
      await this.deps.pending.clear(assinanteId);
    } else if (pend?.fase === 'coletando') {
      return this.continuarColeta(assinanteId, pend, text);
    }

    return this.novoPedido(assinanteId, text);
  }

  private async novoPedido(assinanteId: string, text: string): Promise<HandlerResult> {
    let sel;
    try {
      sel = await selectAction(this.deps.llm, text, this.deps.clock());
    } catch (err) {
      this.deps.logger.error({ err }, 'cerebro1: falha na seleção de ação');
      return { replyText: FALHA_GENERICA };
    }
    if (sel.kind === 'texto') return { replyText: sel.text };

    const def = ACTIONS_BY_NAME[sel.acao];
    if (!def) return { replyText: AJUDA_TEXT };
    return this.afterValidate(assinanteId, def, def.validate(sel.input), sel.input);
  }

  private async continuarColeta(
    assinanteId: string,
    pend: PendingAction,
    text: string,
  ): Promise<HandlerResult> {
    const def = ACTIONS_BY_NAME[pend.acao];
    if (!def) {
      await this.deps.pending.clear(assinanteId);
      return this.novoPedido(assinanteId, text);
    }
    let sel;
    try {
      sel = await selectAction(this.deps.llm, text, this.deps.clock(), {
        forced: { acao: pend.acao, knownParams: pend.params },
      });
    } catch (err) {
      this.deps.logger.error({ err }, 'cerebro1: falha ao completar ação');
      return { replyText: FALHA_GENERICA };
    }
    const novoInput = sel.kind === 'acao' ? sel.input : {};
    const merged = { ...pend.params, ...novoInput };
    return this.afterValidate(assinanteId, def, def.validate(merged), merged);
  }

  private async afterValidate(
    assinanteId: string,
    def: ActionDef,
    r: ValidationResult,
    rawInput: Record<string, unknown>,
  ): Promise<HandlerResult> {
    if (r.erro) {
      await this.deps.pending.save(assinanteId, {
        acao: def.name,
        params: rawInput,
        fase: 'coletando',
        faltando: r.faltando,
      });
      return { replyText: r.erro };
    }
    if (r.faltando.length > 0) {
      await this.deps.pending.save(assinanteId, {
        acao: def.name,
        params: rawInput,
        fase: 'coletando',
        faltando: r.faltando,
      });
      return { replyText: perguntasPara(r.faltando) };
    }

    if (def.kind === 'escrita') {
      // CONFIRMAR ANTES DE GRAVAR: guarda o valor normalizado e pede confirmação.
      await this.deps.pending.save(assinanteId, {
        acao: def.name,
        params: r.value,
        fase: 'confirmando',
        faltando: [],
      });
      return { replyText: def.confirmText!(r.value) };
    }

    // Leitura / ajuda: executa direto.
    await this.deps.pending.clear(assinanteId);
    try {
      return { replyText: await this.executeRead(assinanteId, def.name, r.value) };
    } catch (err) {
      this.deps.logger.error({ err }, 'cerebro1: falha na leitura');
      return { replyText: FALHA_GENERICA };
    }
  }

  private async executeWrite(assinanteId: string, pend: PendingAction): Promise<string> {
    const v = pend.params;
    if (pend.acao === 'criar_compromisso') {
      let processoId: string | null = null;
      let aviso = '';
      if (typeof v.numeroCnj === 'string') {
        processoId = await this.deps.store.resolveProcessoIdByCnj(assinanteId, v.numeroCnj);
        if (!processoId) aviso = ' (não achei esse processo; agendei sem vínculo)';
      }
      const lembretes = this.computeLembretes(String(v.dataHora));
      await this.deps.store.criarCompromisso(assinanteId, {
        tipo: v.tipo as 'audiencia' | 'reuniao' | 'prazo',
        dataHora: String(v.dataHora),
        descricao: typeof v.descricao === 'string' ? v.descricao : null,
        processoId,
        lembreteEm: lembretes,
      });
      return `✅ Agendado!${aviso}`;
    }
    if (pend.acao === 'cadastrar_processo') {
      let clienteId: string | null = null;
      if (typeof v.clienteNome === 'string') {
        clienteId = await this.deps.store.upsertClienteByNome(assinanteId, v.clienteNome);
      }
      await this.deps.store.cadastrarProcesso(assinanteId, {
        numeroCnj: (v.numeroCnj as string) ?? null,
        clienteId,
        parteContraria: (v.parteContraria as string) ?? null,
        area: (v.area as string) ?? null,
        status: (v.status as string) ?? null,
      });
      return '✅ Processo cadastrado!';
    }
    return FALHA_GENERICA;
  }

  private async executeRead(
    assinanteId: string,
    acao: string,
    v: Record<string, unknown>,
  ): Promise<string> {
    if (acao === 'ajuda_assessor') return AJUDA_TEXT;
    if (acao === 'listar_compromissos') {
      const range = this.rangeFromPeriodo(String(v.periodo ?? 'proximos'));
      const rows = await this.deps.store.listarCompromissos(assinanteId, range);
      return formatCompromissos(rows);
    }
    if (acao === 'listar_processos') {
      const rows = await this.deps.store.listarProcessos(assinanteId, {
        clienteNome: (v.clienteNome as string) ?? null,
        status: (v.status as string) ?? null,
      });
      return respondProcessos(this.deps.llm, rows);
    }
    if (acao === 'consultar_processo') {
      const rows = await this.deps.store.consultarProcesso(assinanteId, {
        numeroCnj: (v.numeroCnj as string) ?? null,
        parte: (v.parte as string) ?? null,
      });
      return respondProcessos(this.deps.llm, rows);
    }
    return AJUDA_TEXT;
  }

  private computeLembretes(dataHoraIso: string): string[] {
    const alvo = new Date(dataHoraIso).getTime();
    const agora = this.deps.clock().getTime();
    const candidatos = [alvo - 24 * 60 * 60 * 1000, alvo - 60 * 60 * 1000];
    return candidatos.filter((t) => t > agora).map((t) => new Date(t).toISOString());
  }

  private rangeFromPeriodo(periodo: string): { fromISO: string | null; toISO: string | null } {
    const now = this.deps.clock();
    const nowIso = now.toISOString();
    if (periodo === 'todos') return { fromISO: null, toISO: null };
    if (periodo === 'hoje') {
      const ini = new Date(now);
      ini.setHours(0, 0, 0, 0);
      const fim = new Date(now);
      fim.setHours(23, 59, 59, 999);
      return { fromISO: ini.toISOString(), toISO: fim.toISOString() };
    }
    if (periodo === 'semana') {
      return { fromISO: nowIso, toISO: new Date(now.getTime() + 7 * 86400000).toISOString() };
    }
    // proximos
    return { fromISO: nowIso, toISO: null };
  }
}

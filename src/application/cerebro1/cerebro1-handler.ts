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
  formatData,
  isAffirmative,
  isNegative,
  labelTipo,
  PERGUNTAS,
  type ActionDef,
  type ValidationResult,
} from '../../core/domain/cerebro1-actions.js';
import type { HandlerResult, IntentHandler, MessageContext } from '../../core/orchestration/handler.js';
import type {
  Cerebro1Store,
  CompromissoAlvo,
  CompromissoPatch,
  PendingAction,
  PendingActionStore,
  ProcessoPatch,
  ProcessoRow,
} from '../../core/ports/cerebro1.js';
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

const EDICAO_ACOES = new Set([
  'editar_compromisso',
  'cancelar_compromisso',
  'editar_processo',
  'arquivar_processo',
]);
const COMPROMISSO_ACOES = new Set(['editar_compromisso', 'cancelar_compromisso']);

function rotuloProcesso(p: ProcessoRow): string {
  if (p.numeroCnj) return `nº ${p.numeroCnj}`;
  if (p.clienteNome) return `cliente ${p.clienteNome}`;
  if (p.parteContraria) return `parte ${p.parteContraria}`;
  return 'processo';
}
function labelCompromisso(c: CompromissoAlvo): string {
  const proc = c.processoNumero ? ` (proc ${c.processoNumero})` : '';
  return `${labelTipo(c.tipo)} de ${formatData(c.dataHora)}${proc}`;
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
    } else if (pend?.fase === 'desambiguando') {
      return this.resolverDesambiguacao(assinanteId, pend, norm);
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

    if (def.kind === 'edicao') {
      // Edição/remoção: resolve o ALVO real (escopado por tenant), desambigua se
      // houver vários, e confirma mostrando o registro real (reforçado p/ remoção).
      return this.resolverEConfirmar(assinanteId, def, r.value);
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
    if (EDICAO_ACOES.has(pend.acao)) return this.executeEdicao(assinanteId, pend);
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

  // --- Passo 11: resolução do alvo, desambiguação, confirmação e execução ---

  private async resolverEConfirmar(
    assinanteId: string,
    def: ActionDef,
    value: Record<string, unknown>,
  ): Promise<HandlerResult> {
    // Validação de data FUTURA na edição de horário, antes de confirmar.
    if (def.name === 'editar_compromisso' && typeof value.novaDataHora === 'string') {
      if (new Date(value.novaDataHora).getTime() <= this.deps.clock().getTime()) {
        await this.deps.pending.save(assinanteId, { acao: def.name, params: value, fase: 'coletando', faltando: [] });
        return { replyText: 'A nova data precisa ser no futuro. Para quando remarcar?' };
      }
    }

    try {
      const candidatos = COMPROMISSO_ACOES.has(def.name)
        ? (await this.deps.store.findCompromissos(assinanteId, {
            numeroCnj: (value.alvoProcesso as string) ?? null,
            tipo: (value.alvoTipo as 'audiencia' | 'reuniao' | 'prazo') ?? null,
            dia: (value.alvoDia as string) ?? null,
          })).map((c) => ({ id: c.id, label: labelCompromisso(c) }))
        : (await this.deps.store.findProcessos(assinanteId, {
            numeroCnj: (value.alvoCnj as string) ?? null,
            numeroFragmento: (value.alvoNumero as string) ?? null,
            clienteNome: (value.alvoCliente as string) ?? null,
            parte: (value.alvoParte as string) ?? null,
          })).map((p) => ({ id: p.id, label: rotuloProcesso(p) + (p.status ? ` — ${p.status}` : '') }));

      const alvo = COMPROMISSO_ACOES.has(def.name) ? 'compromisso' : 'processo';
      if (candidatos.length === 0) {
        await this.deps.pending.clear(assinanteId);
        return {
          replyText:
            alvo === 'compromisso'
              ? 'Não encontrei esse compromisso. Pode me dizer o processo, o tipo ou o dia?'
              : 'Não encontrei esse processo. Pode me dizer o número (CNJ), o cliente ou a parte?',
        };
      }
      if (candidatos.length === 1) return this.confirmarEdicao(assinanteId, def, value, candidatos[0]!.id);

      // >1 → NUNCA adivinha (sobretudo na remoção): lista e pergunta qual.
      await this.deps.pending.save(assinanteId, {
        acao: def.name,
        params: { ...value, _candidatos: candidatos },
        fase: 'desambiguando',
        faltando: [],
      });
      const lista = candidatos.map((c, i) => `${i + 1}) ${c.label}`).join('\n');
      return { replyText: `Encontrei mais de um. Qual deles?\n${lista}\nResponda com o número.` };
    } catch (err) {
      this.deps.logger.error({ err }, 'cerebro1: falha ao resolver alvo');
      return { replyText: FALHA_GENERICA };
    }
  }

  private async resolverDesambiguacao(
    assinanteId: string,
    pend: PendingAction,
    norm: string,
  ): Promise<HandlerResult> {
    if (isNegative(norm)) {
      await this.deps.pending.clear(assinanteId);
      return { replyText: 'Ok, cancelei. 👍' };
    }
    const cands = Array.isArray(pend.params._candidatos)
      ? (pend.params._candidatos as Array<{ id: string; label: string }>)
      : [];
    const n = Number.parseInt(norm.replace(/\D/g, ''), 10);
    if (!Number.isInteger(n) || n < 1 || n > cands.length) {
      const lista = cands.map((c, i) => `${i + 1}) ${c.label}`).join('\n');
      return { replyText: `Não entendi qual. Responda com o número:\n${lista}` };
    }
    const def = ACTIONS_BY_NAME[pend.acao];
    if (!def) {
      await this.deps.pending.clear(assinanteId);
      return { replyText: AJUDA_TEXT };
    }
    const { _candidatos, ...value } = pend.params;
    return this.confirmarEdicao(assinanteId, def, value, cands[n - 1]!.id);
  }

  private async confirmarEdicao(
    assinanteId: string,
    def: ActionDef,
    value: Record<string, unknown>,
    id: string,
  ): Promise<HandlerResult> {
    // Re-verifica o alvo por TENANT (id só vale se for do próprio assinante) e
    // monta a confirmação com o registro REAL.
    let texto: string;
    if (COMPROMISSO_ACOES.has(def.name)) {
      const c = await this.deps.store.getCompromissoById(assinanteId, id);
      if (!c) {
        await this.deps.pending.clear(assinanteId);
        return { replyText: 'Não encontrei mais esse compromisso (pode ter sido alterado).' };
      }
      texto =
        def.name === 'cancelar_compromisso'
          ? `⚠️ Vou *REMOVER* a ${labelCompromisso(c)}${c.clienteNome ? `, cliente ${c.clienteNome}` : ''}. ` +
            'Isso é *definitivo* e cancela os lembretes dele. Responda *SIM* para remover.'
          : this.confirmEdicaoCompromisso(c, value);
    } else {
      const p = await this.deps.store.getProcessoById(assinanteId, id);
      if (!p) {
        await this.deps.pending.clear(assinanteId);
        return { replyText: 'Não encontrei mais esse processo (pode ter sido alterado).' };
      }
      texto =
        def.name === 'arquivar_processo'
          ? `Vou *arquivar* o processo ${rotuloProcesso(p)} (sai da rotina; o histórico fica). Responda *SIM* para confirmar.`
          : this.confirmEdicaoProcesso(p, value);
    }
    await this.deps.pending.save(assinanteId, {
      acao: def.name,
      params: { ...value, _alvoId: id },
      fase: 'confirmando',
      faltando: [],
    });
    return { replyText: texto };
  }

  private confirmEdicaoCompromisso(c: CompromissoAlvo, v: Record<string, unknown>): string {
    const partes: string[] = [];
    if (typeof v.novaDataHora === 'string') partes.push(`novo horário: ${formatData(v.novaDataHora)}`);
    if (typeof v.novoTipo === 'string') partes.push(`tipo: ${labelTipo(v.novoTipo)}`);
    if (typeof v.novaDescricao === 'string') partes.push(`descrição: "${v.novaDescricao}"`);
    if (typeof v.novoProcesso === 'string') partes.push(`processo: ${v.novoProcesso}`);
    return `Vou alterar a ${labelCompromisso(c)} — ${partes.join('; ')}. Responda *SIM* para confirmar.`;
  }

  private confirmEdicaoProcesso(p: ProcessoRow, v: Record<string, unknown>): string {
    const partes: string[] = [];
    if (typeof v.novoStatus === 'string') partes.push(`status: ${v.novoStatus}`);
    if (typeof v.novoCliente === 'string') partes.push(`cliente: ${v.novoCliente}`);
    if (typeof v.novaParte === 'string') partes.push(`parte: ${v.novaParte}`);
    if (typeof v.novaArea === 'string') partes.push(`área: ${v.novaArea}`);
    if (typeof v.novaFase === 'string') partes.push(`fase: ${v.novaFase}`);
    if (typeof v.novaInstancia === 'string') partes.push(`instância: ${v.novaInstancia}`);
    return `Vou alterar o processo ${rotuloProcesso(p)} — ${partes.join('; ')}. Responda *SIM* para confirmar.`;
  }

  private async executeEdicao(assinanteId: string, pend: PendingAction): Promise<string> {
    const v = pend.params;
    const id = typeof v._alvoId === 'string' ? v._alvoId : '';
    if (!id) return FALHA_GENERICA;

    if (pend.acao === 'editar_compromisso') {
      const patch: CompromissoPatch = {};
      let aviso = '';
      if (typeof v.novoTipo === 'string') patch.tipo = v.novoTipo as 'audiencia' | 'reuniao' | 'prazo';
      if (typeof v.novaDescricao === 'string') patch.descricao = v.novaDescricao;
      if (typeof v.novoProcesso === 'string') {
        const pid = await this.deps.store.resolveProcessoIdByCnj(assinanteId, v.novoProcesso);
        if (pid) patch.processoId = pid;
        else aviso = ' (não achei o novo processo; mantive o vínculo)';
      }
      if (typeof v.novaDataHora === 'string') {
        patch.dataHora = v.novaDataHora;
        // Remarcação → recalcula 24h/1h da nova data (filtra ao FUTURO; pode dar 0).
        patch.lembreteEm = this.computeLembretes(v.novaDataHora);
      }
      const ok = await this.deps.store.updateCompromisso(assinanteId, id, patch);
      return ok ? `✅ Compromisso atualizado!${aviso}` : 'Não encontrei mais esse compromisso.';
    }

    if (pend.acao === 'cancelar_compromisso') {
      const ok = await this.deps.store.deleteCompromisso(assinanteId, id);
      return ok
        ? '✅ Compromisso removido. Os lembretes dele foram cancelados.'
        : 'Não encontrei mais esse compromisso.';
    }

    if (pend.acao === 'editar_processo') {
      const patch: ProcessoPatch = {};
      if (typeof v.novoStatus === 'string') patch.status = v.novoStatus;
      if (typeof v.novoCliente === 'string')
        patch.clienteId = await this.deps.store.upsertClienteByNome(assinanteId, v.novoCliente);
      if (typeof v.novaParte === 'string') patch.parteContraria = v.novaParte;
      if (typeof v.novaArea === 'string') patch.area = v.novaArea;
      if (typeof v.novaFase === 'string') patch.fase = v.novaFase;
      if (typeof v.novaInstancia === 'string') patch.instancia = v.novaInstancia;
      const ok = await this.deps.store.updateProcesso(assinanteId, id, patch);
      return ok ? '✅ Processo atualizado!' : 'Não encontrei mais esse processo.';
    }

    if (pend.acao === 'arquivar_processo') {
      const ok = await this.deps.store.arquivarProcesso(assinanteId, id);
      return ok
        ? '✅ Processo arquivado (sai da rotina; o histórico fica).'
        : 'Não encontrei mais esse processo.';
    }

    return FALHA_GENERICA;
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

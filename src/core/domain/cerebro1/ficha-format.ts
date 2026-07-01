/**
 * Formatação da ficha do processo para o WHATSAPP (Passo 15). ÚNICA camada que
 * conhece texto/emoji/limites de celular — o objeto `FichaProcesso` em si é
 * neutro e será consumido também pelo dashboard (Fase C).
 *
 * FICHA HONESTA: seção vazia aparece como vazia com clareza (nunca some);
 * documento lido por OCR mantém a marca "confira"; anti-paredão por contagens
 * ("e mais N — quer a lista?") em vez de despejar tudo.
 */
import type { FichaCompromisso, FichaDocumento, FichaProcesso } from '../../ports/ficha.js';
import { labelTipo } from '../cerebro1-actions.js';
import { ehOcr } from '../documentos/formato.js';
import type { ExtracaoStatus } from '../../ports/documentos.js';

const MAX_FUTUROS = 3;
const MAX_RECENTES = 2;
const MAX_DOCS = 5;

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function moeda(valorDecimal: string): string {
  const n = Number(valorDecimal);
  if (!Number.isFinite(n)) return `R$ ${valorDecimal}`;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function linhaCompromisso(c: FichaCompromisso): string {
  const desc = c.descricao ? ` — ${c.descricao}` : '';
  return `• ${labelTipo(c.tipo)} ${dataCurta(c.dataHora)}${desc}`;
}

function linhaDocumento(d: FichaDocumento): string {
  const s = d.extracaoStatus as ExtracaoStatus;
  const marca = ehOcr(s)
    ? ' 🔎 lido por OCR — confira'
    : s === 'sem_texto'
      ? ' (conteúdo não lido — escaneado/ilegível)'
      : '';
  return `• ${d.nome}${marca}`;
}

export function formatarFicha(f: FichaProcesso): string {
  const p = f.processo;
  const linhas: string[] = [];

  // --- Cabeçalho: dados do processo (campo nulo é OMITIDO, não vira "—") ---
  linhas.push(`📁 *Ficha do processo*${p.segredoJustica ? ' 🔒 segredo de justiça' : ''}`);
  if (p.numeroCnj) linhas.push(`nº ${p.numeroCnj}`);
  if (p.clienteNome) linhas.push(`👤 Cliente: ${p.clienteNome}`);
  if (p.parteContraria) linhas.push(`⚖️ Contra: ${p.parteContraria}`);
  const local = [p.vara, p.comarca].filter(Boolean).join(' — ');
  if (local) linhas.push(`🏛️ ${local}`);
  const meta = [
    p.area ? `área: ${p.area}` : null,
    p.fase ? `fase: ${p.fase}` : null,
    p.instancia ? `instância: ${p.instancia}` : null,
    p.status ? `status: ${p.status}` : null,
  ].filter(Boolean);
  if (meta.length > 0) linhas.push(meta.join(' · '));
  if (p.valorCausa) linhas.push(`💵 Valor da causa: ${moeda(p.valorCausa)}`);

  // --- Agenda (futuros + últimos ocorridos) ---
  linhas.push('');
  linhas.push('📅 *Agenda*');
  if (f.agenda.futuros.length === 0 && f.agenda.recentes.length === 0) {
    linhas.push('sem compromissos vinculados ainda.');
  } else {
    for (const c of f.agenda.futuros.slice(0, MAX_FUTUROS)) linhas.push(linhaCompromisso(c));
    if (f.agenda.futuros.length > MAX_FUTUROS) {
      linhas.push(`… e mais ${f.agenda.futuros.length - MAX_FUTUROS} futuros — quer a lista?`);
    }
    if (f.agenda.futuros.length === 0) linhas.push('nada futuro agendado.');
    const recentes = f.agenda.recentes.slice(0, MAX_RECENTES);
    if (recentes.length > 0) {
      linhas.push(`últimos: ${recentes.map((c) => `${labelTipo(c.tipo)} ${dataCurta(c.dataHora)}`).join('; ')}`);
    }
  }

  // --- Documentos ---
  linhas.push('');
  linhas.push(`📎 *Documentos${f.documentos.length > 0 ? ` (${f.documentos.length})` : ''}*`);
  if (f.documentos.length === 0) {
    linhas.push('nenhum vinculado ainda.');
  } else {
    for (const d of f.documentos.slice(0, MAX_DOCS)) linhas.push(linhaDocumento(d));
    if (f.documentos.length > MAX_DOCS) {
      linhas.push(`… e mais ${f.documentos.length - MAX_DOCS} — quer a lista completa?`);
    }
  }

  // --- Financeiro (slot real; o Passo 16 passa a preenchê-lo) ---
  linhas.push('');
  linhas.push('💰 *Financeiro*');
  if (f.financeiro.lancamentos.length === 0) {
    linhas.push('sem lançamentos ainda.');
  } else {
    const pend = f.financeiro.lancamentos.filter((l) => l.status === 'pendente').length;
    const pago = f.financeiro.lancamentos.filter((l) => l.status === 'pago').length;
    const resumo: string[] = [];
    if (pend > 0) resumo.push(`${pend} pendente(s): ${moeda(f.financeiro.totalPendente)}`);
    if (pago > 0) resumo.push(`${pago} pago(s): ${moeda(f.financeiro.totalPago)}`);
    if (resumo.length === 0) resumo.push(`${f.financeiro.lancamentos.length} lançamento(s)`);
    linhas.push(resumo.join(' · '));
  }

  linhas.push('');
  linhas.push('_Dados de apoio — confira nos autos._');
  return linhas.join('\n');
}

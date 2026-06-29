/**
 * Formatação de respostas de LEITURA (ler-depois-formatar).
 *
 * - Compromissos: formatados em CÓDIGO (sem PII estruturada; descrição é nota
 *   livre do próprio usuário).
 * - Processos: têm nome de cliente/parte → vão ao LLM **anonimizados** (Cliente A,
 *   Parte A); a resposta é **reidentificada** localmente. Fallback em código se o
 *   LLM falhar.
 */
import { createAnonymizer } from '../../core/domain/anonymization.js';
import { formatData, labelTipo } from '../../core/domain/cerebro1-actions.js';
import type { CompromissoRow, ProcessoRow } from '../../core/ports/cerebro1.js';
import type { LlmPort } from '../../core/ports/llm.js';

export function formatCompromissos(rows: CompromissoRow[]): string {
  if (rows.length === 0) return 'Você não tem compromissos nesse período. 📅';
  const linhas = rows.map((r) => {
    const desc = r.descricao ? ` — ${r.descricao}` : '';
    return `• ${labelTipo(r.tipo)} — ${formatData(r.dataHora)}${desc}`;
  });
  return `Seus compromissos:\n${linhas.join('\n')}`;
}

export function formatProcessosTemplate(rows: ProcessoRow[]): string {
  if (rows.length === 0) return 'Não encontrei processos com esse critério.';
  const linhas = rows.map((r) => {
    const num = r.numeroCnj ?? 'sem número';
    const cliente = r.clienteNome ? ` — cliente ${r.clienteNome}` : '';
    const parte = r.parteContraria ? ` — contra ${r.parteContraria}` : '';
    const status = r.status ? ` (${r.status})` : '';
    return `• ${num}${cliente}${parte}${status}`;
  });
  return `Seus processos:\n${linhas.join('\n')}`;
}

const SYSTEM_PROC =
  'Você redige, em português e em tom de WhatsApp, uma resposta CURTA listando os ' +
  'processos abaixo. Não invente nada além dos dados. Use os rótulos exatamente como ' +
  'vierem (ex.: "Cliente A", "Parte A").';

export async function respondProcessos(llm: LlmPort, rows: ProcessoRow[]): Promise<string> {
  if (rows.length === 0) return 'Não encontrei processos com esse critério.';

  const anon = createAnonymizer();
  const masked = rows.map((r) => ({
    numero: r.numeroCnj ?? 'sem número',
    cliente: r.clienteNome ? anon.mask(r.clienteNome, 'Cliente') : null,
    parte: r.parteContraria ? anon.mask(r.parteContraria, 'Parte') : null,
    area: r.area,
    status: r.status,
  }));

  try {
    const result = await llm.generate({
      system: SYSTEM_PROC,
      messages: [{ role: 'user', content: JSON.stringify(masked) }],
      maxTokens: 400,
    });
    const text = result.text.trim();
    return text ? anon.reidentify(text) : formatProcessosTemplate(rows);
  } catch {
    // Falha do LLM → fallback determinístico em código (sem expor erro).
    return formatProcessosTemplate(rows);
  }
}

/**
 * Port de TRIBUNAIS (driven) — Cérebro 3. Andamento processual via agregador
 * pago (Judit/Escavador/Codilo/Digesto) atrás desta abstração. Consulta ao vivo
 * + monitoramento por webhook.
 *
 * Apenas assinaturas; sem implementação nesta fase (ver adapters/courts).
 */

export interface MovimentacaoConsulta {
  data: string; // ISO
  descricao: string;
  hash: string; // dedupe
}

export interface ProcessoConsulta {
  numeroCnj: string;
  fonte: string;
  movimentacoes: MovimentacaoConsulta[];
}

export interface CourtsWebhookEvent {
  numeroCnj: string;
  fonte: string;
  movimentacoes: MovimentacaoConsulta[];
}

export interface CourtsPort {
  fetchProcesso(numeroCnj: string): Promise<ProcessoConsulta>;
  /** Assina o monitoramento de movimentações de um processo. */
  subscribeMovimentacoes(numeroCnj: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<boolean>;
  parseWebhookEvent(rawBody: Buffer): CourtsWebhookEvent;
}

/**
 * Porta do LEMBRETE PROATIVO (Passo 10). Back-office: o job lê os lembretes
 * devidos e marca o envio. A seleção é cross-tenant controlada (SECURITY DEFINER);
 * a marcação é atômica/idempotente. Nada de service_role no caminho da mensagem.
 */

/** Um lembrete devido, com o necessário para compor a mensagem (do próprio dono). */
export interface DueReminder {
  assinanteId: string;
  /** Telefone do assinante (destinatário do lembrete — o próprio advogado). */
  telefone: string;
  compromissoId: string;
  /** Instante do lembrete (ISO, UTC). */
  lembreteEm: string;
  /** Instante do compromisso (ISO, UTC) — formatado em BRT na mensagem. */
  dataHora: string;
  tipo: string;
  descricao: string | null;
  processoNumero: string | null;
  clienteNome: string | null;
}

export interface RemindersStore {
  /** Lembretes na janela [agora - graceMin, agora], sem futuros/passados/já enviados. */
  due(agoraIso: string, graceMin: number): Promise<DueReminder[]>;
  /** Marca como enviado (atômico/idempotente). TRUE = marcou agora; FALSE = já estava. */
  marcarEnviado(compromissoId: string, lembreteEmIso: string): Promise<boolean>;
}

/** Envio do lembrete (proativo → template aprovado). Abstrai o canal para testar. */
export interface LembreteSender {
  enviar(telefone: string, mensagem: string): Promise<void>;
}

// --- Passo 16: lembrete de COBRANÇA (parcela de honorário vencendo) ---
// O aviso vai SEMPRE ao PRÓPRIO advogado — o sistema NUNCA cobra o cliente final.

/** Uma cobrança devida (parcela pendente cujo instante caiu na janela). */
export interface DueCobranca {
  assinanteId: string;
  /** Telefone do assinante (destinatário — o próprio advogado). */
  telefone: string;
  lancamentoId: string;
  /** Instante do lembrete (ISO, UTC) — computado do vencimento na seleção. */
  lembreteEm: string;
  /** Vencimento da parcela (YYYY-MM-DD). */
  vencimento: string;
  /** Valor decimal ("1000.00"). */
  valorDecimal: string;
  parcela: number | null;
  totalParcelas: number | null;
  descricao: string | null;
  processoNumero: string | null;
  clienteNome: string | null;
}

export interface CobrancasStore {
  /** Cobranças na janela [agora - graceMin, agora], sem as já enviadas. */
  due(agoraIso: string, graceMin: number): Promise<DueCobranca[]>;
  /** Marca como enviada (atômico/idempotente). TRUE = marcou agora. */
  marcarEnviada(lancamentoId: string, lembreteEmIso: string): Promise<boolean>;
}

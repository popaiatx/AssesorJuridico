/**
 * Porta de FONTE de norma jurídica (Cérebro 2 / sincronização do corpus).
 *
 * Provider-agnostic: o domínio e o motor de sync não conhecem Planalto/LexML/
 * agregador. Hoje o adapter concreto de legislação é o `PlanaltoLegislacaoSource`
 * (texto consolidado + detecção de revogação por marcador). O slot de METADADOS
 * externos (`LegalMetadataSource`) fica como interface pronta, sem implementação —
 * ver `docs/spike-8b-fonte-legislacao.md` (o LexML não entrega vigência legível por
 * máquina nem harvest incremental de forma estável hoje).
 */

/** Referência de uma norma no escopo curado (vem do manifesto). */
export interface NormaRef {
  tipo: 'legislacao' | 'jurisprudencia';
  /** Sigla curta para a citação (ex.: "CDC"). */
  sigla?: string;
  titulo: string;
  identificador: string; // ex.: "Lei nº 8.078/1990"
  fonteUrl: string;
  dataPublicacao: string | null;
}

/** Conteúdo consolidado + status de vigência de uma norma, vindo da fonte. */
export interface NormaConteudo {
  /** Texto consolidado (plain text) para chunk + embed. */
  texto: string;
  vigenciaStatus: 'vigente' | 'revogada';
  /** Id de versão da fonte, quando houver (null no Planalto). */
  fonteVersao: string | null;
}

export interface SourcePort {
  /** Escopo curado a sincronizar. */
  listNormas(): Promise<NormaRef[]>;
  /** Baixa e extrai o conteúdo consolidado + a vigência de uma norma. */
  fetchNorma(ref: NormaRef): Promise<NormaConteudo>;
}

// --- Slot futuro: fonte de METADADOS externa (interface pronta, não implementada) ---

export interface NormaMetadata {
  vigenciaStatus: 'vigente' | 'revogada' | 'desconhecida';
  fonteVersao: string | null;
  revogadaEm: string | null;
}

/**
 * Fonte de metadados de vigência (LexML / normas.leg.br / agregador pago). Reservada
 * para quando uma fonte com vigência legível por máquina e estável for confirmada.
 */
export interface LegalMetadataSource {
  fetchMetadata(ref: NormaRef): Promise<NormaMetadata>;
}

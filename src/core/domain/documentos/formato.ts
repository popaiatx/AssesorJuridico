/**
 * Detecção de formato e utilidades PURAS para documentos (Passo 12A). Sem I/O.
 *
 * Honestidade nos difíceis: PDF-imagem (escaneado) e imagem não têm texto extraível
 * neste passo → o serviço avisa e marca `sem_texto` (ponto cego da busca do 12B);
 * planilhas ficam de fora por ora (aviso claro). Nunca inventar conteúdo.
 */
export type DocFormato = 'txt' | 'pdf' | 'docx' | 'imagem' | 'planilha' | 'desconhecido';

const POR_EXTENSAO: Record<string, DocFormato> = {
  txt: 'txt',
  md: 'txt',
  pdf: 'pdf',
  docx: 'docx',
  jpg: 'imagem',
  jpeg: 'imagem',
  png: 'imagem',
  gif: 'imagem',
  webp: 'imagem',
  heic: 'imagem',
  bmp: 'imagem',
  csv: 'planilha',
  xlsx: 'planilha',
  xls: 'planilha',
};

function extensao(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** Decide o formato pela extensão; se não der, pelo content type. */
export function detectFormato(filename: string, contentType: string | null): DocFormato {
  const porExt = POR_EXTENSAO[extensao(filename)];
  if (porExt) return porExt;

  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('wordprocessingml')) return 'docx'; // .docx
  if (ct.startsWith('image/')) return 'imagem';
  if (ct.includes('csv') || ct.includes('spreadsheet') || ct.includes('excel')) return 'planilha';
  if (ct.startsWith('text/')) return 'txt';
  return 'desconhecido';
}

/** Texto extraído é "aproveitável"? (PDF escaneado costuma vir vazio/insignificante.) */
export function isMeaningfulText(s: string): boolean {
  return s.replace(/\s+/g, '').length >= 20;
}

/** Avisos ao usuário por situação (mantidos juntos para consistência). */
export const AVISO = {
  imagem:
    'Recebi uma imagem/foto. Ainda não consigo ler texto de imagens (OCR em breve), ' +
    'então não dá para resumir nem indexar o conteúdo.',
  pdfEscaneado:
    'Esse PDF parece ser escaneado (imagem), sem texto selecionável. A leitura de ' +
    'imagens (OCR) ainda não está disponível.',
  planilha: 'Planilhas ainda não são processadas como documento.',
  desconhecido: 'Não reconheci o tipo desse arquivo para leitura de texto.',
  falha: 'Não consegui ler o conteúdo desse arquivo.',
  /** Acrescido quando o arquivo é guardado mas sem chaves/resumo. */
  guardadoSemTexto:
    'Guardei o arquivo, mas como não consegui ler o texto dele, ele *não poderá ser ' +
    'encontrado por conteúdo* depois — só por nome/data.',
  /** 12C: referência não resolveu para um documento do próprio assinante. */
  naoEncontrado: 'Não encontrei esse documento no seu acervo.',
  /** 12C: documento sem texto (escaneado) não tem como ser resumido. */
  semTextoResumo:
    'Esse documento foi guardado como imagem/escaneado (sem texto), então não dá para ' +
    'resumir o conteúdo. Posso te mandar o arquivo para você abrir, se quiser.',
  /** 12C: falhou ao reler o arquivo do Storage para gerar um resumo novo. */
  falhaRelerResumo:
    'Não consegui reler o conteúdo desse documento agora para resumir. Tente de novo em ' +
    'instantes.',
} as const;

/** Aviso de apoio acrescentado a TODO resumo exibido (12A/12C). */
export const DISCLAIMER_RESUMO =
  'ℹ️ Resumo de apoio — confira no documento; não substitui a sua análise.';

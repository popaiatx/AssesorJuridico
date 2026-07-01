/**
 * Extração de TEXTO de documentos (Passo 12A). Usa libs por formato (raw HTTP-free):
 * PDF → pdf-parse; .docx → mammoth; .txt → decodificação. Parsers INJETÁVEIS para
 * testar sem binários reais. Se não há texto aproveitável (escaneado/imagem) ou
 * formato fora do escopo, retorna `sem_texto` com aviso — nunca inventa.
 */
import * as mammoth from 'mammoth';
// Importa o módulo interno do pdf-parse para evitar o "modo debug" do index.js.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { AVISO, detectFormato, isMeaningfulText, type DocFormato } from '../../core/domain/documentos/formato.js';
import type { ExtracaoStatus } from '../../core/ports/documentos.js';

export interface ExtracaoResultado {
  texto: string;
  status: ExtracaoStatus;
  formato: DocFormato;
  aviso?: string;
}

export interface ExtratoParsers {
  pdf: (b: Buffer) => Promise<{ text: string }>;
  docx: (b: Buffer) => Promise<{ value: string }>;
}

const defaultParsers: ExtratoParsers = {
  pdf: (b) => pdfParse(b) as Promise<{ text: string }>,
  docx: (b) => mammoth.extractRawText({ buffer: b }),
};

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (utf8.includes('�')) return new TextDecoder('latin1').decode(bytes); // fallback
  return utf8;
}

export async function extrairTexto(
  bytes: Uint8Array,
  filename: string,
  contentType: string | null,
  parsers: ExtratoParsers = defaultParsers,
): Promise<ExtracaoResultado> {
  const formato = detectFormato(filename, contentType);

  if (formato === 'imagem') return { texto: '', status: 'sem_texto', formato, aviso: AVISO.imagem };
  if (formato === 'planilha') return { texto: '', status: 'sem_texto', formato, aviso: AVISO.planilha };
  if (formato === 'desconhecido')
    return { texto: '', status: 'sem_texto', formato, aviso: AVISO.desconhecido };

  const buf = Buffer.from(bytes);
  try {
    if (formato === 'txt') {
      const texto = decodeText(bytes).trim();
      return isMeaningfulText(texto)
        ? { texto, status: 'ok', formato }
        : { texto: '', status: 'sem_texto', formato, aviso: AVISO.falha };
    }
    if (formato === 'pdf') {
      const { text } = await parsers.pdf(buf);
      const texto = (text ?? '').trim();
      return isMeaningfulText(texto)
        ? { texto, status: 'ok', formato }
        : { texto: '', status: 'sem_texto', formato, aviso: AVISO.pdfEscaneado };
    }
    // docx
    const { value } = await parsers.docx(buf);
    const texto = (value ?? '').trim();
    return isMeaningfulText(texto)
      ? { texto, status: 'ok', formato }
      : { texto: '', status: 'sem_texto', formato, aviso: AVISO.falha };
  } catch {
    return { texto: '', status: 'falha', formato, aviso: AVISO.falha };
  }
}

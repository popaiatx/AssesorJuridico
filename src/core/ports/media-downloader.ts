/**
 * Port de DOWNLOAD de mídia (Passo 12A). Abstrai o canal (WhatsApp) que entrega o
 * arquivo recebido. O caminho extrair→guardar (DocumentoService) NÃO depende deste
 * port — ele recebe bytes; este port só traz os bytes do WhatsApp (depende do chip).
 */
export interface MidiaBaixada {
  bytes: Uint8Array;
  contentType: string | null;
  filename: string | null;
}

export interface MediaDownloader {
  download(mediaId: string): Promise<MidiaBaixada>;
}

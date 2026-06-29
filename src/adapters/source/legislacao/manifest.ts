/**
 * Conjunto inicial de LEGISLAÇÃO REAL (fontes oficiais gratuitas — Planalto) que
 * define o ESCOPO CURADO do corpus do Cérebro 2. A sincronização (8B) mantém estas
 * normas frescas; adicionar uma norma = acrescentar um item aqui e re-rodar o sync.
 * URLs são páginas consolidadas do Planalto (a vigência é detectada no texto).
 */
export interface ManifestItem {
  sigla: string;
  titulo: string;
  identificador: string;
  fonteUrl: string;
  dataPublicacao?: string;
}

export const CORPUS_MANIFEST: ManifestItem[] = [
  {
    sigla: 'CF/88',
    titulo: 'Constituição da República Federativa do Brasil de 1988',
    identificador: 'Constituição Federal/1988',
    fonteUrl: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
    dataPublicacao: '1988-10-05',
  },
  {
    sigla: 'CC',
    titulo: 'Código Civil',
    identificador: 'Lei nº 10.406/2002',
    fonteUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm',
    dataPublicacao: '2002-01-10',
  },
  {
    sigla: 'CPC',
    titulo: 'Código de Processo Civil',
    identificador: 'Lei nº 13.105/2015',
    fonteUrl: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm',
    dataPublicacao: '2015-03-16',
  },
  {
    sigla: 'CLT',
    titulo: 'Consolidação das Leis do Trabalho',
    identificador: 'Decreto-Lei nº 5.452/1943',
    fonteUrl: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm',
    dataPublicacao: '1943-05-01',
  },
  {
    sigla: 'CDC',
    titulo: 'Código de Defesa do Consumidor',
    identificador: 'Lei nº 8.078/1990',
    fonteUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm',
    dataPublicacao: '1990-09-11',
  },
  {
    sigla: 'Lei 8.213/91',
    titulo: 'Planos de Benefícios da Previdência Social',
    identificador: 'Lei nº 8.213/1991',
    fonteUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l8213compilado.htm',
    dataPublicacao: '1991-07-24',
  },
];

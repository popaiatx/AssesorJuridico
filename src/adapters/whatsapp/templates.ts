/**
 * Registro de templates do WhatsApp. Mensagens proativas (fora da janela de 24h)
 * só podem ser enviadas por TEMPLATE aprovado pela Meta. Aqui mantemos o
 * cadastro (nome, categoria, idioma, parâmetros); a APROVAÇÃO na Meta é manual
 * (PENDENTE — ver README).
 */

export type TemplateCategory = 'utility' | 'marketing' | 'authentication';

export interface TemplateDefinition {
  /** Nome exato aprovado na Meta. */
  name: string;
  category: TemplateCategory;
  /** Código de idioma (ex.: 'pt_BR'). */
  language: string;
  /** Nomes dos parâmetros do corpo, na ordem em que aparecem ({{1}}, {{2}}…). */
  params: string[];
}

/**
 * Template inicial (utilitário) para lembretes/avisos transacionais. Precisa ser
 * aprovado na Meta com este nome e idioma antes do uso real.
 */
export const TEMPLATES: Record<string, TemplateDefinition> = {
  lembrete_generico: {
    name: 'lembrete_generico',
    category: 'utility',
    language: 'pt_BR',
    params: ['mensagem'],
  },
};

export function getTemplate(name: string): TemplateDefinition | undefined {
  return TEMPLATES[name];
}

/**
 * Registro TIPADO de ações do Cérebro 1 (puro). O LLM escolhe uma ação (tool-use)
 * e extrai parâmetros; aqui validamos e normalizamos. NENHUM campo de tenant: o
 * `assinante_id` é injetado pelo código na execução, nunca pelo modelo.
 *
 * `validate` devolve { value, faltando, erro }:
 *  - value: parâmetros já normalizados (o que veio válido);
 *  - faltando: campos obrigatórios ainda ausentes (pergunta só o que falta);
 *  - erro: mensagem quando algo veio inválido (pede correção).
 */
export type ActionKind = 'leitura' | 'escrita' | 'edicao' | 'ajuda';

export interface ValidationResult {
  value: Record<string, unknown>;
  faltando: string[];
  erro: string | null;
}

export interface ActionDef {
  name: string;
  kind: ActionKind;
  description: string;
  inputSchema: Record<string, unknown>;
  validate(input: Record<string, unknown>): ValidationResult;
  confirmText?(value: Record<string, unknown>): string;
}

/** Perguntas objetivas por campo (slot-filling: pergunta só o que falta). */
export const PERGUNTAS: Record<string, string> = {
  tipo: 'É *audiência*, *reunião* ou *prazo*?',
  data_hora: 'Para quando? (data e hora, ex.: 02/07 às 14h)',
  descricao: 'Qual a descrição? (ex.: "Audiência de instrução")',
};

const TIPOS = ['audiencia', 'reuniao', 'prazo'];

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeCnj(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 20 ? digits : null;
}

export function formatData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });
}

export function labelTipo(tipo: string): string {
  return tipo === 'audiencia' ? 'audiência' : tipo === 'reuniao' ? 'reunião' : 'prazo';
}

const criarCompromisso: ActionDef = {
  name: 'criar_compromisso',
  kind: 'escrita',
  description:
    'Agendar um compromisso ou prazo do escritório (audiência, reunião ou prazo), com data/hora e descrição.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo: { type: 'string', enum: TIPOS, description: 'audiencia | reuniao | prazo' },
      data_hora: { type: 'string', description: 'Data e hora em ISO 8601 (com fuso), ex.: 2026-07-02T14:00:00-03:00' },
      descricao: { type: 'string', description: 'Descrição curta do compromisso' },
      numero_cnj: { type: 'string', description: 'Número CNJ do processo a vincular (opcional)' },
    },
    required: ['tipo', 'data_hora', 'descricao'],
  },
  validate(input) {
    const value: Record<string, unknown> = {};
    const faltando: string[] = [];
    let erro: string | null = null;

    const tipo = str(input.tipo).toLowerCase();
    if (TIPOS.includes(tipo)) value.tipo = tipo;
    else faltando.push('tipo');

    const dh = str(input.data_hora);
    if (!dh) faltando.push('data_hora');
    else {
      const d = new Date(dh);
      if (Number.isNaN(d.getTime())) {
        erro = 'Não entendi a data e a hora. Pode informar, ex.: 02/07 às 14h?';
      } else {
        value.dataHora = d.toISOString();
      }
    }

    const desc = str(input.descricao);
    if (desc) value.descricao = desc;
    else faltando.push('descricao');

    const cnjRaw = str(input.numero_cnj);
    if (cnjRaw) {
      const cnj = normalizeCnj(cnjRaw);
      if (!cnj) erro = 'O número do processo (CNJ) precisa ter 20 dígitos. Pode conferir?';
      else value.numeroCnj = cnj;
    }

    return { value, faltando, erro };
  },
  confirmText(value) {
    const v = value as { tipo: string; dataHora: string; descricao: string; numeroCnj?: string };
    let s = `Confirmar: ${labelTipo(v.tipo)} em ${formatData(v.dataHora)} — "${v.descricao}"`;
    if (v.numeroCnj) s += ` (processo ${v.numeroCnj})`;
    return `${s}? Responda *SIM* para salvar.`;
  },
};

const listarCompromissos: ActionDef = {
  name: 'listar_compromissos',
  kind: 'leitura',
  description: 'Listar os compromissos/prazos do escritório por período.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      periodo: { type: 'string', enum: ['hoje', 'semana', 'proximos', 'todos'] },
    },
    required: [],
  },
  validate(input) {
    const periodo = str(input.periodo).toLowerCase();
    const valid = ['hoje', 'semana', 'proximos', 'todos'].includes(periodo) ? periodo : 'proximos';
    return { value: { periodo: valid }, faltando: [], erro: null };
  },
};

const cadastrarProcesso: ActionDef = {
  name: 'cadastrar_processo',
  kind: 'escrita',
  description: 'Cadastrar um processo do escritório (número CNJ opcional, cliente, parte contrária, área, status).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      numero_cnj: { type: 'string', description: 'Número CNJ (opcional)' },
      cliente_nome: { type: 'string', description: 'Nome do cliente (opcional)' },
      parte_contraria: { type: 'string', description: 'Parte contrária (opcional)' },
      area: { type: 'string', description: 'Área do direito (opcional)' },
      status: { type: 'string', description: 'Status do processo (opcional)' },
    },
    required: [],
  },
  validate(input) {
    const value: Record<string, unknown> = {};
    let erro: string | null = null;

    const cnjRaw = str(input.numero_cnj);
    if (cnjRaw) {
      const cnj = normalizeCnj(cnjRaw);
      if (!cnj) erro = 'O número do processo (CNJ) precisa ter 20 dígitos. Pode conferir?';
      else value.numeroCnj = cnj;
    }
    const cliente = str(input.cliente_nome);
    if (cliente) value.clienteNome = cliente;
    const parte = str(input.parte_contraria);
    if (parte) value.parteContraria = parte;
    const area = str(input.area);
    if (area) value.area = area;
    const status = str(input.status);
    if (status) value.status = status;

    if (!erro && !value.numeroCnj && !value.clienteNome && !value.parteContraria) {
      erro = 'Para cadastrar, me diga ao menos o número do processo, o cliente ou a parte contrária.';
    }
    return { value, faltando: [], erro };
  },
  confirmText(value) {
    const v = value as {
      numeroCnj?: string;
      clienteNome?: string;
      parteContraria?: string;
      area?: string;
      status?: string;
    };
    const partes: string[] = [];
    if (v.numeroCnj) partes.push(`nº ${v.numeroCnj}`);
    if (v.clienteNome) partes.push(`cliente ${v.clienteNome}`);
    if (v.parteContraria) partes.push(`contra ${v.parteContraria}`);
    if (v.area) partes.push(`área ${v.area}`);
    if (v.status) partes.push(`status ${v.status}`);
    return `Confirmar: cadastrar processo ${partes.join(', ')}? Responda *SIM* para salvar.`;
  },
};

const listarProcessos: ActionDef = {
  name: 'listar_processos',
  kind: 'leitura',
  description: 'Listar processos do escritório, opcionalmente filtrando por cliente ou status.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cliente_nome: { type: 'string', description: 'Filtrar por cliente (opcional)' },
      status: { type: 'string', description: 'Filtrar por status (opcional)' },
    },
    required: [],
  },
  validate(input) {
    const value: Record<string, unknown> = {};
    const cliente = str(input.cliente_nome);
    if (cliente) value.clienteNome = cliente;
    const status = str(input.status);
    if (status) value.status = status;
    return { value, faltando: [], erro: null };
  },
};

const consultarProcesso: ActionDef = {
  name: 'consultar_processo',
  kind: 'leitura',
  description: 'Consultar um processo específico pelo número CNJ ou pela parte.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      numero_cnj: { type: 'string', description: 'Número CNJ (opcional)' },
      parte: { type: 'string', description: 'Nome de uma parte (opcional)' },
    },
    required: [],
  },
  validate(input) {
    const value: Record<string, unknown> = {};
    let erro: string | null = null;
    const cnjRaw = str(input.numero_cnj);
    if (cnjRaw) {
      const cnj = normalizeCnj(cnjRaw);
      if (!cnj) erro = 'O número do processo (CNJ) precisa ter 20 dígitos. Pode conferir?';
      else value.numeroCnj = cnj;
    }
    const parte = str(input.parte);
    if (parte) value.parte = parte;
    if (!erro && !value.numeroCnj && !value.parte) {
      erro = 'Me diga o número do processo ou a parte para eu consultar.';
    }
    return { value, faltando: [], erro };
  },
};

// --- Passo 11: editar/remover (ações de EDIÇÃO; o alvo é resolvido pelo handler,
// que monta a confirmação com o registro REAL e desambigua quando há vários) ---

const SEL_COMPROMISSO = {
  alvo_processo: { type: 'string', description: 'CNJ do processo do compromisso a alterar/remover (opcional)' },
  alvo_tipo: { type: 'string', enum: TIPOS, description: 'tipo do compromisso alvo (opcional)' },
  alvo_dia: { type: 'string', description: 'dia do compromisso alvo em ISO date YYYY-MM-DD (opcional)' },
};

function parseSelectorCompromisso(input: Record<string, unknown>): {
  sel: Record<string, unknown>;
  erro: string | null;
} {
  const sel: Record<string, unknown> = {};
  let erro: string | null = null;
  const ap = str(input.alvo_processo);
  if (ap) {
    const cnj = normalizeCnj(ap);
    if (!cnj) erro = 'O número do processo (CNJ) precisa ter 20 dígitos. Pode conferir?';
    else sel.alvoProcesso = cnj;
  }
  const at = str(input.alvo_tipo).toLowerCase();
  if (TIPOS.includes(at)) sel.alvoTipo = at;
  const ad = str(input.alvo_dia);
  if (ad) {
    const d = new Date(ad);
    if (Number.isNaN(d.getTime())) erro = erro ?? 'Não entendi o dia do compromisso. Pode informar a data?';
    else sel.alvoDia = ad.slice(0, 10);
  }
  return { sel, erro };
}

const SEM_SELETOR_COMPROMISSO =
  'Qual compromisso? Me diga o processo, o tipo (audiência/reunião/prazo) ou o dia.';

const editarCompromisso: ActionDef = {
  name: 'editar_compromisso',
  kind: 'edicao',
  description:
    'Alterar um compromisso existente (mudar data/hora, tipo, descrição ou o processo vinculado). ' +
    'Identifique o alvo por processo, tipo e/ou dia.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...SEL_COMPROMISSO,
      nova_data_hora: { type: 'string', description: 'Novo horário em ISO 8601 com fuso (opcional)' },
      novo_tipo: { type: 'string', enum: TIPOS, description: 'Novo tipo (opcional)' },
      nova_descricao: { type: 'string', description: 'Nova descrição (opcional)' },
      novo_processo: { type: 'string', description: 'CNJ do novo processo a vincular (opcional)' },
    },
    required: [],
  },
  validate(input) {
    const { sel, erro: erroSel } = parseSelectorCompromisso(input);
    const value: Record<string, unknown> = { ...sel };
    let erro = erroSel;

    const ndh = str(input.nova_data_hora);
    if (ndh) {
      const d = new Date(ndh);
      if (Number.isNaN(d.getTime())) erro = erro ?? 'Não entendi a nova data e hora. Ex.: 02/07 às 14h?';
      else value.novaDataHora = d.toISOString();
    }
    const nt = str(input.novo_tipo).toLowerCase();
    if (TIPOS.includes(nt)) value.novoTipo = nt;
    const nd = str(input.nova_descricao);
    if (nd) value.novaDescricao = nd;
    const np = str(input.novo_processo);
    if (np) {
      const cnj = normalizeCnj(np);
      if (!cnj) erro = erro ?? 'O número do novo processo (CNJ) precisa ter 20 dígitos.';
      else value.novoProcesso = cnj;
    }

    const temSelector = value.alvoProcesso || value.alvoTipo || value.alvoDia;
    const temMudanca = value.novaDataHora || value.novoTipo || value.novaDescricao || value.novoProcesso;
    if (!erro && !temSelector) erro = SEM_SELETOR_COMPROMISSO;
    else if (!erro && !temMudanca)
      erro = 'O que você quer mudar? (nova data/hora, novo tipo, descrição ou processo)';
    return { value, faltando: [], erro };
  },
};

const cancelarCompromisso: ActionDef = {
  name: 'cancelar_compromisso',
  kind: 'edicao',
  description:
    'Remover/cancelar um compromisso existente. Identifique o alvo por processo, tipo e/ou dia. ' +
    'AÇÃO DESTRUTIVA: o handler confirma mostrando o registro real antes de remover.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { ...SEL_COMPROMISSO },
    required: [],
  },
  validate(input) {
    const { sel, erro } = parseSelectorCompromisso(input);
    const temSelector = sel.alvoProcesso || sel.alvoTipo || sel.alvoDia;
    return {
      value: sel,
      faltando: [],
      erro: erro ?? (temSelector ? null : SEM_SELETOR_COMPROMISSO),
    };
  },
};

const SEL_PROCESSO = {
  alvo_cnj: { type: 'string', description: 'CNJ do processo alvo (opcional)' },
  alvo_cliente: { type: 'string', description: 'Nome do cliente do processo alvo (opcional)' },
  alvo_parte: { type: 'string', description: 'Parte contrária do processo alvo (opcional)' },
};

function parseSelectorProcesso(input: Record<string, unknown>): {
  sel: Record<string, unknown>;
  erro: string | null;
} {
  const sel: Record<string, unknown> = {};
  let erro: string | null = null;
  const ac = str(input.alvo_cnj);
  if (ac) {
    const cnj = normalizeCnj(ac);
    if (!cnj) erro = 'O número do processo (CNJ) precisa ter 20 dígitos. Pode conferir?';
    else sel.alvoCnj = cnj;
  }
  const acl = str(input.alvo_cliente);
  if (acl) sel.alvoCliente = acl;
  const ap = str(input.alvo_parte);
  if (ap) sel.alvoParte = ap;
  return { sel, erro };
}

const SEM_SELETOR_PROCESSO = 'Qual processo? Me diga o número (CNJ), o cliente ou a parte.';

const editarProcesso: ActionDef = {
  name: 'editar_processo',
  kind: 'edicao',
  description:
    'Alterar campos de um processo existente (status, cliente, parte contrária ou área). ' +
    'Identifique o alvo por CNJ, cliente ou parte.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...SEL_PROCESSO,
      novo_status: { type: 'string', description: 'Novo status (opcional)' },
      novo_cliente: { type: 'string', description: 'Novo cliente (opcional)' },
      nova_parte: { type: 'string', description: 'Nova parte contrária (opcional)' },
      nova_area: { type: 'string', description: 'Nova área (opcional)' },
    },
    required: [],
  },
  validate(input) {
    const { sel, erro: erroSel } = parseSelectorProcesso(input);
    const value: Record<string, unknown> = { ...sel };
    let erro = erroSel;
    const ns = str(input.novo_status);
    if (ns) value.novoStatus = ns;
    const nc = str(input.novo_cliente);
    if (nc) value.novoCliente = nc;
    const npar = str(input.nova_parte);
    if (npar) value.novaParte = npar;
    const na = str(input.nova_area);
    if (na) value.novaArea = na;

    const temSelector = value.alvoCnj || value.alvoCliente || value.alvoParte;
    const temMudanca = value.novoStatus || value.novoCliente || value.novaParte || value.novaArea;
    if (!erro && !temSelector) erro = SEM_SELETOR_PROCESSO;
    else if (!erro && !temMudanca)
      erro = 'O que você quer mudar no processo? (status, cliente, parte ou área)';
    return { value, faltando: [], erro };
  },
};

const arquivarProcessoAcao: ActionDef = {
  name: 'arquivar_processo',
  kind: 'edicao',
  description:
    'Arquivar um processo (deixa de aparecer na rotina, mas mantém o histórico). ' +
    'Identifique o alvo por CNJ, cliente ou parte.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { ...SEL_PROCESSO },
    required: [],
  },
  validate(input) {
    const { sel, erro } = parseSelectorProcesso(input);
    const temSelector = sel.alvoCnj || sel.alvoCliente || sel.alvoParte;
    return { value: sel, faltando: [], erro: erro ?? (temSelector ? null : SEM_SELETOR_PROCESSO) };
  },
};

const ajudaAssessor: ActionDef = {
  name: 'ajuda_assessor',
  kind: 'ajuda',
  description: 'Explicar, em linguagem simples, o que a estagiárIA organiza.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  validate() {
    return { value: {}, faltando: [], erro: null };
  },
};

export const ACTIONS: ActionDef[] = [
  criarCompromisso,
  listarCompromissos,
  editarCompromisso,
  cancelarCompromisso,
  cadastrarProcesso,
  listarProcessos,
  consultarProcesso,
  editarProcesso,
  arquivarProcessoAcao,
  ajudaAssessor,
];

export const ACTIONS_BY_NAME: Record<string, ActionDef> = Object.fromEntries(
  ACTIONS.map((a) => [a.name, a]),
);

const AFIRMATIVO = ['sim', 'confirmar', 'confirmo', 'pode', 'isso', 'ok', 'claro', 'positivo', 'aceito'];
const NEGATIVO = ['nao', 'cancelar', 'cancela', 'deixa', 'negativo', 'para'];

export function isAffirmative(norm: string): boolean {
  return AFIRMATIVO.includes(norm);
}
export function isNegative(norm: string): boolean {
  return NEGATIVO.includes(norm);
}

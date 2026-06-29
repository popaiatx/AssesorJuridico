/**
 * Máquina de estados do onboarding — PURA e DETERMINÍSTICA (sem LLM, sem I/O).
 * `advanceOnboarding` recebe o estado atual e o texto da mensagem e devolve a
 * próxima ação. O handler executa os efeitos (persistir, criar, auditar).
 *
 * Robustez conversacional (R1): comando cancelar/recomeçar; mensagem vazia/só
 * mídia → pede o dado em texto; resposta fora do roteiro → re-explica e PERMANECE
 * na etapa (validação nunca é pulada). Mensagens com propósito + exemplo (R2).
 */
import { normalizeText, parseOab, validateDocumento, validateEmail, validateNome } from './validators.js';

export type OnboardingEtapa =
  | 'aguardando_nome'
  | 'aguardando_oab'
  | 'aguardando_documento'
  | 'aguardando_email'
  | 'aguardando_consentimento';

export interface OnboardingDados {
  nome?: string;
  oabNumero?: string;
  oabSeccional?: string;
  documento?: string;
  email?: string;
}

export interface OnboardingState {
  etapa: OnboardingEtapa;
  dados: OnboardingDados;
}

/** Campos completos para criar o assinante. */
export interface OnboardingDadosCompletos {
  nome: string;
  oabNumero: string;
  oabSeccional: string;
  documento: string;
  email: string;
}

export type OnboardingOutcome =
  | { kind: 'continuar'; etapa: OnboardingEtapa; dados: OnboardingDados; reply: string; evento: string }
  | { kind: 'criar'; dados: OnboardingDadosCompletos; reply: string; evento: string };

export const CONSENT_VERSION = '1.0';

const CONSENT_TEXT =
  '📄 *Termo de uso de IA*\n' +
  'Este assistente usa inteligência artificial para te apoiar. As respostas são de ' +
  'apoio e NÃO substituem sua análise — você é o responsável final. Conteúdo jurídico ' +
  'é fornecido com a fonte (lei/precedente); sem fonte, o assistente recusa. Seus dados ' +
  'são tratados conforme a LGPD.';

const ASK = {
  nome: 'Para começar, qual é o seu nome completo? (como deve aparecer na sua conta)',
  oab: 'Qual o seu número de inscrição na OAB, com a seccional? Identifica seu registro profissional. Ex.: 123456/SP',
  documento: 'Qual o seu CPF ou CNPJ? Usamos para identificar sua conta. Ex.: 123.456.789-09',
  email: 'Qual o seu e-mail? Para contato e recuperação de acesso. Ex.: nome@escritorio.com.br',
  consentimento: `${CONSENT_TEXT}\n\nVocê aceita? Responda *ACEITO* para concordar e concluir o cadastro.`,
};

const WELCOME =
  '👋 Olá! Sou seu assessor jurídico no WhatsApp. Vou criar sua conta (gratuita em ' +
  'teste) com algumas perguntas rápidas. A qualquer momento você pode escrever ' +
  '*cancelar* para recomeçar.';

const ACTIVATION =
  '✅ Pronto! Sua conta está ativa em *teste (trial)* — sem custo agora. Se decidir ' +
  'continuar, a cobrança vem depois e eu te aviso antes. Por enquanto você já pode ' +
  'conversar comigo e tirar dúvidas gerais. Recursos como processos, prazos, financeiro ' +
  'e documentos estão chegando. Pode mandar sua primeira pergunta. 🙂';

const RESTART = `Sem problema, vamos recomeçar do início. ${ASK.nome}`;
const PRECISA_TEXTO = 'Preciso que você responda em texto. ';

function isRestart(norm: string): boolean {
  return ['cancelar', 'recomecar', 'reiniciar'].some((c) => norm === c || norm.startsWith(c));
}

function isAccept(norm: string): boolean {
  return ['aceito', 'aceitar', 'concordo', 'sim'].includes(norm);
}

function reAsk(state: OnboardingState, prefix: string, evento: string): OnboardingOutcome {
  return { kind: 'continuar', etapa: state.etapa, dados: state.dados, reply: prefix + ASK_FOR[state.etapa], evento };
}

const ASK_FOR: Record<OnboardingEtapa, string> = {
  aguardando_nome: ASK.nome,
  aguardando_oab: ASK.oab,
  aguardando_documento: ASK.documento,
  aguardando_email: ASK.email,
  aguardando_consentimento: ASK.consentimento,
};

/**
 * Avança o onboarding. `state` é null no primeiro contato de um número novo.
 */
export function advanceOnboarding(
  state: OnboardingState | null,
  rawText: string,
): OnboardingOutcome {
  const text = (rawText ?? '').trim();
  const norm = normalizeText(text);

  // Comando cancelar/recomeçar a qualquer momento (R1).
  if (state && isRestart(norm)) {
    return { kind: 'continuar', etapa: 'aguardando_nome', dados: {}, reply: RESTART, evento: 'reiniciado' };
  }

  // Primeiro contato → boas-vindas e pede o nome (não consome o texto como nome).
  if (!state) {
    return {
      kind: 'continuar',
      etapa: 'aguardando_nome',
      dados: {},
      reply: `${WELCOME}\n\n${ASK.nome}`,
      evento: 'iniciado',
    };
  }

  // Mensagem vazia / só mídia → pede o dado em texto (R1), sem quebrar.
  if (text.length === 0) {
    return reAsk(state, PRECISA_TEXTO, 'sem_texto');
  }

  switch (state.etapa) {
    case 'aguardando_nome': {
      const nome = validateNome(text);
      if (!nome) return reAsk(state, 'Não entendi seu nome. ', 'nome_invalido');
      return continuar('aguardando_oab', { ...state.dados, nome }, ASK.oab, 'validou_nome');
    }
    case 'aguardando_oab': {
      const oab = parseOab(text);
      if (!oab) return reAsk(state, 'Não consegui ler sua OAB. ', 'oab_invalida');
      return continuar(
        'aguardando_documento',
        { ...state.dados, oabNumero: oab.numero, oabSeccional: oab.seccional },
        ASK.documento,
        'validou_oab',
      );
    }
    case 'aguardando_documento': {
      const doc = validateDocumento(text);
      if (!doc) return reAsk(state, 'Esse CPF/CNPJ não parece válido. ', 'documento_invalido');
      return continuar('aguardando_email', { ...state.dados, documento: doc }, ASK.email, 'validou_documento');
    }
    case 'aguardando_email': {
      const email = validateEmail(text);
      if (!email) return reAsk(state, 'Esse e-mail não parece válido. ', 'email_invalido');
      return continuar(
        'aguardando_consentimento',
        { ...state.dados, email },
        ASK.consentimento,
        'validou_email',
      );
    }
    case 'aguardando_consentimento': {
      if (!isAccept(norm)) {
        return reAsk(
          state,
          'Para concluir, preciso do seu aceite ao uso de IA. Responda *ACEITO* (ou *cancelar* para recomeçar). ',
          'consentimento_pendente',
        );
      }
      const d = state.dados;
      // Por construção, todos os campos estão preenchidos nesta etapa.
      if (!d.nome || !d.oabNumero || !d.oabSeccional || !d.documento || !d.email) {
        return { kind: 'continuar', etapa: 'aguardando_nome', dados: {}, reply: RESTART, evento: 'estado_incompleto' };
      }
      return {
        kind: 'criar',
        dados: {
          nome: d.nome,
          oabNumero: d.oabNumero,
          oabSeccional: d.oabSeccional,
          documento: d.documento,
          email: d.email,
        },
        reply: ACTIVATION,
        evento: 'consentiu',
      };
    }
  }
}

function continuar(
  etapa: OnboardingEtapa,
  dados: OnboardingDados,
  reply: string,
  evento: string,
): OnboardingOutcome {
  return { kind: 'continuar', etapa, dados, reply, evento };
}

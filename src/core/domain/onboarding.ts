/**
 * Máquina de estados do onboarding — PURA e DETERMINÍSTICA (sem LLM, sem I/O).
 *
 * Cadastro ENXUTO (barreira de entrada baixa): intro acolhedora → nome → e-mail →
 * consentimento (1 toque) → criar (trial de 3 dias). Sem OAB e sem documento.
 *
 * Robustez (R1): comando cancelar/recomeçar; mensagem vazia/só mídia → pede o
 * dado em texto; resposta fora do roteiro → re-explica e PERMANECE na etapa.
 * Mensagens com propósito + exemplo (R2).
 */
import { normalizeText, validateEmail, validateNome } from './validators.js';

/** Dias de teste grátis antes de exigir pagamento. */
export const TRIAL_DIAS = 3;

export type OnboardingEtapa = 'aguardando_nome' | 'aguardando_email' | 'aguardando_consentimento';

export interface OnboardingDados {
  nome?: string;
  email?: string;
}

export interface OnboardingState {
  etapa: OnboardingEtapa;
  dados: OnboardingDados;
}

/** Campos completos para criar o assinante. */
export interface OnboardingDadosCompletos {
  nome: string;
  email: string;
}

export type OnboardingOutcome =
  | { kind: 'continuar'; etapa: OnboardingEtapa; dados: OnboardingDados; reply: string; evento: string }
  | { kind: 'criar'; dados: OnboardingDadosCompletos; reply: string; evento: string };

export const CONSENT_VERSION = '1.0';

const CONSENT_TEXT =
  '📄 *Termo de uso de IA*\n' +
  'A estagiárIA usa inteligência artificial para te apoiar. As respostas são de ' +
  'apoio e NÃO substituem orientação profissional. Conteúdo jurídico é fornecido com ' +
  'a fonte (lei/precedente); sem fonte, ela recusa. Seus dados são tratados ' +
  'conforme a LGPD.';

const ASK = {
  nome: 'Como posso te chamar? (seu nome)',
  email: 'Qual o seu e-mail? Uso para contato e recuperação de acesso. Ex.: nome@email.com',
  consentimento: `${CONSENT_TEXT}\n\nVocê aceita? Responda *ACEITO* para concordar e começar.`,
};

const WELCOME =
  '👋 Olá! Eu sou a estagiárIA — sua assistente jurídica no WhatsApp. Posso te ajudar a entender temas ' +
  'jurídicos em linguagem simples e, em breve, organizar processos, prazos e documentos. ' +
  'Funciona para advogados, estudantes e curiosos — e você tem *3 dias grátis* para ' +
  'experimentar. O cadastro é rapidinho (e a qualquer momento você pode escrever ' +
  '*cancelar* para recomeçar).';

const ACTIVATION =
  '✅ Pronto, sua conta está ativa! Você tem *3 dias grátis* para usar à vontade — sem ' +
  'custo agora. Depois desse período, vou te mostrar como continuar. Pode mandar sua ' +
  'primeira pergunta. 🙂';

const RESTART = `Sem problema, vamos recomeçar. ${ASK.nome}`;
const PRECISA_TEXTO = 'Preciso que você responda em texto. ';

const ASK_FOR: Record<OnboardingEtapa, string> = {
  aguardando_nome: ASK.nome,
  aguardando_email: ASK.email,
  aguardando_consentimento: ASK.consentimento,
};

function isRestart(norm: string): boolean {
  return ['cancelar', 'recomecar', 'reiniciar'].some((c) => norm === c || norm.startsWith(c));
}

function isAccept(norm: string): boolean {
  return ['aceito', 'aceitar', 'concordo', 'sim'].includes(norm);
}

function continuar(
  etapa: OnboardingEtapa,
  dados: OnboardingDados,
  reply: string,
  evento: string,
): OnboardingOutcome {
  return { kind: 'continuar', etapa, dados, reply, evento };
}

function reAsk(state: OnboardingState, prefix: string, evento: string): OnboardingOutcome {
  return continuar(state.etapa, state.dados, prefix + ASK_FOR[state.etapa], evento);
}

/** Avança o onboarding. `state` é null no primeiro contato de um número novo. */
export function advanceOnboarding(
  state: OnboardingState | null,
  rawText: string,
): OnboardingOutcome {
  const text = (rawText ?? '').trim();
  const norm = normalizeText(text);

  // Cancelar/recomeçar a qualquer momento (R1).
  if (state && isRestart(norm)) {
    return continuar('aguardando_nome', {}, RESTART, 'reiniciado');
  }

  // Primeiro contato → boas-vindas e pede o nome (não consome o texto como nome).
  if (!state) {
    return continuar('aguardando_nome', {}, `${WELCOME}\n\n${ASK.nome}`, 'iniciado');
  }

  // Mensagem vazia / só mídia → pede o dado em texto (R1).
  if (text.length === 0) {
    return reAsk(state, PRECISA_TEXTO, 'sem_texto');
  }

  switch (state.etapa) {
    case 'aguardando_nome': {
      const nome = validateNome(text);
      if (!nome) return reAsk(state, 'Não entendi seu nome. ', 'nome_invalido');
      return continuar('aguardando_email', { ...state.dados, nome }, ASK.email, 'validou_nome');
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
          'Para começar, preciso do seu aceite ao uso de IA. Responda *ACEITO* (ou *cancelar* para recomeçar). ',
          'consentimento_pendente',
        );
      }
      const d = state.dados;
      if (!d.nome || !d.email) {
        return continuar('aguardando_nome', {}, RESTART, 'estado_incompleto');
      }
      return { kind: 'criar', dados: { nome: d.nome, email: d.email }, reply: ACTIVATION, evento: 'consentiu' };
    }
  }
}

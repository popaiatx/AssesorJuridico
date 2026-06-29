/**
 * Validadores puros para o onboarding (sem I/O, totalmente testáveis).
 * CPF/CNPJ com dígito verificador; OAB com UF válida; e-mail; nome.
 */

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/** Nome: normaliza espaços; exige ao menos 2 caracteres. Retorna null se inválido. */
export function validateNome(text: string): string | null {
  const nome = text.replace(/\s+/g, ' ').trim();
  return nome.length >= 2 ? nome : null;
}

/** E-mail: validação simples de formato. */
export function validateEmail(text: string): string | null {
  const email = text.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

export interface OabParsed {
  numero: string;
  seccional: string;
}

/**
 * OAB: extrai número (2–7 dígitos) e seccional (UF válida) de texto livre.
 * Aceita "123456/SP", "OAB SP 123456", "123456 sp", etc. Null se faltar algo.
 */
export function parseOab(text: string): OabParsed | null {
  const up = text.toUpperCase();
  const numero = up.match(/\d{2,7}/)?.[0];
  const seccional = (up.match(/[A-Z]{2}/g) ?? []).find((t) => UFS.has(t));
  if (!numero || !seccional) return null;
  return { numero, seccional };
}

function cpfCheckDigit(base: string): number {
  let sum = 0;
  const factorStart = base.length + 1;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * (factorStart - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function isValidCpf(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const d1 = cpfCheckDigit(cpf.slice(0, 9));
  const d2 = cpfCheckDigit(cpf.slice(0, 10));
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

function cnpjCheckDigit(base: string): number {
  const weights =
    base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * weights[i]!;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isValidCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const d1 = cnpjCheckDigit(cnpj.slice(0, 12));
  const d2 = cnpjCheckDigit(cnpj.slice(0, 13));
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/**
 * Documento: aceita CPF (11) ou CNPJ (14) com dígito verificador válido.
 * Retorna só os dígitos, ou null se inválido.
 */
export function validateDocumento(text: string): string | null {
  const digits = onlyDigits(text);
  if (digits.length === 11) return isValidCpf(digits) ? digits : null;
  if (digits.length === 14) return isValidCnpj(digits) ? digits : null;
  return null;
}

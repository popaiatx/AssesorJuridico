import { describe, expect, it } from 'vitest';
import {
  parseOab,
  validateDocumento,
  validateEmail,
  validateNome,
} from '../src/core/domain/validators';

describe('validateDocumento (CPF/CNPJ com dígito verificador)', () => {
  it('aceita CPF válido (com ou sem máscara)', () => {
    expect(validateDocumento('111.444.777-35')).toBe('11144477735');
    expect(validateDocumento('11144477735')).toBe('11144477735');
  });
  it('rejeita CPF com dígito errado', () => {
    expect(validateDocumento('111.444.777-00')).toBeNull();
  });
  it('rejeita sequência repetida', () => {
    expect(validateDocumento('111.111.111-11')).toBeNull();
  });
  it('aceita CNPJ válido', () => {
    expect(validateDocumento('11.222.333/0001-81')).toBe('11222333000181');
  });
  it('rejeita CNPJ inválido e tamanhos errados', () => {
    expect(validateDocumento('11.222.333/0001-00')).toBeNull();
    expect(validateDocumento('123')).toBeNull();
  });
});

describe('parseOab', () => {
  it('extrai número e seccional de vários formatos', () => {
    expect(parseOab('123456/SP')).toEqual({ numero: '123456', seccional: 'SP' });
    expect(parseOab('OAB SP 123456')).toEqual({ numero: '123456', seccional: 'SP' });
    expect(parseOab('123456 sp')).toEqual({ numero: '123456', seccional: 'SP' });
  });
  it('rejeita UF inexistente ou faltando dado', () => {
    expect(parseOab('123456/XX')).toBeNull();
    expect(parseOab('apenas texto')).toBeNull();
    expect(parseOab('SP')).toBeNull();
  });
});

describe('validateEmail / validateNome', () => {
  it('e-mail', () => {
    expect(validateEmail('nome@escritorio.com.br')).toBe('nome@escritorio.com.br');
    expect(validateEmail('nope')).toBeNull();
  });
  it('nome', () => {
    expect(validateNome('  Maria   Silva ')).toBe('Maria Silva');
    expect(validateNome('a')).toBeNull();
  });
});

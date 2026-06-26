import { describe, expect, it } from 'vitest';
import { expectedSignature, verifySignature } from '../src/adapters/whatsapp/signature';

const secret = 'app-secret';
const body = Buffer.from('{"hello":"world"}', 'utf8');

describe('verifySignature', () => {
  it('aceita assinatura válida', () => {
    const sig = expectedSignature(body, secret);
    expect(verifySignature(body, { 'x-hub-signature-256': sig }, secret)).toBe(true);
  });

  it('rejeita assinatura inválida', () => {
    expect(
      verifySignature(body, { 'x-hub-signature-256': 'sha256=deadbeef' }, secret),
    ).toBe(false);
  });

  it('rejeita assinatura ausente', () => {
    expect(verifySignature(body, {}, secret)).toBe(false);
  });

  it('rejeita corpo adulterado', () => {
    const sig = expectedSignature(body, secret);
    const tampered = Buffer.from('{"hello":"evil"}', 'utf8');
    expect(verifySignature(tampered, { 'x-hub-signature-256': sig }, secret)).toBe(false);
  });
});

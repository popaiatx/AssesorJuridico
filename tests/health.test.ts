import { describe, expect, it } from 'vitest';

// Env mínimo válido para o boot (config valida no import). DATABASE_URL não
// conecta de fato aqui — o pool é lazy e /health (liveness) não toca o banco.
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/postgres';

describe('health check', () => {
  it('GET /health responde 200 ok (liveness)', async () => {
    const { buildServer } = await import('../src/infra/http/server');
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

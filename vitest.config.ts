import { defineConfig } from 'vitest/config';

// Env dummy para os testes: a config valida no import (fail-fast). DATABASE_URL
// não conecta — só os caminhos sem banco são exercitados nos testes.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/postgres',
    },
  },
});

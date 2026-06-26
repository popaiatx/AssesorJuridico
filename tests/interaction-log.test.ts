import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseInteractionLog,
  type Logger,
} from '../src/adapters/interaction-log/supabase-interaction-log';

describe('SupabaseInteractionLog — caminho pré-tenant', () => {
  it('sem assinanteId: registra só no logger, não persiste e não lança', async () => {
    const info = vi.fn();
    const logger: Logger = { info };
    const log = new SupabaseInteractionLog(logger);

    await expect(
      log.record({
        assinanteId: null,
        intent: 'onboarding',
        cerebro: null,
        anonimizado: false,
        fontesCitadas: [],
      }),
    ).resolves.toBeUndefined();

    expect(info).toHaveBeenCalledTimes(1);
    const [obj] = info.mock.calls[0]!;
    expect(obj).toMatchObject({ event: 'interacao_pre_tenant', intent: 'onboarding' });
    // Não vaza conteúdo da mensagem (sem dado sensível em claro).
    expect(JSON.stringify(obj)).not.toContain('entrada');
  });
});

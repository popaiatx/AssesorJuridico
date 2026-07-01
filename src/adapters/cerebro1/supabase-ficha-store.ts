/**
 * Implementação real da porta da ficha (Passo 15), ligando à agregação
 * escopada por tenant de `infra/db/ficha-store` (withTenant + RLS).
 */
import type { FichaStore } from '../../core/ports/ficha.js';
import { getFichaBruta } from '../../infra/db/ficha-store.js';

export const supabaseFichaStore: FichaStore = { getFichaBruta };

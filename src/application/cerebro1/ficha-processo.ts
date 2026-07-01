/**
 * Serviço da FICHA DO PROCESSO (Passo 15): agrega os dados de UM processo do
 * próprio assinante em um OBJETO estruturado (`FichaProcesso`).
 *
 * ISOLAMENTO: o `assinanteId` vem SEMPRE da identidade (nunca do texto/LLM). A
 * agregação roda no `FichaStore` em UMA transação withTenant com o tenant
 * embutido em CADA consulta (RLS force de backstop); a posse do processo é
 * re-verificada lá — id de processo de outro dono devolve null e nenhum filho
 * é consultado.
 *
 * A formatação fica FORA (`ficha-format`): este objeto serve o WhatsApp hoje e
 * o dashboard (Fase C) amanhã. A ficha NÃO passa pelo LLM — a montagem e a
 * formatação são determinísticas (nenhum dado do cliente sai para o modelo).
 */
import { montarFicha } from '../../core/domain/cerebro1/ficha.js';
import type { FichaProcesso, FichaStore } from '../../core/ports/ficha.js';

export interface FichaProcessoDeps {
  store: FichaStore;
  clock: () => Date;
}

export class FichaProcessoService {
  constructor(private readonly deps: FichaProcessoDeps) {}

  /** Monta a ficha estruturada. null = processo inexistente ou de outro dono. */
  async montarPorId(assinanteId: string, processoId: string): Promise<FichaProcesso | null> {
    const bruta = await this.deps.store.getFichaBruta(assinanteId, processoId);
    if (!bruta) return null;
    return montarFicha(bruta, this.deps.clock());
  }
}

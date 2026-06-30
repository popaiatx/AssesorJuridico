import { describe, expect, it } from 'vitest';
import { ACTIONS_BY_NAME, isAffirmative, isNegative } from '../src/core/domain/cerebro1-actions';

const criar = ACTIONS_BY_NAME.criar_compromisso!;
const cadastrar = ACTIONS_BY_NAME.cadastrar_processo!;
const consultar = ACTIONS_BY_NAME.consultar_processo!;

describe('validação de ações', () => {
  it('criar_compromisso completo → ok, normaliza data e CNJ', () => {
    const r = criar.validate({
      tipo: 'audiencia',
      data_hora: '2026-07-02T14:00:00-03:00',
      descricao: 'Instrução',
      numero_cnj: '0001234-56.2024.8.26.0100',
    });
    expect(r.faltando).toEqual([]);
    expect(r.erro).toBeNull();
    expect(r.value.tipo).toBe('audiencia');
    expect(r.value.numeroCnj).toBe('00012345620248260100'); // 20 dígitos
    expect(typeof r.value.dataHora).toBe('string');
  });

  it('criar_compromisso sem data → faltando data_hora (pergunta só o que falta)', () => {
    const r = criar.validate({ tipo: 'audiencia', descricao: 'X' });
    expect(r.faltando).toContain('data_hora');
    expect(r.erro).toBeNull();
  });

  it('criar_compromisso com data inválida → erro (pede correção)', () => {
    const r = criar.validate({ tipo: 'reuniao', data_hora: 'amanhã sei lá', descricao: 'X' });
    expect(r.erro).toMatch(/data/i);
  });

  it('CNJ malformado → erro', () => {
    const r = cadastrar.validate({ numero_cnj: '123' });
    expect(r.erro).toMatch(/CNJ|20 dígitos/i);
  });

  it('cadastrar_processo vazio → erro pedindo ao menos um dado', () => {
    const r = cadastrar.validate({});
    expect(r.erro).toBeTruthy();
  });

  it('confirmText do cadastro é legível', () => {
    const r = cadastrar.validate({ cliente_nome: 'Maria', parte_contraria: 'Empresa X' });
    expect(cadastrar.confirmText!(r.value)).toContain('cliente Maria');
  });

  it('consultar_processo sem critério → erro', () => {
    expect(consultar.validate({}).erro).toBeTruthy();
  });
});

describe('validação das ações de edição/remoção (Passo 11)', () => {
  const editarC = ACTIONS_BY_NAME.editar_compromisso!;
  const cancelarC = ACTIONS_BY_NAME.cancelar_compromisso!;
  const editarP = ACTIONS_BY_NAME.editar_processo!;
  const arquivarP = ACTIONS_BY_NAME.arquivar_processo!;

  it('editar_compromisso: seletor + mudança → ok (normaliza data e dia)', () => {
    const r = editarC.validate({ alvo_tipo: 'audiencia', alvo_dia: '2026-07-15', nova_data_hora: '2026-07-18T16:00:00-03:00' });
    expect(r.erro).toBeNull();
    expect(r.value.alvoTipo).toBe('audiencia');
    expect(r.value.alvoDia).toBe('2026-07-15');
    expect(typeof r.value.novaDataHora).toBe('string');
  });

  it('editar_compromisso sem seletor → erro (qual compromisso)', () => {
    const r = editarC.validate({ nova_descricao: 'nova' });
    expect(r.erro).toMatch(/qual compromisso/i);
  });

  it('editar_compromisso com seletor mas sem mudança → erro (o que mudar)', () => {
    const r = editarC.validate({ alvo_tipo: 'reuniao' });
    expect(r.erro).toMatch(/mudar/i);
  });

  it('editar_compromisso nova data inválida → erro', () => {
    const r = editarC.validate({ alvo_tipo: 'reuniao', nova_data_hora: 'sei lá' });
    expect(r.erro).toMatch(/data/i);
  });

  it('cancelar_compromisso: precisa de seletor; com seletor → ok', () => {
    expect(cancelarC.validate({}).erro).toMatch(/qual compromisso/i);
    const r = cancelarC.validate({ alvo_processo: '0001234-56.2024.8.26.0100', alvo_tipo: 'audiencia' });
    expect(r.erro).toBeNull();
    expect(r.value.alvoProcesso).toBe('00012345620248260100');
    expect(r.value.alvoTipo).toBe('audiencia');
  });

  it('editar_processo: seletor + mudança → ok; sem mudança → erro', () => {
    const ok = editarP.validate({ alvo_cnj: '0001234-56.2024.8.26.0100', novo_status: 'arquivado' });
    expect(ok.erro).toBeNull();
    expect(ok.value.novoStatus).toBe('arquivado');
    expect(editarP.validate({ alvo_cliente: 'Maria' }).erro).toMatch(/mudar/i);
  });

  it('arquivar_processo: precisa de seletor', () => {
    expect(arquivarP.validate({}).erro).toMatch(/qual processo/i);
    expect(arquivarP.validate({ alvo_cnj: '0001234-56.2024.8.26.0100' }).erro).toBeNull();
  });
});

describe('afirmativo/negativo', () => {
  it('reconhece confirmação e cancelamento', () => {
    expect(isAffirmative('sim')).toBe(true);
    expect(isAffirmative('confirmar')).toBe(true);
    expect(isNegative('cancelar')).toBe(true);
    expect(isAffirmative('talvez')).toBe(false);
  });
});

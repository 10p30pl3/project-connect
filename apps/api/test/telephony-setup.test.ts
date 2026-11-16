import { describe, expect, it } from 'vitest';
import { computeSetupSteps, type SetupSnapshot } from '../src/lib/telephony-setup.js';

const emptySnapshot: SetupSnapshot = {
  gatewayReachable: true,
  trunks: [],
  agents: [],
  channels: [],
  inboundRoutes: [],
  outboundRoutes: [],
  extensions: [],
  recentCalls: [],
};

describe('computeSetupSteps (009-telephony-setup-order)', () => {
  it('retorna todas as etapas pendentes na ordem canônica para workspace vazio e bloqueia edição de tronco para admin comum', () => {
    const res = computeSetupSteps(emptySnapshot, { mode: 'advanced', isSuper: false });
    expect(res.steps.map((s) => s.id)).toEqual(['trunk', 'agent', 'channel', 'routes', 'extension', 'test']);
    expect(res.nextStepId).toBe('trunk');
    expect(res.pendingCount).toBe(5); // extension é opcional
    const trunk = res.steps.find((s) => s.id === 'trunk')!;
    expect(trunk.readOnly).toBe(true);
    expect(trunk.href).toBeNull();
  });

  it('filtra apenas Agente, Canal e Teste no Modo Básico (FR-007)', () => {
    const res = computeSetupSteps(emptySnapshot, { mode: 'basic', isSuper: true });
    expect(res.steps.map((s) => s.id)).toEqual(['agent', 'channel', 'test']);
    expect(res.nextStepId).toBe('agent');
    expect(res.pendingCount).toBe(3);
  });

  it('dispensa tronco para fluxo exclusivamente WebRTC (FR-008) e sinaliza canal sem cobertura (FR-005)', () => {
    const snap: SetupSnapshot = {
      ...emptySnapshot,
      agents: [{ id: 'a1', name: 'Atendimento', engineValid: true }],
      channels: [{ id: 'c1', name: 'Widget Web', channelType: 'WEBRTC', active: true, tenantId: null }],
    };
    const res = computeSetupSteps(snap, { mode: 'advanced', isSuper: true });
    expect(res.steps.find((s) => s.id === 'trunk')?.status).toBe('complete');
    expect(res.steps.find((s) => s.id === 'channel')?.status).toBe('problem');
    expect(res.warnings.some((w) => w.code === 'channel_without_coverage')).toBe(true);
    expect(res.nextStepId).toBe('channel');
  });

  it('sinaliza rota de saída sem tronco ativo e rota de entrada com agente inexistente', () => {
    const snap: SetupSnapshot = {
      ...emptySnapshot,
      agents: [{ id: 'a1', name: 'Agente 1', engineValid: true }],
      channels: [{ id: 'c1', name: 'SIP', channelType: 'VOICE', active: true, tenantId: 'a1' }],
      inboundRoutes: [{ id: 'r1', name: 'Rota Perdida', enabled: true, tenantId: 'inexistente' }],
      outboundRoutes: [{ id: 'o1', name: 'Saída SP', enabled: true, trunkId: 'tr-off' }],
    };
    const res = computeSetupSteps(snap, { mode: 'advanced', isSuper: true });
    expect(res.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['outbound_route_without_trunk', 'inbound_route_agent_missing']),
    );
    expect(res.steps.find((s) => s.id === 'routes')?.status).toBe('problem');
  });

  it('degrada com partial=true quando o gateway está indisponível', () => {
    const snap: SetupSnapshot = { ...emptySnapshot, gatewayReachable: false };
    const res = computeSetupSteps(snap, { mode: 'advanced', isSuper: true });
    expect(res.partial).toBe(true);
    expect(res.steps.find((s) => s.id === 'trunk')?.status).toBe('problem');
    expect(res.steps.find((s) => s.id === 'trunk')?.reason).toBe('Gateway de voz indisponível');
  });
});

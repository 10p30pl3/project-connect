import { describe, expect, it } from 'vitest';
import {
  CampaignDialerConfigSchema,
  isDialerManagerRole,
} from '@voll/shared';
import {
  computeCampaignQuota,
  normalizeGatewayTrunk,
  type WorkspaceTrunkSnapshot,
} from '../src/engine/trunk-capacity.js';

function makeSnapshot(overrides: Partial<WorkspaceTrunkSnapshot> = {}): WorkspaceTrunkSnapshot {
  return {
    gatewayConfigured: true,
    gatewayOnline: true,
    trunks: [
      {
        id: 't-1',
        name: 'Tronco 1',
        direction: 'outbound',
        active: true,
        online: true,
        maxChannels: 5,
        activeCalls: 2,
        availableChannels: 3,
      },
      {
        id: 't-2',
        name: 'Tronco 2',
        direction: 'both',
        active: true,
        online: true,
        maxChannels: 2,
        activeCalls: 0,
        availableChannels: 2,
      },
      {
        id: 't-in',
        name: 'Somente Entrada',
        direction: 'inbound',
        active: true,
        online: true,
        maxChannels: 10,
        activeCalls: 0,
        availableChannels: 10,
      },
      {
        id: 't-paused',
        name: 'Pausado',
        direction: 'outbound',
        active: false,
        online: false,
        maxChannels: 8,
        activeCalls: 0,
        availableChannels: 0,
      },
    ],
    reservedInTickByTrunk: new Map(),
    reservedInTickAuto: 0,
    ...overrides,
  };
}

describe('trunk-capacity (unit)', () => {
  it('calcula cota proporcional a canais livres outbound/both e ignora inbound/pausados', () => {
    const snap = makeSnapshot();
    // t-1 (3 livres) + t-2 (2 livres) = 5 vagas livres; t-in e t-paused ignorados
    const q1 = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: [], dialMultiplier: 1 });
    expect(q1.totalTrunkChannels).toBe(7);
    expect(q1.availableTrunkSlots).toBe(5);
    expect(q1.effectiveQuota).toBe(5);
    expect(q1.waitingReason).toBe('NONE');

    // Multiplicador 2x dobra a cota, 0.5x arredonda para baixo
    const q2 = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: [], dialMultiplier: 2 });
    expect(q2.effectiveQuota).toBe(10);

    const qHalf = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: [], dialMultiplier: 0.5 });
    expect(qHalf.effectiveQuota).toBe(2);
  });

  it('filtra por selectedTrunkIds, detecta ALL_TRUNKS_BUSY e NO_ELIGIBLE_TRUNKS', () => {
    const snap = makeSnapshot();

    const filtered = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: ['t-1'], dialMultiplier: 2 });
    expect(filtered.availableTrunkSlots).toBe(3);
    expect(filtered.effectiveQuota).toBe(6);

    snap.trunks[0].availableChannels = 0;
    const busy = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: ['t-1'], dialMultiplier: 1 });
    expect(busy.availableTrunkSlots).toBe(0);
    expect(busy.effectiveQuota).toBe(0);
    expect(busy.waitingReason).toBe('ALL_TRUNKS_BUSY');

    const missing = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: ['inexistente'], dialMultiplier: 1 });
    expect(missing.availableTrunkSlots).toBe(0);
    expect(missing.waitingReason).toBe('NO_ELIGIBLE_TRUNKS');

    const offline = computeCampaignQuota({ snapshot: makeSnapshot({ gatewayOnline: false }), selectedTrunkIds: [], dialMultiplier: 1 });
    expect(offline.waitingReason).toBe('NO_ELIGIBLE_TRUNKS');
  });

  it('desconta reservas do tick entre campanhas compartilhando troncos do workspace', () => {
    const snap = makeSnapshot();
    // Simula campanha 1 consumindo 3 vagas explícitas em t-1 e campanha 2 usando 1 vaga automática
    snap.reservedInTickByTrunk.set('t-1', 3);
    snap.reservedInTickAuto = 1;

    // Sobram apenas 2 vagas de t-2 menos 1 vaga automática = 1 vaga restante para a próxima campanha
    const remaining = computeCampaignQuota({ snapshot: snap, selectedTrunkIds: [], dialMultiplier: 1 });
    expect(remaining.availableTrunkSlots).toBe(1);
    expect(remaining.effectiveQuota).toBe(1);
  });

  it('aplica governança estrita de papéis e limites do CampaignDialerConfigSchema', () => {
    expect(isDialerManagerRole('MANAGER')).toBe(true);
    expect(isDialerManagerRole('ADMIN')).toBe(true);
    expect(isDialerManagerRole('SUPER_ADMIN')).toBe(true);
    expect(isDialerManagerRole('OPERATOR')).toBe(false);
    expect(isDialerManagerRole('SUPERVISOR')).toBe(false);
    expect(isDialerManagerRole('ANALYST')).toBe(false);
    expect(isDialerManagerRole(null)).toBe(false);

    expect(CampaignDialerConfigSchema.parse({})).toEqual({ trunkIds: [], dialMultiplier: 1 });
    expect(CampaignDialerConfigSchema.safeParse({ trunkIds: ['t-1'], dialMultiplier: 0.4 }).success).toBe(false);
    expect(CampaignDialerConfigSchema.safeParse({ trunkIds: ['t-1'], dialMultiplier: 5.5 }).success).toBe(false);
    expect(CampaignDialerConfigSchema.safeParse({ trunkIds: ['t-1'], dialMultiplier: 2.5 }).success).toBe(true);
  });

  it('normalizeGatewayTrunk considera tronco IP-auth em NOREG sem ping como online no fallback', () => {
    const ipAuth = normalizeGatewayTrunk({
      id: 'directcall',
      name: 'DirectCall',
      register: false,
      active: true,
      maxChannels: 30,
      live: { state: 'NOREG', status: 'DOWN' },
    });
    expect(ipAuth.online).toBe(true);
    expect(ipAuth.availableChannels).toBe(30);

    const notLoaded = normalizeGatewayTrunk({
      id: 'directcall',
      name: 'DirectCall',
      register: false,
      active: true,
      maxChannels: 30,
      live: { state: 'NOT_LOADED', status: 'DOWN' },
    });
    expect(notLoaded.online).toBe(false);
    expect(notLoaded.availableChannels).toBe(0);
  });
});

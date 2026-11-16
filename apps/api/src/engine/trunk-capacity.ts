import type { CampaignDialerWaitingReason, JourneyStep, TrunkAvailability } from '@voll/shared';
import { getPool, one, q, type Db } from '../db/pool.js';
import { gatewayFor, syncAndFetchOwnership } from '../modules/telephony.js';

export type WorkspaceTrunkSnapshot = {
  gatewayConfigured: boolean;
  gatewayOnline: boolean;
  /** Troncos de saída visíveis ao workspace, já com vagas livres descontadas de reservas pré-gateway */
  trunks: TrunkAvailability[];
  /** Vagas já alocadas neste tick para evitar overshooting entre múltiplas campanhas */
  reservedInTickByTrunk: Map<string, number>;
  reservedInTickAuto: number;
};

type Fetcher = typeof fetch;
let customGatewayFetcher: Fetcher | null = null;

/** Permite injetar mock de fetch nos testes de integração sem depender de HTTP real */
export function setTrunkCapacityFetcher(fn: Fetcher | null) {
  customGatewayFetcher = fn;
}

export function normalizeGatewayTrunk(raw: any): TrunkAvailability {
  const directionRaw = String(raw?.direction || 'both').toLowerCase();
  const direction: TrunkAvailability['direction'] =
    directionRaw === 'inbound' ? 'inbound' : directionRaw === 'outbound' ? 'outbound' : 'both';
  const active = raw?.active !== false;
  const maxChannels = Number.isFinite(Number(raw?.maxChannels)) && Number(raw?.maxChannels) >= 1
    ? Math.floor(Number(raw.maxChannels))
    : 1;
  const activeCalls = Math.max(0, Math.floor(Number(raw?.activeCalls ?? raw?.usedChannels ?? 0) || 0));
  const liveState = String(raw?.live?.state ?? raw?.state ?? '').toUpperCase();
  const liveStatus = String(raw?.live?.status ?? raw?.status ?? '').toUpperCase();
  const isIpAuthNoPingNoreg = raw?.register === false && !(Number(raw?.pingFreq) > 0) && liveState === 'NOREG';
  const online =
    typeof raw?.online === 'boolean'
      ? raw.online
      : active &&
        liveState !== 'PAUSED' &&
        liveState !== 'NOT_LOADED' &&
        liveState !== 'UNKNOWN' &&
        (liveStatus !== 'DOWN' || isIpAuthNoPingNoreg);
  const availableChannels =
    typeof raw?.availableChannels === 'number'
      ? Math.max(0, Math.floor(raw.availableChannels))
      : active && online && direction !== 'inbound'
        ? Math.max(0, maxChannels - activeCalls)
        : 0;

  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || raw?.id || ''),
    direction,
    active,
    online,
    maxChannels,
    activeCalls,
    availableChannels,
    statusMessage: raw?.statusMessage ?? raw?.live?.message ?? raw?.state ?? raw?.status ?? null,
  };
}

/** Verifica se a jornada possui alguma etapa utilizando conector `VOICE_APP` (ou não-simulado de voz). */
export async function campaignUsesVoiceGateway(db: Db, workspaceId: string, steps: JourneyStep[]): Promise<boolean> {
  const voiceConnIds = steps.filter((s) => s.channelType === 'VOICE').map((s) => s.connectionId);
  if (!voiceConnIds.length) return false;
  const rows = await q<{ provider: string }>(
    db,
    `SELECT provider FROM connections WHERE workspace_id = $1 AND id = ANY($2)`,
    [workspaceId, voiceConnIds],
  );
  if (rows.some((r) => r.provider === 'VOICE_APP')) return true;
  const ep = await one<{ config: any }>(
    db,
    `SELECT config FROM workspace_channel_endpoints WHERE workspace_id = $1`,
    [workspaceId],
  ).catch(() => null);
  const envUrl = String(process.env.VOICE_APP_BASE_URL || '').trim();
  const epUrl = String(ep?.config?.voice?.voiceAppBaseUrl || '').trim();
  // Se houver gateway explicitamente configurado E a conexão de voz não for puramente SIMULATED, usa controle de troncos
  return Boolean((epUrl || envUrl) && !rows.every((r) => r.provider === 'SIMULATED'));
}

/** Busca disponibilidade real de troncos visíveis para o workspace no gateway de voz + reservas locais pendentes. */
export async function loadWorkspaceTrunkSnapshot(db: Db, workspaceId: string): Promise<WorkspaceTrunkSnapshot> {
  let gw: { baseUrl: string; token: string } | null = null;
  try {
    gw = await gatewayFor(workspaceId);
  } catch {
    return {
      gatewayConfigured: false,
      gatewayOnline: false,
      trunks: [],
      reservedInTickByTrunk: new Map(),
      reservedInTickAuto: 0,
    };
  }

  const doFetch = customGatewayFetcher ?? fetch;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(gw.token ? { Authorization: `Bearer ${gw.token}` } : {}),
  };

  let rawTrunks: any[] | null = null;
  let gatewayOnline = true;
  try {
    let resp = await doFetch(`${gw.baseUrl}/v1/trunks/availability`, { headers, signal: AbortSignal.timeout(4000) });
    if (resp.status === 404) {
      resp = await doFetch(`${gw.baseUrl}/v1/trunks`, { headers, signal: AbortSignal.timeout(4000) });
    }
    if (!resp.ok) {
      gatewayOnline = false;
    } else {
      const json: any = await resp.json();
      rawTrunks = Array.isArray(json?.trunks) ? json.trunks : [];
    }
  } catch {
    gatewayOnline = false;
  }

  if (!gatewayOnline || !rawTrunks) {
    return {
      gatewayConfigured: true,
      gatewayOnline: false,
      trunks: [],
      reservedInTickByTrunk: new Map(),
      reservedInTickAuto: 0,
    };
  }

  const ownership = await syncAndFetchOwnership('trunk', rawTrunks);
  const visibleRaw = rawTrunks.filter((t) => {
    const id = String(t?.id ?? '');
    if (!id) return false;
    const own = ownership.get(id);
    return own?.is_global_default || own?.workspace_id === workspaceId;
  });

  // Desconta apenas tentativas recém-reservadas (`RESERVED`) nos últimos 30s que ainda não chegaram ao gateway
  // (`SENT` já adquiriu slot sincronamente via POST /v1/calls e consta em `activeCalls` do gateway).
  const preGatewayRows = await q<{ trunk_id: string | null; n: number }>(
    db,
    `SELECT trunk_id, count(*)::int AS n
       FROM attempts
      WHERE workspace_id = $1
        AND channel_type = 'VOICE'
        AND state = 'RESERVED'
        AND updated_at >= now() - interval '30 seconds'
      GROUP BY trunk_id`,
    [workspaceId],
  ).catch(() => []);

  const preByTrunk = new Map<string, number>();
  let preUnassigned = 0;
  for (const r of preGatewayRows) {
    if (r.trunk_id) preByTrunk.set(r.trunk_id, (preByTrunk.get(r.trunk_id) ?? 0) + Number(r.n || 0));
    else preUnassigned += Number(r.n || 0);
  }

  const trunks = visibleRaw.map((raw) => {
    const t = normalizeGatewayTrunk(raw);
    const localPre = preByTrunk.get(t.id) ?? 0;
    const deducted = Math.max(0, t.availableChannels - localPre);
    return { ...t, availableChannels: deducted };
  });

  // Distribui eventuais reservas pré-gateway sem trunk_id definido do pool geral de vagas disponíveis
  let remainingUnassigned = preUnassigned;
  if (remainingUnassigned > 0) {
    for (const t of trunks) {
      if (remainingUnassigned <= 0) break;
      if (t.availableChannels <= 0) continue;
      const take = Math.min(t.availableChannels, remainingUnassigned);
      t.availableChannels -= take;
      remainingUnassigned -= take;
    }
  }

  return {
    gatewayConfigured: true,
    gatewayOnline: true,
    trunks,
    reservedInTickByTrunk: new Map(),
    reservedInTickAuto: 0,
  };
}

export type WorkspaceTrunkBudgetPool = {
  getOrLoad(workspaceId: string): Promise<WorkspaceTrunkSnapshot>;
  consume(workspaceId: string, selectedTrunkIds: string[], count: number): void;
};

/** Pool compartilhado por tick para garantir que múltiplas campanhas no mesmo workspace não excedam troncos livres. */
export function createWorkspaceTrunkBudgetPool(db: Db = getPool()): WorkspaceTrunkBudgetPool {
  const byWorkspace = new Map<string, WorkspaceTrunkSnapshot>();
  return {
    async getOrLoad(workspaceId: string) {
      let snap = byWorkspace.get(workspaceId);
      if (!snap) {
        snap = await loadWorkspaceTrunkSnapshot(db, workspaceId);
        byWorkspace.set(workspaceId, snap);
      }
      return snap;
    },
    consume(workspaceId: string, selectedTrunkIds: string[], count: number) {
      if (count <= 0) return;
      const snap = byWorkspace.get(workspaceId);
      if (!snap) return;
      if (selectedTrunkIds.length > 0) {
        let left = count;
        for (const id of selectedTrunkIds) {
          if (left <= 0) break;
          const t = snap.trunks.find((tr) => tr.id === id);
          if (!t) continue;
          const used = snap.reservedInTickByTrunk.get(id) ?? 0;
          const free = Math.max(0, t.availableChannels - used);
          if (free <= 0) continue;
          const take = Math.min(free, left);
          snap.reservedInTickByTrunk.set(id, used + take);
          left -= take;
        }
        if (left > 0) {
          snap.reservedInTickAuto += left;
        }
      } else {
        snap.reservedInTickAuto += count;
      }
    },
  };
}

export type QuotaComputation = {
  eligibleTrunks: TrunkAvailability[];
  totalTrunkChannels: number;
  availableTrunkSlots: number;
  effectiveQuota: number;
  waitingReason: CampaignDialerWaitingReason;
};

/** Calcula vagas livres nos troncos elegíveis e a cota efetiva após aplicar `dialMultiplier`. */
export function computeCampaignQuota(params: {
  snapshot: WorkspaceTrunkSnapshot;
  selectedTrunkIds: string[];
  dialMultiplier: number;
}): QuotaComputation {
  const { snapshot, selectedTrunkIds, dialMultiplier } = params;
  const allow = selectedTrunkIds.length > 0 ? new Set(selectedTrunkIds) : null;
  const eligibleTrunks = snapshot.trunks.filter(
    (t) => t.direction !== 'inbound' && (!allow || allow.has(t.id)),
  );

  const onlineActive = eligibleTrunks.filter((t) => t.active && t.online);
  const totalTrunkChannels = onlineActive.reduce((s, t) => s + t.maxChannels, 0);

  let rawFree = 0;
  for (const t of onlineActive) {
    const usedInTick = snapshot.reservedInTickByTrunk.get(t.id) ?? 0;
    rawFree += Math.max(0, t.availableChannels - usedInTick);
  }
  const availableTrunkSlots = Math.max(0, rawFree - snapshot.reservedInTickAuto);
  const mult = Number.isFinite(dialMultiplier) && dialMultiplier >= 0.5 ? dialMultiplier : 1;
  const effectiveQuota = availableTrunkSlots > 0 ? Math.floor(availableTrunkSlots * mult) : 0;

  let waitingReason: CampaignDialerWaitingReason = 'NONE';
  if (!snapshot.gatewayOnline || onlineActive.length === 0) {
    waitingReason = 'NO_ELIGIBLE_TRUNKS';
  } else if (availableTrunkSlots <= 0 || effectiveQuota <= 0) {
    waitingReason = 'ALL_TRUNKS_BUSY';
  }

  return {
    eligibleTrunks: eligibleTrunks.map((t) => ({
      ...t,
      availableChannels: Math.max(0, t.availableChannels - (snapshot.reservedInTickByTrunk.get(t.id) ?? 0)),
    })),
    totalTrunkChannels,
    availableTrunkSlots,
    effectiveQuota,
    waitingReason,
  };
}

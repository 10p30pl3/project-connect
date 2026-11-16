import type {
  TelephonySetupStatus,
  TelephonySetupStep,
  TelephonySetupWarning,
} from '@voll/shared';
import { getPool, q } from '../db/pool.js';

export type SetupSnapshot = {
  trunks: { id: string; name?: string; active: boolean; online: boolean; hasFreeChannels: boolean }[];
  agents: { id: string; name?: string; engineValid: boolean; active?: boolean }[];
  channels: { id: string; name: string; channelType: string; active: boolean; tenantId: string | null }[];
  inboundRoutes: {
    id: string;
    name?: string;
    enabled: boolean;
    tenantId: string;
    connectionId?: string | null;
    channelType?: string | null;
  }[];
  outboundRoutes: { id: string; name?: string; enabled: boolean; trunkId?: string | null }[];
  extensions: { id: string }[];
  recentCalls: { status?: string; durationSec?: number }[];
  gatewayReachable: boolean;
};

export function computeSetupSteps(
  snapshot: SetupSnapshot,
  opts: { mode: 'basic' | 'advanced'; isSuper: boolean },
): TelephonySetupStatus {
  const { mode, isSuper } = opts;
  const warnings: TelephonySetupWarning[] = [];

  const activeAgents = new Map(snapshot.agents.map((a) => [a.id, a]));
  const activeTrunks = new Set(snapshot.trunks.filter((t) => t.active && t.online).map((t) => t.id));
  const anyActiveTrunk = snapshot.trunks.some((t) => t.active);

  const voiceChannels = snapshot.channels.filter(
    (c) => c.channelType === 'VOICE' || c.channelType === 'WEBRTC',
  );
  const onlyWebRtc =
    voiceChannels.length > 0 && voiceChannels.every((c) => c.channelType === 'WEBRTC');

  const enabledInbound = snapshot.inboundRoutes.filter((r) => r.enabled);
  const enabledOutbound = snapshot.outboundRoutes.filter((r) => r.enabled);

  // Detect incoherences (FR-005)
  for (const r of enabledOutbound) {
    const hasValidTrunk = r.trunkId ? activeTrunks.has(r.trunkId) : anyActiveTrunk;
    if (!hasValidTrunk && snapshot.gatewayReachable) {
      warnings.push({
        code: 'outbound_route_without_trunk',
        resourceId: r.id,
        resourceName: r.name || r.id,
        message: `Rota de saída "${r.name || r.id}" sem tronco SIP ativo.`,
      });
    }
  }

  for (const r of enabledInbound) {
    const ag = activeAgents.get(r.tenantId);
    if (!ag && snapshot.gatewayReachable) {
      warnings.push({
        code: 'inbound_route_agent_missing',
        resourceId: r.id,
        resourceName: r.name || r.id,
        message: `Rota de entrada "${r.name || r.id}" aponta para agente inexistente (${r.tenantId}).`,
      });
    } else if (ag && ag.active === false) {
      warnings.push({
        code: 'inbound_route_agent_inactive',
        resourceId: r.id,
        resourceName: r.name || r.id,
        message: `Rota de entrada "${r.name || r.id}" aponta para agente inativo (${ag.name || ag.id}).`,
      });
    }
  }

  for (const ch of voiceChannels.filter((c) => c.active)) {
    const hasDefaultAgent = Boolean(ch.tenantId && activeAgents.has(ch.tenantId));
    const hasCoveringRoute = enabledInbound.some(
      (r) =>
        (!r.connectionId || r.connectionId === '*' || r.connectionId === ch.id) &&
        (!r.channelType || r.channelType === '*' || r.channelType === ch.channelType),
    );
    if (!hasDefaultAgent && !hasCoveringRoute && snapshot.gatewayReachable) {
      warnings.push({
        code: 'channel_without_coverage',
        resourceId: ch.id,
        resourceName: ch.name,
        message: `Canal "${ch.name}" sem agente padrão e sem rota de entrada ativa.`,
      });
    }
  }

  const steps: TelephonySetupStep[] = [];

  // 1. Tronco SIP (somente modo Avançado; dispensado para fluxo exclusivamente WebRTC)
  if (mode === 'advanced') {
    let trunkStatus: TelephonySetupStep['status'] = 'pending';
    let trunkReason: string | null = null;
    if (!snapshot.gatewayReachable) {
      trunkStatus = 'problem';
      trunkReason = 'Gateway de voz indisponível';
    } else if (onlyWebRtc && snapshot.trunks.length === 0) {
      trunkStatus = 'complete';
      trunkReason = 'Dispensado para canais exclusivamente WebRTC.';
    } else if (snapshot.trunks.length === 0) {
      trunkStatus = 'pending';
      trunkReason = isSuper
        ? 'Nenhum tronco SIP cadastrado.'
        : 'Nenhum tronco ativo. Peça ao administrador da plataforma.';
    } else if (!snapshot.trunks.some((t) => t.active && t.online && t.hasFreeChannels)) {
      trunkStatus = 'problem';
      trunkReason = 'Tronco offline, inativo ou sem canais livres.';
    } else {
      trunkStatus = 'complete';
    }
    steps.push({
      id: 'trunk',
      order: 1,
      label: 'Tronco SIP',
      status: trunkStatus,
      optional: false,
      readOnly: !isSuper,
      reason: trunkReason,
      href: isSuper ? '/telefonia?tab=trunks' : null,
      count: snapshot.trunks.filter((t) => t.active).length,
    });
  }

  // 2. Agente de Voz
  let agentStatus: TelephonySetupStep['status'] = 'pending';
  let agentReason: string | null = null;
  if (!snapshot.gatewayReachable && snapshot.agents.length === 0) {
    agentStatus = 'problem';
    agentReason = 'Gateway de voz indisponível';
  } else if (snapshot.agents.length === 0) {
    agentStatus = 'pending';
    agentReason = 'Nenhum agente de voz criado.';
  } else if (snapshot.agents.some((a) => !a.engineValid)) {
    agentStatus = 'problem';
    agentReason = 'Há agente sem motor de IA ou modelo válido configurado.';
  } else {
    agentStatus = 'complete';
  }
  steps.push({
    id: 'agent',
    order: 2,
    label: 'Agente de Voz',
    status: agentStatus,
    optional: false,
    readOnly: false,
    reason: agentReason,
    href: '/agentes-de-voz',
    count: snapshot.agents.length,
  });

  // 3. Canal (Voz / WebRTC)
  const channelWarnings = warnings.filter((w) => w.code === 'channel_without_coverage');
  let channelStatus: TelephonySetupStep['status'] = 'pending';
  let channelReason: string | null = null;
  if (voiceChannels.filter((c) => c.active).length === 0) {
    channelStatus = 'pending';
    channelReason = 'Nenhum canal de voz ou WebRTC ativo.';
  } else if (channelWarnings.length > 0) {
    channelStatus = 'problem';
    channelReason = 'Canal ativo sem agente padrão e sem rota de entrada (chamadas não serão atendidas).';
  } else {
    channelStatus = 'complete';
  }
  steps.push({
    id: 'channel',
    order: 3,
    label: 'Canal (Voz / WebRTC)',
    status: channelStatus,
    optional: false,
    readOnly: false,
    reason: channelReason,
    href: '/canais',
    count: voiceChannels.filter((c) => c.active).length,
  });

  // 4. Rotas (somente modo Avançado)
  if (mode === 'advanced') {
    const routeWarnings = warnings.filter(
      (w) =>
        w.code === 'outbound_route_without_trunk' ||
        w.code === 'inbound_route_agent_missing' ||
        w.code === 'inbound_route_agent_inactive',
    );
    let routeStatus: TelephonySetupStep['status'] = 'pending';
    let routeReason: string | null = null;
    if (!snapshot.gatewayReachable && enabledInbound.length + enabledOutbound.length === 0) {
      routeStatus = 'problem';
      routeReason = 'Gateway de voz indisponível';
    } else if (routeWarnings.length > 0) {
      routeStatus = 'problem';
      routeReason = routeWarnings[0].message;
    } else if (enabledInbound.length === 0 && enabledOutbound.length === 0) {
      routeStatus = 'pending';
      routeReason = 'Nenhuma rota de entrada ou saída ativa configurada.';
    } else {
      routeStatus = 'complete';
    }
    steps.push({
      id: 'routes',
      order: 4,
      label: 'Rotas (Entrada / Saída)',
      status: routeStatus,
      optional: false,
      readOnly: false,
      reason: routeReason,
      href: '/telefonia?tab=routes',
      count: enabledInbound.length + enabledOutbound.length,
    });

    // 5. Ramal Interno (opcional)
    steps.push({
      id: 'extension',
      order: 5,
      label: 'Ramal Interno (Opcional)',
      status: snapshot.extensions.length > 0 ? 'complete' : 'pending',
      optional: true,
      readOnly: false,
      reason: snapshot.extensions.length === 0 ? 'Opcional para softphones e testes internos.' : null,
      href: '/telefonia?tab=extensions',
      count: snapshot.extensions.length,
    });
  }

  // 6. Teste de chamada
  let testStatus: TelephonySetupStep['status'] = 'pending';
  let testReason: string | null = null;
  if (!snapshot.gatewayReachable && snapshot.recentCalls.length === 0) {
    testStatus = 'problem';
    testReason = 'Gateway de voz indisponível';
  } else if (snapshot.recentCalls.some((c) => (c.durationSec ?? 0) > 0 || c.status === 'completed')) {
    testStatus = 'complete';
  } else if (snapshot.recentCalls.length > 0) {
    testStatus = 'problem';
    testReason = 'Últimas tentativas falharam sem completar áudio.';
  } else {
    testStatus = 'pending';
    testReason = 'Nenhuma chamada de teste concluída ainda.';
  }
  steps.push({
    id: 'test',
    order: 6,
    label: 'Teste de Chamada',
    status: testStatus,
    optional: false,
    readOnly: false,
    reason: testReason,
    href: '/?dial=1',
    count: snapshot.recentCalls.filter((c) => (c.durationSec ?? 0) > 0 || c.status === 'completed').length,
  });

  const requiredActionable = steps.filter((s) => !s.optional && s.status !== 'complete');
  return {
    mode,
    steps,
    nextStepId: requiredActionable[0]?.id ?? null,
    pendingCount: requiredActionable.length,
    warnings,
    partial: !snapshot.gatewayReachable,
  };
}

export async function loadSetupSnapshot(
  workspaceId: string,
  proxyFetch: (path: string) => Promise<any>,
): Promise<SetupSnapshot> {
  const pool = getPool();
  const [connRows, [trunksRes, tenantsRes, routesRes, outboundRes, extRes, callsRes]] = await Promise.all([
    q<{ id: string; name: string; channel_type: string; active: boolean; config: any }>(
      pool,
      `SELECT id, name, channel_type, active, config FROM connections WHERE workspace_id=$1`,
      [workspaceId],
    ),
    Promise.all([
      proxyFetch('/v1/trunks').catch(() => null),
      proxyFetch('/v1/tenants').catch(() => null),
      proxyFetch('/v1/routes').catch(() => null),
      proxyFetch('/v1/outbound-routes').catch(() => null),
      proxyFetch('/v1/extensions').catch(() => null),
      proxyFetch('/v1/calls/history?limit=20').catch(() => null),
    ]),
  ]);

  const gatewayReachable = Boolean(trunksRes || tenantsRes || routesRes);

  const trunksRaw: any[] = Array.isArray(trunksRes?.trunks) ? trunksRes.trunks : [];
  const tenantsRaw: any[] = Array.isArray(tenantsRes?.tenants) ? tenantsRes.tenants : [];
  const routesRaw: any[] = Array.isArray(routesRes?.routes) ? routesRes.routes : [];
  const outboundRaw: any[] = Array.isArray(outboundRes?.routes) ? outboundRes.routes : [];
  const extRaw: any[] = Array.isArray(extRes?.extensions) ? extRes.extensions : [];
  const callsRaw: any[] = Array.isArray(callsRes?.history) ? callsRes.history : [];

  return {
    gatewayReachable,
    trunks: trunksRaw.map((t) => ({
      id: String(t.id),
      name: t.name,
      active: t.active !== false && t.enabled !== false,
      online: t.online !== false && String(t.status || '').toUpperCase() !== 'DOWN',
      hasFreeChannels: (Number(t.maxChannels ?? 1) - Number(t.activeChannels ?? 0)) > 0,
    })),
    agents: tenantsRaw.map((a) => ({
      id: String(a.id),
      name: a.name,
      active: a.active !== false,
      engineValid: ['openai', 'openai_live', 'elevenlabs'].includes(String(a.stsEngine || 'openai')),
    })),
    channels: connRows.map((c) => ({
      id: c.id,
      name: c.name,
      channelType: c.channel_type,
      active: Boolean(c.active),
      tenantId: c.config?.tenantId ?? null,
    })),
    inboundRoutes: routesRaw.map((r) => ({
      id: String(r.id),
      name: r.name,
      enabled: r.enabled !== false && r.active !== false,
      tenantId: String(r.tenantId || ''),
      connectionId: r.connectionId ?? null,
      channelType: r.channelType ?? null,
    })),
    outboundRoutes: outboundRaw.map((r) => ({
      id: String(r.id),
      name: r.name,
      enabled: r.enabled !== false,
      trunkId: r.trunkId ?? null,
    })),
    extensions: extRaw.map((e) => ({ id: String(e.id || e.extension) })),
    recentCalls: callsRaw.map((c) => ({
      status: c.status,
      durationSec: Number(c.durationSec ?? 0),
    })),
  };
}

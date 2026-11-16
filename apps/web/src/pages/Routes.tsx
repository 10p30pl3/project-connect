import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Cable, RefreshCw, Route, Sliders } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../lib/api';
import type { Connection } from '../lib/types';
import { Button, PageHeader, Stat, Tabs } from '../components/ui';
import { InboundRoutesPanel, OutboundRoutesPanel } from './telephony/SettingsTabs';
import type { InboundRoute, OutboundRoute, TenantConfig } from './telephony/types';

export function RoutesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const tab = searchParams.get('tab') === 'outbound' ? 'outbound' : 'inbound';
  const connectionId = searchParams.get('connectionId') || undefined;

  const setTab = (next: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', next);
    setSearchParams(p, { replace: true });
  };

  const inboundQ = useQuery({
    queryKey: ['telephony', 'routes'],
    queryFn: () => get<{ routes: InboundRoute[] }>('/telephony/routes'),
    retry: false,
  });
  const outboundQ = useQuery({
    queryKey: ['telephony', 'outbound-routes'],
    queryFn: () => get<{ routes: OutboundRoute[] }>('/telephony/outbound-routes'),
    retry: false,
  });
  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ tenants: TenantConfig[] }>('/telephony/tenants'),
    retry: false,
  });
  const connsQ = useQuery({
    queryKey: ['connections'],
    queryFn: () => get<{ items: Connection[] }>('/connections'),
    retry: false,
  });

  const inboundActive = (inboundQ.data?.routes ?? []).filter((r) => r.active !== false).length;
  const outboundActive = (outboundQ.data?.routes ?? []).filter((r) => r.active !== false).length;
  const voiceConns = (connsQ.data?.items ?? []).filter(
    (c) => c.channelType === 'VOICE' || c.channelType === 'WEBRTC',
  ).length;
  const activeAgents = (tenantsQ.data?.tenants ?? []).filter((t) => t.active !== false).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rotas"
        tooltip="Orquestração de chamadas: Rotas de Entrada direcionam SIP, WebRTC e WhatsApp Calling para Agentes de Voz (antes do fallback do Canal); Rotas de Saída selecionam troncos PSTN por prefixo e failover."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/canais"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <Cable className="size-3.5" aria-hidden />
              <span>Canais</span>
            </Link>
            <Link
              to="/agentes-de-voz"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <Bot className="size-3.5" aria-hidden />
              <span>Agentes de Voz</span>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={`size-3.5 ${inboundQ.isFetching || outboundQ.isFetching ? 'animate-spin' : ''}`} aria-hidden />}
              onClick={() => qc.invalidateQueries({ queryKey: ['telephony'] })}
            >
              Atualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rotas de Entrada Ativas" value={inboundActive} />
        <Stat label="Rotas de Saída Ativas" value={outboundActive} />
        <Stat label="Canais de Voz / WebRTC" value={voiceConns} />
        <Stat label="Agentes Ativos" value={activeAgents} tone={activeAgents > 0 ? 'good' : undefined} />
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          {
            value: 'inbound',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Route className="size-3.5" aria-hidden />
                Rotas de Entrada
              </span>
            ),
            content: <InboundRoutesPanel initialConnectionId={connectionId} />,
          },
          {
            value: 'outbound',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Sliders className="size-3.5" aria-hidden />
                Rotas de Saída
              </span>
            ),
            content: <OutboundRoutesPanel />,
          },
        ]}
      />
    </div>
  );
}

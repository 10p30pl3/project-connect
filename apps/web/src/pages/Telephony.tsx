/**
 * Área Telefonia (Voll Connect integrado):
 * Gravações estéreo, Ramais SIP (1000-1010, 9000, *99) e Configurações
 * de Troncos, Rotas Entrada/Saída, Provedores IA/Custos e Motores DSP (14 features).
 * (Ligações & Histórico ficam na Visão Geral; Agentes de Voz em /agentes-de-voz.)
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Disc,
  PhoneCall,
  RefreshCw,
  Settings,
  Smartphone,
} from 'lucide-react';
import { isSuperAdminRole } from '@voll/shared';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useExperienceMode } from '../lib/experience-mode';
import { Badge, Button, PageHeader, Stat, Tabs } from '../components/ui';
import { ExtensionsTab } from './telephony/ExtensionsTab';
import { RecordingsTab } from './telephony/RecordingsTab';
import { SettingsTabs } from './telephony/SettingsTabs';
import {
  fmtUptime,
  type AiProvider,
  type GatewayStatus,
  type RecordingItem,
  type SipExtension,
  type VoiceFeature,
} from './telephony/types';

export function TelephonyPage() {
  const { me } = useAuth();
  const { mode, isAtLeast } = useExperienceMode();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const rawParamTab = searchParams.get('tab');
  const normalizedInitial =
    rawParamTab === 'trunks'
      ? 'settings'
      : rawParamTab && rawParamTab !== 'calls' && rawParamTab !== 'tenants'
        ? rawParamTab
        : 'recordings';
  const [tab, setTabState] = useState(normalizedInitial);

  useEffect(() => {
    const paramTab = searchParams.get('tab');
    if (paramTab === 'calls') {
      navigate('/', { replace: true });
      return;
    }
    if (paramTab === 'tenants') {
      navigate('/agentes-de-voz', { replace: true });
      return;
    }
    if (paramTab === 'trunks') {
      setTabState('settings');
      return;
    }
    if (paramTab && paramTab !== tab) setTabState(paramTab);
  }, [searchParams, navigate, tab]);

  const setTab = (next: string) => {
    setTabState(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  const statusQ = useQuery({
    queryKey: ['telephony', 'status'],
    queryFn: () => get<GatewayStatus>('/telephony/status'),
    refetchInterval: 15000,
    retry: false,
  });

  const recsQ = useQuery({
    queryKey: ['telephony', 'recordings'],
    queryFn: () => get<{ count: number; recordings: RecordingItem[] }>('/telephony/recordings'),
    retry: false,
  });

  const extQ = useQuery({
    queryKey: ['telephony', 'extensions'],
    queryFn: () => get<{ count?: number; extensions: SipExtension[] }>('/telephony/extensions'),
    enabled: isAtLeast('advanced'),
    retry: false,
  });

  const aiProvQ = useQuery({
    queryKey: ['telephony', 'ai-providers'],
    queryFn: () =>
      get<{
        viewMode?: string;
        providers: AiProvider[];
        monthCostTotalUsd?: number;
        monthCostTotalBrl?: number;
        monthDurationSec?: number;
        monthCallsCount?: number;
      }>('/telephony/ai-providers'),
    retry: false,
  });

  const canSeeCosts = isSuperAdminRole(me?.role);
  const monthDurationSec = aiProvQ.data?.monthDurationSec ?? 0;
  const monthDurLabel = `${Math.floor(monthDurationSec / 60)}m ${String(monthDurationSec % 60).padStart(2, '0')}s`;

  const featuresQ = useQuery({
    queryKey: ['telephony', 'features'],
    queryFn: () => get<{ count: number; activeCount: number; features: VoiceFeature[] }>('/telephony/features'),
    retry: false,
  });

  const s = statusQ.data ?? {};
  const fs = s.freeSwitchCluster ?? s.freeswitch ?? {};
  const whisper = s.whisperCluster;

  return (
    <div className="space-y-5">
      <PageHeader
        title={mode === 'basic' ? 'Telefonia & Gravações' : 'Telefonia · Voll Connect'}
        tooltip="Infraestrutura de voz: gravações estéreo, ramais SIP, troncos, rotas, provedores IA e motores DSP."
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className={`size-4 ${statusQ.isFetching ? 'animate-spin' : ''}`} aria-hidden />}
            onClick={() => qc.invalidateQueries({ queryKey: ['telephony'] })}
          >
            Atualizar
          </Button>
        }
      />

      {/* Barra de Telemetria do Cluster Local */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={s.status === 'ok' ? 'green' : statusQ.isError ? 'red' : 'amber'}>
          {s.status === 'ok'
            ? `${mode === 'basic' ? 'Sistema de Voz Online' : 'Gateway Online'}${s.uptimeSec ? ` (${fmtUptime(s.uptimeSec)})` : ''}`
            : statusQ.isError
              ? 'Gateway Desconectado'
              : `Sistema: ${s.status ?? 'verificando...'}`}
        </Badge>
        {isAtLeast('advanced') && (
          <Badge tone={s.drachtioConnected ? 'green' : 'red'}>
            SIP Drachtio {s.drachtioConnected ? 'Conectado' : 'Desconectado'}
          </Badge>
        )}
        {isAtLeast('advanced') && fs.totalNodes != null && (
          <Badge tone={fs.healthyNodes ? 'green' : 'red'}>
            FreeSWITCH {fs.healthyNodes ?? 0}/{fs.totalNodes} nós
          </Badge>
        )}
        {isAtLeast('advanced') && whisper?.totalNodes != null && (
          <Badge tone={whisper.healthyNodes ? 'green' : 'amber'}>
            Whisper AMD {whisper.healthyNodes ?? 0}/{whisper.totalNodes} nós
          </Badge>
        )}
        {isAtLeast('advanced') && featuresQ.data && (
          <Badge tone="brand">
            DSP &amp; Controle {featuresQ.data.activeCount}/{featuresQ.data.count} ativas
          </Badge>
        )}
      </div>

      {/* KPIs focados em Gravações, Infraestrutura SIP e Consumo */}
      <div className={`grid gap-3 sm:grid-cols-2 ${isAtLeast('advanced') ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <Stat label="Gravações Estéreo" value={recsQ.data?.count ?? recsQ.data?.recordings?.length ?? 0} />
        {isAtLeast('advanced') && (
          <Stat
            label="Ramais SIP"
            value={extQ.data?.extensions?.length ?? extQ.data?.count ?? 0}
            hint="1000–1010 / 9000"
          />
        )}
        {canSeeCosts ? (
          <Stat
            label="Custo IA Mês"
            value={`US$ ${(aiProvQ.data?.monthCostTotalUsd ?? 0).toFixed(2)}`}
            hint={aiProvQ.data?.monthCostTotalBrl != null ? `≈ R$ ${aiProvQ.data.monthCostTotalBrl.toFixed(2)}` : undefined}
          />
        ) : (
          <Stat
            label="Tempo IA no Mês"
            value={monthDurLabel}
            hint={`${aiProvQ.data?.monthCallsCount ?? 0} chamadas contabilizadas`}
          />
        )}
      </div>

      {/* Navegação Telefonia */}
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          {
            value: 'recordings',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Disc className="size-3.5" aria-hidden />
                {mode === 'basic' ? 'Gravações' : 'Gravações Estéreo'}
              </span>
            ),
            content: <RecordingsTab />,
          },
          ...(isAtLeast('advanced') || tab === 'extensions'
            ? [
                {
                  value: 'extensions',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Smartphone className="size-3.5" aria-hidden />
                      Ramais SIP (1000–1010)
                    </span>
                  ),
                  content: <ExtensionsTab onDialExtension={() => navigate('/?dial=1')} />,
                },
              ]
            : []),
          ...(isAtLeast('advanced') || tab === 'settings'
            ? [
                {
                  value: 'settings',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Settings className="size-3.5" aria-hidden />
                      Configurações
                    </span>
                  ),
                  content: <SettingsTabs />,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
export { PhoneCall };

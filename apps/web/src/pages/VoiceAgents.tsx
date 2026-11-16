import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneCall, RefreshCw } from 'lucide-react';
import { get } from '../lib/api';
import { useExperienceMode } from '../lib/experience-mode';
import { Badge, Button, PageHeader, Stat } from '../components/ui';
import { SetupIndicator } from '../components/TelephonySetupGuide';
import { TenantsTab } from './telephony/TenantsTab';
import type { GatewayStatus, TenantConfig } from './telephony/types';

export function VoiceAgentsPage() {
  const { mode } = useExperienceMode();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const statusQ = useQuery({
    queryKey: ['telephony', 'status'],
    queryFn: () => get<GatewayStatus>('/telephony/status'),
    refetchInterval: 15000,
    retry: false,
  });

  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ count: number; tenants: TenantConfig[] }>('/telephony/tenants'),
    retry: false,
  });

  const s = statusQ.data ?? {};
  const tenants = tenantsQ.data?.tenants ?? [];
  const activeCount = tenants.filter((t) => t.active !== false).length;
  const openAiCount = tenants.filter((t) => t.stsEngine !== 'elevenlabs').length;
  const elevenCount = tenants.filter((t) => t.stsEngine === 'elevenlabs').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={mode === 'basic' ? 'Agentes de Voz' : 'Agentes de Voz (IA)'}
        tooltip="Crie e configure agentes conversacionais com motor OpenAI Realtime ou ElevenLabs, voz, saudação, ramal de atendimento e filtros acústicos."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SetupIndicator />
            <Badge tone={s.status === 'ok' ? 'green' : statusQ.isError ? 'red' : 'amber'}>
              {s.status === 'ok'
                ? 'Sistema de Voz Online'
                : statusQ.isError
                  ? 'Gateway Desconectado'
                  : `Sistema: ${s.status ?? 'verificando...'}`}
            </Badge>
            <Button
              type="button"
              variant="secondary"
              icon={<PhoneCall className="size-4" aria-hidden />}
              onClick={() => navigate('/?dial=1')}
            >
              Nova ligação de teste
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw className={`size-4 ${tenantsQ.isFetching ? 'animate-spin' : ''}`} aria-hidden />}
              onClick={() => qc.invalidateQueries({ queryKey: ['telephony'] })}
            >
              Atualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Agentes Configurados" value={tenants.length} />
        <Stat label="Agentes Ativos" value={activeCount} tone={activeCount > 0 ? 'good' : undefined} />
        <Stat label="OpenAI Realtime" value={openAiCount} />
        <Stat label="ElevenLabs STS" value={elevenCount} />
      </div>

      <TenantsTab
        onTestTenant={(tid) => navigate(`/?dial=1&tenant=${encodeURIComponent(tid)}`)}
      />
    </div>
  );
}

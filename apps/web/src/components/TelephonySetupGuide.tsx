import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api';
import { useExperienceMode } from '../lib/experience-mode';
import type { TelephonySetupStatus } from '../lib/types';
import { Badge, Card, InfoTooltip } from './ui';

export function useTelephonySetupStatus() {
  const { mode } = useExperienceMode();
  return useQuery({
    queryKey: ['telephony', 'setup-status', mode],
    queryFn: () => get<TelephonySetupStatus>(`/telephony/setup-status?mode=${mode}`),
    retry: false,
    staleTime: 15_000,
  });
}

export function SetupIndicator() {
  const q = useTelephonySetupStatus();
  const pendingCount = q.data?.pendingCount ?? 0;
  if (pendingCount <= 0) return null;

  return (
    <Link
      to="/telefonia"
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition"
      title="Etapas pendentes na ordem recomendada de configuração de telefonia"
    >
      <Sparkles className="size-3.5 text-amber-600" aria-hidden />
      <span>{pendingCount} {pendingCount === 1 ? 'etapa pendente' : 'etapas pendentes'}</span>
    </Link>
  );
}

export function TelephonySetupGuide() {
  const q = useTelephonySetupStatus();
  const data = q.data;
  if (!data || !data.steps.length) return null;

  const allComplete = data.pendingCount === 0 && !data.partial;

  return (
    <Card
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>Ordem de Configuração de Telefonia</span>
          {allComplete ? (
            <Badge tone="green">Cadeia Pronta</Badge>
          ) : (
            <Badge tone="amber">{data.pendingCount} {data.pendingCount === 1 ? 'pendência' : 'pendências'}</Badge>
          )}
          {data.partial && <Badge tone="red">Gateway Indisponível</Badge>}
        </div>
      }
      tooltip="Siga a sequência recomendada (Tronco → Agente → Canal → Rotas → Ramal → Teste) para evitar chamadas sem atendimento."
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.steps.map((step) => {
          const isNext = data.nextStepId === step.id;
          const borderClass =
            step.status === 'problem'
              ? 'border-red-200 bg-red-50/50'
              : isNext
                ? 'border-brand-300 bg-brand-50/50 ring-1 ring-brand-200'
                : step.status === 'complete'
                  ? 'border-emerald-200/80 bg-emerald-50/30'
                  : 'border-slate-200 bg-white';

          return (
            <div
              key={step.id}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${borderClass}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {step.status === 'complete' ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
                ) : step.status === 'problem' ? (
                  <AlertTriangle className="size-4 shrink-0 text-red-600" aria-hidden />
                ) : (
                  <Circle className={`size-4 shrink-0 ${isNext ? 'text-brand-600' : 'text-slate-300'}`} aria-hidden />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1 font-semibold text-slate-900 truncate">
                    <span>{step.order}. {step.label}</span>
                    {step.reason && <InfoTooltip content={step.reason} />}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {isNext ? 'Próximo passo' : step.status === 'complete' ? `${step.count} ativo(s)` : step.optional ? 'Opcional' : 'Pendente'}
                  </div>
                </div>
              </div>

              {!step.readOnly && step.href && (
                <Link
                  to={step.href}
                  className="inline-flex items-center gap-1 shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <span>Abrir</span>
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

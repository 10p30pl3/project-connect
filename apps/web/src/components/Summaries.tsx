import { ArrowRight } from 'lucide-react';
import { CHANNEL_LABEL, TABULATION_ACTION_LABEL, type StrategyConfig } from '@voll/shared';
import type { JourneyStepView, Tabulation } from '../lib/types';
import { WEEKDAYS } from '../lib/format';
import { Badge, KeyValue } from './ui';

export function JourneySteps({ steps }: { steps: JourneyStepView[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Sequência de canais">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          {i > 0 && <ArrowRight className="size-4 text-slate-400" aria-hidden />}
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs">
            <strong>
              {i + 1}. {CHANNEL_LABEL[s.channelType]}
            </strong>
            {s.connectionName && <span className="text-slate-500"> · {s.connectionName}</span>}
            <span className="block text-slate-500">Feedback em até {fmtMinutes(s.feedbackTimeoutMinutes)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function fmtMinutes(m: number) {
  if (m < 60) return `${m} min`;
  if (m % 1440 === 0) return `${m / 1440} dia${m / 1440 > 1 ? 's' : ''}`;
  if (m % 60 === 0) return `${m / 60} h`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function daysLabel(days: number[]) {
  const s = [...days].sort();
  if (s.join() === '1,2,3,4,5') return 'Segunda a sexta';
  if (s.join() === '1,2,3,4,5,6') return 'Segunda a sábado';
  if (s.length === 7) return 'Todos os dias';
  return s.map((d) => WEEKDAYS[d]).join(', ');
}

export function StrategySummary({ config, version, tabulations, compact }: { config: StrategyConfig; version?: number; tabulations?: Tabulation[]; compact?: boolean }) {
  const tabName = (code: string) => tabulations?.find((t) => t.code === code)?.name ?? code;
  return (
    <div className="space-y-3 text-sm">
      <KeyValue
        items={[
          ...(version !== undefined ? ([['Versão', `v${version}`]] as [string, string][]) : []),
          ['Limite total por cliente', `${config.limits.total} tentativas`],
          ['Limite diário por cliente', `${config.limits.daily} tentativas`],
          ['Escopo dos limites', config.limits.scope === 'WORKSPACE' ? 'Cliente no workspace (compartilhado entre campanhas)' : 'Cliente nesta campanha'],
          ['Dias', daysLabel(config.calendar.days)],
          ['Janela de horário', `${config.calendar.start} às ${config.calendar.end}`],
          ['Fuso', config.calendar.timezone],
          ['Retentativa', `a cada ${fmtMinutes(config.retry.intervalMinutes)}, até ${config.retry.maxPerDestination} por destino`],
          ...(!compact
            ? ([
                ['Histórico incompleto', config.limits.incompleteHistory === 'BLOCK' ? 'Aguardar revisão (bloquear)' : 'Usar somente o histórico conhecido'],
                ['Distribuição', `lote ${config.distribution.batchSize}, máx. ${config.distribution.maxPending} pendentes, reserva válida por ${config.distribution.leaseSeconds}s`],
              ] as [string, string][])
            : []),
        ]}
      />
      {!compact && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Regras por tabulação</div>
          <ul className="flex flex-wrap gap-1.5">
            {Object.entries(config.tabulationRules).map(([code, action]) => (
              <li key={code}>
                <Badge tone="gray">
                  {tabName(code)} → {TABULATION_ACTION_LABEL[action]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

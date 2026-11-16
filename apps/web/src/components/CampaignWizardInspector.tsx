import type { ReactNode } from 'react';
import clsx from 'clsx';
import {
  Bot,
  Cable,
  CalendarDays,
  Clock,
  Database,
  Filter,
  Layers,
  PhoneCall,
  Rocket,
  SlidersHorizontal,
} from 'lucide-react';
import { CONNECTION_CHANNEL_LABEL } from '@voll/shared';
import type {
  Connection,
  Journey,
  MailingSummary,
  OperationCalendar,
  Strategy,
  TrunkAvailabilityResponse,
} from '../lib/types';
import type { TenantConfig } from '../pages/telephony/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { Badge, Card, KeyValue } from './ui';
import { JourneySteps } from './Summaries';

const DAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export type InspectorTabOption<T extends string> = {
  id: T;
  label: string;
};

/**
 * Grade responsiva em duas colunas para o assistente de criação de campanha (Opção B adaptada):
 * coluna principal empilhada à esquerda e coluna lateral fixa à direita detalhando a opção escolhida.
 */
export function WizardTwoColumnLayout({
  left,
  right,
  footer,
}: {
  left: ReactNode;
  right: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">{left}</div>
        <aside className="lg:sticky lg:top-6 lg:col-span-5">{right}</aside>
      </div>
      {footer}
    </div>
  );
}

/** Painel base da coluna direita com abas rápidas para alternar o item inspecionado. */
export function InspectorShell<T extends string>({
  title,
  tooltip,
  tabs,
  activeTab,
  onSelectTab,
  children,
}: {
  title: string;
  tooltip: string;
  tabs?: InspectorTabOption<T>[];
  activeTab?: T;
  onSelectTab?: (tab: T) => void;
  children: ReactNode;
}) {
  return (
    <Card title={title} tooltip={tooltip} className="border-brand-200/80 bg-white">
      {tabs && tabs.length > 0 && onSelectTab && (
        <div className="mb-4 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
          {tabs.map((t) => {
            const active = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTab(t.id)}
                className={clsx(
                  'cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-brand-600 bg-brand-50 font-semibold text-brand-900'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      {children}
    </Card>
  );
}

export function MailingRightInspector({
  isBasic,
  selectedMailing,
  source,
  mailingNameFallback,
}: {
  isBasic: boolean;
  selectedMailing?: MailingSummary;
  source: 'IMPORT' | 'MAILING';
  mailingNameFallback?: string;
}) {
  return (
    <InspectorShell
      title="Detalhamento do Mailing"
      tooltip="Exibe informações da base selecionada e o comportamento de público aplicado ao avançar."
    >
      {selectedMailing ? (
        <div className="space-y-4 text-xs">
          <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-center gap-2.5">
              <Database className="size-4 shrink-0 text-brand-700" />
              <div>
                <div className="text-sm font-semibold text-slate-900">{selectedMailing.name}</div>
                <div className="text-slate-500">Atualizado em {fmtDateTime(selectedMailing.createdAt)}</div>
              </div>
            </div>
            <Badge tone="green">Pronto</Badge>
          </div>
          <KeyValue
            items={[
              ['Contatos válidos', `${fmtNumber(selectedMailing.recordCount)} registros`],
              ['Última importação', selectedMailing.lastVersion ? `v${selectedMailing.lastVersion.version} · ${fmtNumber(selectedMailing.lastVersion.validRows)} válidos` : '—'],
              ['Regra ao avançar', isBasic ? 'Base completa automática (100%)' : 'Seguirá para Público (filtro)'],
            ]}
          />
        </div>
      ) : (
        <div className="space-y-3 text-xs text-slate-600">
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4">
            <div className="font-semibold text-slate-800">
              {source === 'IMPORT' ? 'Importação de novo mailing' : 'Seleção de mailing existente'}
            </div>
            <div className="mt-1 text-slate-500">
              {mailingNameFallback
                ? `Mailing atual: ${mailingNameFallback}`
                : isBasic
                  ? 'Ao selecionar ou importar um mailing, todos os contatos elegíveis entrarão automaticamente no acionamento.'
                  : 'Selecione ou importe um mailing para habilitar a segmentação na próxima etapa.'}
            </div>
          </div>
        </div>
      )}
    </InspectorShell>
  );
}

export function AudienceRightInspector({
  mailing,
  mailingNameFallback,
  hasCustomFilters,
  filterCount,
  sortCount,
  selectedCount,
  listName,
}: {
  mailing?: MailingSummary;
  mailingNameFallback?: string;
  hasCustomFilters: boolean;
  filterCount: number;
  sortCount: number;
  selectedCount: number | null;
  listName?: string;
}) {
  const totalBase = mailing?.recordCount ?? 0;
  const targetCount = selectedCount ?? totalBase;

  return (
    <InspectorShell
      title="Detalhamento do Público"
      tooltip="Resumo em tempo real da segmentação aplicada sobre o mailing antes de seguir para o acionamento."
    >
      <div className="space-y-4 text-xs">
        <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center gap-2">
            <Filter className="size-4 shrink-0 text-brand-700" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {listName || mailing?.name || mailingNameFallback || 'Base selecionada'}
              </div>
              <div className="text-slate-500">
                {hasCustomFilters ? 'Segmentação personalizada' : 'Base completa sem filtros'}
              </div>
            </div>
          </div>
          <Badge tone={hasCustomFilters ? 'brand' : 'green'}>
            {hasCustomFilters ? 'Filtrado' : '100%'}
          </Badge>
        </div>
        <KeyValue
          items={[
            ['Contatos estimados', `${fmtNumber(targetCount)} de ${fmtNumber(totalBase)}`],
            ['Filtros aplicados', String(filterCount)],
            ['Critérios de ordenação', String(sortCount)],
          ]}
        />
      </div>
    </InspectorShell>
  );
}

export type ActivationFocus = 'AGENT' | 'CHANNEL' | 'JOURNEY' | 'STRATEGY' | 'CALENDAR';

function formatAgentModel(agent?: TenantConfig | null): string {
  if (!agent) return '—';
  if (agent.stsEngine === 'elevenlabs') {
    return ['ElevenLabs STS', agent.elevenlabsModel, agent.elevenlabsVoiceId].filter(Boolean).join(' · ');
  }
  return ['OpenAI Realtime', agent.openaiModel, agent.voice].filter(Boolean).join(' · ');
}

export function ActivationRightInspector({
  isBasic,
  focus,
  onChangeFocus,
  selectedAgent,
  boundChannelAgentName,
  selectedConnection,
  selectedJourney,
  selectedStrategy,
  selectedCalendar,
  isVoiceRequired,
}: {
  isBasic: boolean;
  focus: ActivationFocus;
  onChangeFocus: (f: ActivationFocus) => void;
  selectedAgent?: TenantConfig | null;
  boundChannelAgentName?: string | null;
  selectedConnection?: Connection;
  selectedJourney?: Journey;
  selectedStrategy?: Strategy;
  selectedCalendar?: OperationCalendar;
  isVoiceRequired: boolean;
}) {
  const tabs: InspectorTabOption<ActivationFocus>[] = isBasic
    ? [
        { id: 'AGENT', label: 'Agente' },
        { id: 'CHANNEL', label: 'Canal simples' },
        { id: 'CALENDAR', label: 'Calendário' },
      ]
    : [
        { id: 'AGENT', label: 'Agente' },
        { id: 'JOURNEY', label: 'Jornada' },
        { id: 'STRATEGY', label: 'Estratégia' },
        { id: 'CALENDAR', label: 'Calendário' },
      ];

  const resolvedFocus = tabs.some((t) => t.id === focus) ? focus : tabs[0].id;
  const stratCfg = selectedStrategy?.latestVersion?.config;

  return (
    <InspectorShell
      title="Detalhamento da seleção"
      tooltip="Exibe em tempo real os atributos da opção selecionada ou em foco na coluna à esquerda."
      tabs={tabs}
      activeTab={resolvedFocus}
      onSelectTab={onChangeFocus}
    >
      {resolvedFocus === 'AGENT' && (
        <div className="space-y-4 text-xs">
          {!isVoiceRequired && selectedConnection && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
              Canal digital selecionado ({CONNECTION_CHANNEL_LABEL[selectedConnection.channelType]}): agente de voz é opcional para este canal.
            </div>
          )}
          {selectedAgent ? (
            <>
              <div className="flex items-start justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="flex items-center gap-2.5">
                  <Bot className="size-4 shrink-0 text-emerald-700" />
                  <div>
                    <div className="text-sm font-semibold text-emerald-950">{selectedAgent.name || selectedAgent.id}</div>
                    <div className="font-mono text-[11px] text-emerald-800">{formatAgentModel(selectedAgent)}</div>
                  </div>
                </div>
                <Badge tone="green">{selectedAgent.active === false ? 'Inativo' : 'Ativo'}</Badge>
              </div>
              <KeyValue
                items={[
                  ['Identificador', selectedAgent.id],
                  ['Duração máxima', selectedAgent.maxDurationSec ? `${selectedAgent.maxDurationSec}s` : 'Padrão do gateway'],
                  ['AMD / STT', `${selectedAgent.amd?.enabled ? 'AMD ativo' : 'AMD inativo'} · ${selectedAgent.stt?.enabled !== false ? 'Transcrição ativa' : 'Transcrição inativa'}`],
                  [
                    'Origem do agente',
                    boundChannelAgentName && selectedConnection?.tenantId === selectedAgent.id
                      ? `Herdado do Canal (${boundChannelAgentName})`
                      : selectedConnection?.tenantId
                        ? `Sobrescrito na Campanha (padrão do canal: ${boundChannelAgentName ?? selectedConnection.tenantId})`
                        : 'Selecionado na Campanha',
                  ],
                ]}
              />
              {selectedAgent.instructions && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prévia das instruções</div>
                  <div className="mt-1 line-clamp-4 whitespace-pre-line text-slate-700">{selectedAgent.instructions}</div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-slate-600">
              <div className="font-semibold text-slate-800">
                {boundChannelAgentName ? `Usando padrão do canal (${boundChannelAgentName})` : 'Nenhum agente específico selecionado'}
              </div>
              <div className="mt-1 text-slate-500">
                Selecione um agente na coluna à esquerda para aplicá-lo exclusivamente às ligações desta campanha.
              </div>
            </div>
          )}
        </div>
      )}

      {resolvedFocus === 'CHANNEL' && (
        <div className="space-y-4 text-xs">
          {selectedConnection ? (
            <>
              <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-2.5">
                  <Cable className="size-4 shrink-0 text-brand-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{selectedConnection.name}</div>
                    <div className="text-slate-500">
                      {CONNECTION_CHANNEL_LABEL[selectedConnection.channelType]} · {selectedConnection.provider}
                    </div>
                  </div>
                </div>
                <Badge tone={selectedConnection.active ? 'green' : 'amber'}>
                  {selectedConnection.active ? 'Ativo' : 'Pausado'}
                </Badge>
              </div>
              <KeyValue
                items={[
                  ['Canal', CONNECTION_CHANNEL_LABEL[selectedConnection.channelType]],
                  ['Provedor', selectedConnection.provider],
                  ['Agente padrão vinculado', boundChannelAgentName ?? (selectedConnection.tenantId || 'Nenhum')],
                  ['Jornada associada', 'Etapa única (automática ao continuar)'],
                  ['Estratégia operacional', selectedStrategy?.name ?? 'Padrão compatível do workspace'],
                ]}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-slate-600">
              Nenhum canal selecionado. Escolha um dos canais configurados em Configuração → Canais.
            </div>
          )}
        </div>
      )}

      {resolvedFocus === 'JOURNEY' && (
        <div className="space-y-4 text-xs">
          {selectedJourney?.latestVersion ? (
            <>
              <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-2.5">
                  <Layers className="size-4 shrink-0 text-brand-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{selectedJourney.name}</div>
                    <div className="text-slate-500">Versão v{selectedJourney.latestVersion.version}</div>
                  </div>
                </div>
                <Badge tone={selectedJourney.latestVersion.steps.length > 1 ? 'brand' : 'gray'}>
                  {selectedJourney.latestVersion.steps.length} etapa(s)
                </Badge>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <JourneySteps steps={selectedJourney.latestVersion.steps} />
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-slate-500">
              Selecione uma jornada à esquerda para visualizar a sequência de canais.
            </div>
          )}
        </div>
      )}

      {resolvedFocus === 'STRATEGY' && (
        <div className="space-y-4 text-xs">
          {selectedStrategy && stratCfg ? (
            <>
              <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-2.5">
                  <SlidersHorizontal className="size-4 shrink-0 text-brand-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{selectedStrategy.name}</div>
                    <div className="text-slate-500">
                      Versão v{selectedStrategy.latestVersion?.version ?? 1}
                    </div>
                  </div>
                </div>
                <Badge tone="brand">{stratCfg.limits.scope}</Badge>
              </div>
              <KeyValue
                items={[
                  ['Limites', `Até ${stratCfg.limits.total} totais · ${stratCfg.limits.daily}/dia`],
                  ['Retentativa', `${stratCfg.retry.intervalMinutes} min · máx ${stratCfg.retry.maxPerDestination}/destino`],
                  ['Lote / Teto', `Lote ${stratCfg.distribution.batchSize} · teto ${stratCfg.distribution.maxPending}`],
                  ['Tabulações', `${Object.keys(stratCfg.tabulationRules).length} regras configuradas`],
                ]}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-slate-500">
              Selecione uma estratégia à esquerda para inspecionar limites e retentativas.
            </div>
          )}
        </div>
      )}

      {resolvedFocus === 'CALENDAR' && (
        <div className="space-y-4 text-xs">
          {selectedCalendar ? (
            <>
              <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-2.5">
                  <CalendarDays className="size-4 shrink-0 text-brand-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{selectedCalendar.name}</div>
                    <div className="text-slate-500">{selectedCalendar.timezone}</div>
                  </div>
                </div>
                <Badge tone={selectedCalendar.holidayPolicy === 'BLOCK' ? 'amber' : 'green'}>
                  {selectedCalendar.holidayPolicy === 'BLOCK' ? 'Bloqueia feriados' : 'Permite feriados'}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {selectedCalendar.windows.map((w, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock className="size-3.5 text-slate-400" />
                      {w.days.map((d) => DAYS_SHORT[d]).join(', ')}
                    </span>
                    <span className="font-mono font-semibold text-slate-900">
                      {w.start}–{w.end}
                    </span>
                  </div>
                ))}
              </div>
              <KeyValue
                items={[
                  ['Feriados cadastrados', `${selectedCalendar.holidays?.length ?? 0} data(s)`],
                  ['Status', selectedCalendar.active ? 'Ativo' : 'Inativo'],
                ]}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-slate-500">
              Nenhum calendário selecionado; serão usadas as janelas padrão da estratégia.
            </div>
          )}
        </div>
      )}
    </InspectorShell>
  );
}

export type ReviewFocus = 'OVERVIEW' | 'SCHEDULE' | 'DIALER';

export function ReviewRightInspector({
  isBasic,
  focus,
  onChangeFocus,
  name,
  description,
  startNow,
  scheduledAt,
  mailingName,
  audienceLabel,
  agentLabel,
  channelLabel,
  calendarName,
  trunksData,
  trunkIds,
  outboundRoutesSummary,
  dialMultiplier,
  effectiveQuota,
}: {
  isBasic: boolean;
  focus: ReviewFocus;
  onChangeFocus: (f: ReviewFocus) => void;
  name: string;
  description: string;
  startNow: boolean;
  scheduledAt: string;
  mailingName?: string;
  audienceLabel: string;
  agentLabel: string;
  channelLabel: string;
  calendarName?: string;
  trunksData?: TrunkAvailabilityResponse;
  trunkIds: string[];
  outboundRoutesSummary?: string;
  dialMultiplier: number;
  effectiveQuota: number;
}) {
  const tabs: InspectorTabOption<ReviewFocus>[] = isBasic
    ? [
        { id: 'OVERVIEW', label: 'Resumo da campanha' },
        { id: 'SCHEDULE', label: 'Agendamento' },
      ]
    : [
        { id: 'OVERVIEW', label: 'Resumo' },
        { id: 'SCHEDULE', label: 'Agendamento' },
        { id: 'DIALER', label: 'Troncos & Ritmo' },
      ];

  const resolvedFocus = tabs.some((t) => t.id === focus) ? focus : tabs[0].id;

  return (
    <InspectorShell
      title="Detalhamento da campanha"
      tooltip="Prévia consolidada das escolhas que serão gravadas ao iniciar ou agendar esta campanha."
      tabs={tabs}
      activeTab={resolvedFocus}
      onSelectTab={onChangeFocus}
    >
      {resolvedFocus === 'OVERVIEW' && (
        <div className="space-y-4 text-xs">
          <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-center gap-2.5">
              <Rocket className="size-4 shrink-0 text-brand-700" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {name.trim() || 'Nova campanha sem nome'}
                </div>
                {description.trim() && (
                  <div className="mt-0.5 line-clamp-2 text-slate-500">{description.trim()}</div>
                )}
              </div>
            </div>
            <Badge tone={startNow ? 'green' : 'brand'}>
              {startNow ? 'Imediato' : 'Agendado'}
            </Badge>
          </div>
          <KeyValue
            items={[
              ['Mailing', mailingName ?? '—'],
              ['Público', audienceLabel],
              ['Agente', agentLabel],
              ['Canal', channelLabel],
              ['Calendário', calendarName ?? 'Padrão do workspace'],
              ['Início', startNow ? 'Imediatamente na próxima janela' : scheduledAt.replace('T', ' ')],
            ]}
          />
        </div>
      )}

      {resolvedFocus === 'SCHEDULE' && (
        <div className="space-y-3 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Clock className="size-4 text-brand-700" />
              {startNow ? 'Início imediato selecionado' : 'Disparo agendado'}
            </div>
            <div className="mt-1 text-slate-600">
              {startNow
                ? 'A campanha entra em execução assim que houver contatos elegíveis dentro da janela do calendário.'
                : `Programada para ${scheduledAt.replace('T', ' ')} (Horário de Brasília).`}
            </div>
          </div>
          <KeyValue
            items={[
              ['Calendário aplicado', calendarName ?? 'Padrão'],
              ['Nome', name.trim() || '—'],
            ]}
          />
        </div>
      )}

      {resolvedFocus === 'DIALER' && !isBasic && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <span className="flex items-center gap-2 font-semibold text-slate-900">
              <PhoneCall className="size-4 text-brand-700" />
              Capacidade do Discador
            </span>
            <Badge tone="brand">Cota: {fmtNumber(effectiveQuota)}</Badge>
          </div>
          <KeyValue
            items={[
              [
                'Regra de saída',
                trunkIds.length === 0
                  ? `Automático por Rotas de Saída (${outboundRoutesSummary || 'padrão'})`
                  : `Sobrescrito na Campanha (${trunkIds.length} tronco(s))`,
              ],
              ['Troncos elegíveis', trunkIds.length === 0 ? `Todos ativos (${trunksData?.trunks.length ?? 0})` : `${trunkIds.length} específico(s)`],
              ['Canais livres / totais', `${trunksData?.availableChannels ?? 0} / ${trunksData?.totalChannels ?? 0}`],
              ['Multiplicador', `${dialMultiplier}x`],
              ['Gateway', trunksData?.gatewayOnline ? 'Online' : trunksData?.gatewayConfigured ? 'Offline' : 'Simulado'],
            ]}
          />
        </div>
      )}
    </InspectorShell>
  );
}

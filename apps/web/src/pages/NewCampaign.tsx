import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Bot,
  Cable,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  ExternalLink,
  Layers,
  Loader2,
  PhoneCall,
  Plus,
  Rocket,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import {
  CHANNEL_LABEL,
  CHANNEL_TYPES,
  CONNECTION_CHANNEL_LABEL,
  isDialerManagerRole,
  type CampaignDraft,
  type ChannelType,
  type OperationPurpose,
} from '@voll/shared';
import type {
  Campaign,
  CampaignTemplate,
  Connection,
  DraftEnvelope,
  Journey,
  ListSummary,
  MailingSummary,
  OperationCalendar,
  Strategy,
  TrunkAvailabilityResponse,
} from '../lib/types';
import type { TenantConfig } from './telephony/types';
import {
  fmtDateTime,
  fmtNumber,
  nowSaoPauloLocal,
  saoPauloLocalToIso,
} from '../lib/format';
import { ApiError, get, post, put, del, errorMessage } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  InfoTooltip,
  Input,
  Loading,
  PageHeader,
  RadioCard,
  Select,
  Textarea,
  useToast,
} from '../components/ui';
import { ImportFlow } from '../components/ImportFlow';
import { ListEditor, type ListEditorState } from '../components/ListEditor';
import { JourneySteps } from '../components/Summaries';
import { SaveAsTemplateModal } from '../components/SaveAsTemplateModal';
import {
  ActivationRightInspector,
  AudienceRightInspector,
  MailingRightInspector,
  ReviewRightInspector,
  WizardTwoColumnLayout,
  type ActivationFocus,
  type ReviewFocus,
} from '../components/CampaignWizardInspector';
import { useAuth } from '../lib/auth';
import { useExperienceMode } from '../lib/experience-mode';

type Step = CampaignDraft['step'];

const DEFAULT_CHANNEL_TIMEOUT: Record<ChannelType, number> = {
  VOICE: 5,
  WHATSAPP: 30,
  SMS: 30,
  EMAIL: 120,
};

type MailingSource = 'IMPORT' | 'MAILING';

type Extra = {
  mailingSource?: MailingSource;
  mailingName?: string;
  audienceCount?: number | null;
  listEditor?: ListEditorState;
  listId?: string;
  listPublishedState?: string;
  listName?: string;
  listVersion?: number;
  scheduleLocal?: string;
  templateApplied?: string;
  templateName?: string;
  templateJourney?: string;
  templateStrategy?: string;
  purposeCode?: OperationPurpose;
  calendarId?: string;
  calendarName?: string;
  selectedConnectionId?: string;
  voiceAgentId?: string | null;
  voiceAgentName?: string;
  voiceAgentManual?: boolean;
  trunkIds?: string[];
  dialMultiplier?: number;
};

const EMPTY: CampaignDraft = { step: 'MAILING', extra: {} };

type UpdateFn = (patch: Partial<CampaignDraft>, extraPatch?: Partial<Extra>) => void;

export function NewCampaignPage() {
  const { can } = useAuth();
  const { mode } = useExperienceMode();
  const isBasic = mode === 'basic';
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp] = useSearchParams();
  const modeloId = sp.get('modeloId');
  const listaId = sp.get('lista');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const listaAppliedRef = useRef(false);

  const steps = useMemo<{ id: Step; label: string; num: number }[]>(
    () =>
      isBasic
        ? [
            { id: 'MAILING', label: 'Mailing', num: 1 },
            { id: 'ACTIVATION', label: 'Acionamento', num: 2 },
            { id: 'CAMPAIGN', label: 'Resumo', num: 3 },
          ]
        : [
            { id: 'MAILING', label: 'Mailing', num: 1 },
            { id: 'AUDIENCE', label: 'Público (filtro)', num: 2 },
            { id: 'ACTIVATION', label: 'Acionamento', num: 3 },
            { id: 'CAMPAIGN', label: 'Revisar e finalizar', num: 4 },
          ],
    [isBasic],
  );

  const draftQ = useQuery({
    queryKey: ['campaign-draft'],
    queryFn: () => get<DraftEnvelope>('/campaign-draft'),
    staleTime: Infinity,
    gcTime: 0,
  });

  const templateQ = useQuery({
    queryKey: ['campaign-template', modeloId],
    queryFn: () => get<CampaignTemplate>(`/campaign-templates/${modeloId}`),
    enabled: !!modeloId,
  });
  const appliedTemplateRef = useRef<string | null>(null);

  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error' | 'conflict'>('idle');
  const dirtyRef = useRef(false);
  const revRef = useRef(0);
  revRef.current = revision;

  useEffect(() => {
    if (draftQ.data !== undefined && draft === null) {
      if (draftQ.data) {
        const raw = draftQ.data as any;
        const loaded: CampaignDraft = raw.data ?? raw.draft ?? { ...EMPTY };
        setDraft(loaded);
        setRevision(raw.revision ?? 0);
        const ts = raw.updatedAt ?? raw.savedAt;
        if (ts) {
          const d = new Date(ts);
          if (!isNaN(d.getTime())) setSavedAt(d);
        }
      } else {
        setDraft({ ...EMPTY });
      }
    }
  }, [draftQ.data, draft]);

  const saveMut = useMutation({
    mutationFn: (d: CampaignDraft) =>
      put<{ revision: number; updatedAt: string }>('/campaign-draft', {
        data: d,
        revision: revRef.current,
      }),
    onSuccess: (res, sentDraft) => {
      setRevision(res.revision);
      setSavedAt(new Date(res.updatedAt));
      setSaveState('idle');
      dirtyRef.current = false;
      qc.setQueryData(['campaign-draft'], {
        data: sentDraft,
        revision: res.revision,
        updatedAt: res.updatedAt,
      } satisfies DraftEnvelope);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setSaveState('conflict');
      } else {
        setSaveState('error');
      }
    },
  });

  const timerRef = useRef<number | null>(null);
  const saveNow = useCallback(
    (next: CampaignDraft) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      setSaveState('saving');
      saveMut.mutate(next);
    },
    [saveMut],
  );

  const update: UpdateFn = useCallback(
    (patch, extraPatch) => {
      setDraft((cur) => {
        const base = cur ?? EMPTY;
        const next: CampaignDraft = {
          ...base,
          ...patch,
          extra: { ...(base.extra ?? {}), ...(extraPatch ?? {}) },
        };
        dirtyRef.current = true;
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => saveNow(next), 1200);
        return next;
      });
    },
    [saveNow],
  );

  // Aplica modelo de campanha se presente via ?modeloId=...
  useEffect(() => {
    if (templateQ.data && draft && appliedTemplateRef.current !== templateQ.data.id) {
      appliedTemplateRef.current = templateQ.data.id;
      update(
        {
          journeyVersionId: templateQ.data.journeyVersionId || templateQ.data.journeyId,
          strategyVersionId: templateQ.data.strategyVersionId || templateQ.data.strategyId,
          name: draft.name || `Campanha - ${templateQ.data.name}`,
        },
        {
          purposeCode: templateQ.data.purposeCode ?? 'COBRANCA',
          templateApplied: templateQ.data.id,
          templateName: templateQ.data.name,
          templateJourney: templateQ.data.journeyName,
          templateStrategy: templateQ.data.strategyName,
          calendarId: templateQ.data.calendarId ?? undefined,
          calendarName: templateQ.data.calendarName ?? undefined,
        },
      );
      toast('success', `Modelo "${templateQ.data.name}" aplicado! Jornada e estratégia foram pré-configuradas.`);
    }
  }, [templateQ.data, draft, update, toast]);

  const extra: Extra = (draft?.extra as Extra) ?? {};
  const currentStep = draft?.step ?? 'MAILING';

  const mailingsQ = useQuery({
    queryKey: ['mailings'],
    queryFn: () => get<{ items: MailingSummary[] }>('/mailings'),
  });

  const listsQ = useQuery({
    queryKey: ['lists'],
    queryFn: () => get<{ items: ListSummary[] }>('/lists'),
  });

  useEffect(() => {
    if (!listaId || listaAppliedRef.current || !listsQ.data?.items || draft === null) return;
    const found = listsQ.data.items.find((l) => l.id === listaId);
    if (!found) return;
    listaAppliedRef.current = true;
    update(
      {
        mailingId: found.mailing.id,
        audienceMode: found.latestVersion ? 'LIST' : 'ALL',
        listVersionId: found.latestVersion?.id,
        step: isBasic ? 'ACTIVATION' : 'AUDIENCE',
      },
      {
        mailingSource: 'MAILING',
        mailingName: found.mailing.name,
        listId: found.id,
        listName: found.name,
        listVersion: found.latestVersion?.version,
        audienceCount: found.latestVersion?.memberCount ?? undefined,
      },
    );
    toast('info', `Lista "${found.name}" pré-selecionada para a campanha.`);
  }, [listaId, listsQ.data, draft, isBasic, update, toast]);

  // Guarda segura na alternância Avançado -> Básico durante etapa de filtro oculta
  useEffect(() => {
    if (draft && isBasic && draft.step === 'AUDIENCE') {
      update({ step: draft.mailingId ? 'ACTIVATION' : 'MAILING' });
    }
  }, [isBasic, draft, update]);

  const connectionsQ = useQuery({
    queryKey: ['connections'],
    queryFn: () => get<{ items: Connection[] }>('/connections'),
  });

  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ count?: number; tenants: TenantConfig[] }>('/telephony/tenants'),
    retry: false,
  });

  const journeysQ = useQuery({
    queryKey: ['journeys'],
    queryFn: () => get<{ items: Journey[] }>('/journeys'),
  });

  const strategiesQ = useQuery({
    queryKey: ['strategies'],
    queryFn: () => get<{ items: Strategy[] }>('/strategies'),
  });

  const calendarsQ = useQuery({
    queryKey: ['calendars'],
    queryFn: () => get<{ items: OperationCalendar[] }>('/calendars'),
  });

  const activeConnections = useMemo(
    () =>
      (connectionsQ.data?.items ?? []).filter(
        (c): c is Connection & { channelType: ChannelType } =>
          c.active && (CHANNEL_TYPES as readonly string[]).includes(c.channelType),
      ),
    [connectionsQ.data],
  );

  const activeVoiceAgents = useMemo(() => {
    const gatewayAgents = (tenantsQ.data?.tenants ?? []).filter((t) => t.active !== false);
    if (gatewayAgents.length > 0) return gatewayAgents;
    // Fallback amigável caso o gateway de telefonia não retorne tenants no momento
    const fallback: TenantConfig[] = [];
    for (const conn of activeConnections) {
      if ((conn.provider === 'VOICE_APP' || conn.channelType === 'VOICE') && conn.tenantId) {
        if (!fallback.some((x) => x.id === conn.tenantId)) {
          fallback.push({ id: conn.tenantId, name: `${conn.name} (Padrão)`, active: true });
        }
      }
    }
    return fallback;
  }, [tenantsQ.data, activeConnections]);

  const selectedMailing = useMemo(
    () => mailingsQ.data?.items.find((m) => m.id === draft?.mailingId),
    [mailingsQ.data, draft?.mailingId],
  );

  const selectedJourney = useMemo(
    () => journeysQ.data?.items.find((j) => j.latestVersion?.id === draft?.journeyVersionId),
    [journeysQ.data, draft?.journeyVersionId],
  );

  const selectedStrategy = useMemo(
    () => strategiesQ.data?.items.find((s) => s.latestVersion?.id === draft?.strategyVersionId),
    [strategiesQ.data, draft?.strategyVersionId],
  );

  const selectedCalendar = useMemo(
    () => calendarsQ.data?.items.find((c) => c.id === extra.calendarId),
    [calendarsQ.data, extra.calendarId],
  );

  const selectedConnection = useMemo(() => {
    if (extra.selectedConnectionId) {
      const byId = activeConnections.find((c) => c.id === extra.selectedConnectionId);
      if (byId) return byId;
    }
    const firstStepConnId = selectedJourney?.latestVersion?.steps?.[0]?.connectionId;
    if (firstStepConnId) {
      return (connectionsQ.data?.items ?? []).find((c) => c.id === firstStepConnId);
    }
    return undefined;
  }, [extra.selectedConnectionId, activeConnections, selectedJourney, connectionsQ.data]);

  const selectedAgent = useMemo(() => {
    const agentId = extra.voiceAgentId ?? selectedConnection?.tenantId ?? null;
    if (!agentId) return null;
    return activeVoiceAgents.find((a) => a.id === agentId) ?? { id: agentId, name: extra.voiceAgentName || agentId, active: true };
  }, [extra.voiceAgentId, extra.voiceAgentName, selectedConnection, activeVoiceAgents]);

  /** Garante uma jornada de etapa única para o canal selecionado no Modo Básico. */
  const ensureSimpleChannelJourney = useCallback(
    async (conn: Connection): Promise<string> => {
      if (!(CHANNEL_TYPES as readonly string[]).includes(conn.channelType)) {
        throw new Error('Selecione um canal de disparo outbound (Voz, WhatsApp, SMS ou E-mail).');
      }
      const outboundChannel = conn.channelType as ChannelType;
      const existing = (journeysQ.data?.items ?? []).find((j) => {
        const st = j.latestVersion?.steps ?? [];
        return st.length === 1 && st[0].connectionId === conn.id && st[0].channelType === outboundChannel;
      });
      if (existing?.latestVersion?.id) return existing.latestVersion.id;

      const created = await post<Journey>('/journeys', {
        name: `Canal Simples · ${conn.name}`,
        steps: [
          {
            channelType: outboundChannel,
            connectionId: conn.id,
            feedbackTimeoutMinutes: DEFAULT_CHANNEL_TIMEOUT[outboundChannel] ?? 30,
          },
        ],
      });
      qc.setQueryData<{ items: Journey[] }>(['journeys'], (prev) => ({
        items: [...(prev?.items ?? []), created],
      }));
      if (!created.latestVersion?.id) {
        throw new Error('Não foi possível preparar a jornada do canal selecionado.');
      }
      return created.latestVersion.id;
    },
    [journeysQ.data, qc],
  );

  const curIdx = steps.findIndex((s) => s.id === currentStep);

  const goStep = (target: Step) => {
    if (isBasic && target === 'AUDIENCE') {
      target = 'ACTIVATION';
    }
    const tIdx = steps.findIndex((s) => s.id === target);
    if (tIdx > 0 && !draft?.mailingId) {
      toast('info', 'Importe ou selecione um mailing antes de avançar.');
      return;
    }
    if (!isBasic && target === 'CAMPAIGN' && (!draft?.journeyVersionId || !draft?.strategyVersionId)) {
      toast('info', 'Selecione uma jornada e uma estratégia antes de avançar.');
      return;
    }
    if (isBasic && target === 'CAMPAIGN' && !selectedConnection && !draft?.journeyVersionId) {
      toast('info', 'Selecione um canal na etapa Acionamento antes de avançar.');
      return;
    }
    update({ step: target });
  };

  if (!can('campaigns.create')) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <Alert tone="warn" title="Permissão insuficiente">
          Seu perfil não tem permissão para criar campanhas.
        </Alert>
      </div>
    );
  }

  if (draft === null) {
    return (
      <div className="py-12">
        <Loading label="Carregando assistente de campanha…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Nova campanha"
        tooltip={
          isBasic
            ? 'Modo Básico: fluxo direto em 3 etapas (Mailing, Acionamento e Resumo), aplicando 100% da base elegível.'
            : 'Modo Avançado: assistente completo em 4 etapas com filtros de público, jornadas multicanal, estratégias e controle de troncos.'
        }
        actions={
          <div className="flex items-center gap-2">
            {saveState === 'saving' && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 className="size-3 animate-spin text-brand-700" />
                Salvando rascunho…
              </span>
            )}
            {saveState === 'idle' && savedAt && !isNaN(savedAt.getTime()) && (
              <span className="text-xs text-slate-400">
                Rascunho salvo às {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {!isBasic && (
              <Link to="/campanhas/modelos">
                <Button size="sm" variant="secondary" icon={<Bookmark className="size-3.5" />}>
                  Modelos de campanhas
                </Button>
              </Link>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDiscard(true)}
            >
              Descartar rascunho
            </Button>
          </div>
        }
      />

      {/* Banner de Modelo Aplicado */}
      {!isBasic && (draft.extra?.templateName || templateQ.data) && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-2.5 text-xs text-brand-900 shadow-xs">
          <div className="flex items-center gap-2">
            <Bookmark className="size-4 text-brand-700 shrink-0" />
            <div>
              <span>Modelo em uso: <strong>{String(draft.extra?.templateName || templateQ.data?.name || '')}</strong></span>
              {(draft.extra?.templateJourney || templateQ.data?.journeyName) && (
                <span className="text-brand-800 ml-1.5">
                  (Jornada: <em>{String(draft.extra?.templateJourney || templateQ.data?.journeyName || '')}</em> · Estratégia: <em>{String(draft.extra?.templateStrategy || templateQ.data?.strategyName || '')}</em>)
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/campanhas/modelos"
              className="font-medium text-brand-700 hover:text-brand-900 hover:underline"
            >
              Trocar modelo →
            </Link>
            <button
              type="button"
              onClick={() => {
                update({}, { templateApplied: undefined, templateName: undefined, templateJourney: undefined, templateStrategy: undefined });
                appliedTemplateRef.current = null;
                toast('info', 'Vínculo com o modelo removido.');
              }}
              className="text-[11px] text-slate-500 hover:text-slate-800 underline"
            >
              Remover
            </button>
          </div>
        </div>
      )}

      {/* Stepper Superior */}
      <nav aria-label="Progresso da criação" className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
        <ol className="flex items-center justify-between gap-2 overflow-x-auto">
          {steps.map((s, idx) => {
            const isActive = s.id === currentStep;
            const isCompleted = curIdx >= 0 && idx < curIdx;
            return (
              <li key={s.id} className="flex flex-1 items-center gap-2 min-w-[140px]">
                <button
                  type="button"
                  onClick={() => goStep(s.id)}
                  className={clsx(
                    'flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors cursor-pointer',
                    isActive && 'bg-brand-50 text-brand-900 ring-1 ring-inset ring-brand-200 font-semibold',
                    isCompleted && 'text-slate-800 hover:bg-slate-50',
                    !isActive && !isCompleted && 'text-slate-400 hover:text-slate-600',
                  )}
                >
                  <span
                    className={clsx(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                      isActive && 'bg-brand-700 text-white',
                      isCompleted && 'bg-emerald-600 text-white',
                      !isActive && !isCompleted && 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {isCompleted ? <Check className="size-3.5 stroke-[3]" /> : s.num}
                  </span>
                  <span className="truncate">{s.label}</span>
                </button>
                {idx < steps.length - 1 && <span className="text-slate-300 font-light select-none">/</span>}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Conteúdo do Passo Ativo */}
      <div className="space-y-6">
        {currentStep === 'MAILING' && (
          <MailingStep
            isBasic={isBasic}
            draft={draft}
            extra={extra}
            mailings={mailingsQ.data?.items}
            selectedMailing={selectedMailing}
            update={update}
            onNext={() => goStep(isBasic ? 'ACTIVATION' : 'AUDIENCE')}
          />
        )}

        {currentStep === 'AUDIENCE' && !isBasic && (
          <AudienceStep
            draft={draft}
            extra={extra}
            mailing={selectedMailing}
            lists={listsQ.data?.items}
            update={update}
            onBack={() => goStep('MAILING')}
            onNext={() => goStep('ACTIVATION')}
          />
        )}

        {currentStep === 'ACTIVATION' && (
          <ActivationStep
            isBasic={isBasic}
            draft={draft}
            extra={extra}
            connections={activeConnections}
            allConnections={connectionsQ.data?.items}
            voiceAgents={activeVoiceAgents}
            journeys={journeysQ.data?.items}
            strategies={strategiesQ.data?.items}
            calendars={calendarsQ.data?.items}
            selectedConnection={selectedConnection}
            selectedAgent={selectedAgent}
            selectedJourney={selectedJourney}
            selectedStrategy={selectedStrategy}
            selectedCalendar={selectedCalendar}
            ensureSimpleChannelJourney={ensureSimpleChannelJourney}
            update={update}
            onBack={() => goStep(isBasic ? 'MAILING' : 'AUDIENCE')}
            onNext={() => goStep('CAMPAIGN')}
          />
        )}

        {currentStep === 'CAMPAIGN' && (
          <ReviewStep
            isBasic={isBasic}
            draft={draft}
            extra={extra}
            selectedMailing={selectedMailing}
            selectedConnection={selectedConnection}
            selectedAgent={selectedAgent}
            selectedJourney={selectedJourney}
            selectedStrategy={selectedStrategy}
            selectedCalendar={selectedCalendar}
            allConnections={connectionsQ.data?.items}
            voiceAgents={activeVoiceAgents}
            ensureSimpleChannelJourney={ensureSimpleChannelJourney}
            update={update}
            onBack={() => goStep('ACTIVATION')}
            onDone={(campaign) => {
              del('/campaign-draft').catch(() => {});
              toast('success', `Campanha "${campaign.name}" criada com sucesso!`);
              nav(`/campanhas/${campaign.id}`);
            }}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar rascunho?"
        confirmLabel="Descartar"
        danger
        onConfirm={() => {
          del('/campaign-draft').then(() => {
            setDraft({ ...EMPTY });
            setRevision(0);
            setConfirmDiscard(false);
            toast('info', 'Rascunho descartado.');
          });
        }}
      >
        Este rascunho será descartado e a configuração recomeçará do zero.
      </ConfirmDialog>
    </div>
  );
}

// ==================================================================
// ETAPA 1: MAILING
// ==================================================================
function MailingStep({
  isBasic,
  draft,
  extra,
  mailings,
  selectedMailing,
  update,
  onNext,
}: {
  isBasic: boolean;
  draft: CampaignDraft;
  extra: Extra;
  mailings?: MailingSummary[];
  selectedMailing?: MailingSummary;
  update: UpdateFn;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const source: MailingSource = extra.mailingSource ?? (draft.mailingId ? 'MAILING' : 'IMPORT');
  const [selectedId, setSelectedId] = useState<string>(draft.mailingId ?? '');

  const setMailing = (mailingId: string | null, name?: string, andGoNext = false) => {
    setSelectedId(mailingId ?? '');
    update(
      {
        mailingId,
        audienceMode: 'ALL',
        listVersionId: null,
        sourceListVersionId: null,
        ...(andGoNext && mailingId ? { step: isBasic ? 'ACTIVATION' : 'AUDIENCE' } : {}),
      },
      { mailingSource: source, mailingName: name, audienceCount: null },
    );
  };

  const nextLabel = isBasic ? 'Continuar para acionamento' : 'Continuar para público (filtro)';

  return (
    <WizardTwoColumnLayout
      left={
        <>
          {!isBasic && (
            <div className="flex items-center justify-between rounded-xl border border-brand-100 bg-brand-50/40 px-3.5 py-2 text-xs text-brand-900">
              <span className="flex items-center gap-2">
                <Bookmark className="size-3.5 text-brand-700 shrink-0" />
                <span>Carregar modelo pré-configurado</span>
                <InfoTooltip content="Reutilize uma combinação salva de jornada, estratégia e calendário." />
              </span>
              <Link to="/campanhas/modelos" className="font-semibold text-brand-700 hover:text-brand-900 hover:underline shrink-0">
                Explorar modelos →
              </Link>
            </div>
          )}

          <Card
            title="Origem da base de contatos"
            tooltip="Escolha importar um novo arquivo CSV ou selecionar um mailing já carregado neste workspace."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <RadioCard
                name="mailing-source"
                value="IMPORT"
                checked={source === 'IMPORT'}
                onChange={() => update({}, { mailingSource: 'IMPORT' })}
                title="Importar novo mailing"
                description="Arquivo CSV ou colar linhas"
              />
              <RadioCard
                name="mailing-source"
                value="MAILING"
                checked={source === 'MAILING'}
                onChange={() => update({}, { mailingSource: 'MAILING' })}
                title="Selecionar mailing existente"
                description="Base já importada na conta"
              />
            </div>
          </Card>

          {source === 'IMPORT' && (
            <Card
              title="Importar arquivo ou colar dados"
              tooltip="As colunas de nome, identificador e destinos são detectadas automaticamente na importação."
            >
              {draft.mailingId && extra.mailingName ? (
                <div className="space-y-3">
                  <Alert tone="success" title={`Mailing "${extra.mailingName}" importado`}>
                    Base pronta para avançar.
                  </Alert>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={onNext}>
                      {nextLabel} <ArrowRight className="size-4 ml-1" />
                    </Button>
                    <Button variant="secondary" onClick={() => setMailing(null)}>
                      Importar outro arquivo
                    </Button>
                  </div>
                </div>
              ) : (
                <ImportFlow
                  onImported={(r) => {
                    qc.invalidateQueries({ queryKey: ['mailings'] });
                    setMailing(r.mailingId, r.name, true);
                  }}
                />
              )}
            </Card>
          )}

          {source === 'MAILING' && (
            <Card
              title="Escolha um mailing da base"
              tooltip={
                isBasic
                  ? 'No Modo Básico todos os contatos válidos do mailing escolhido serão acionados automaticamente.'
                  : 'Selecione o mailing para seguir à etapa de filtros ou usar 100% da base.'
              }
            >
              {!mailings ? (
                <Loading rows={3} />
              ) : mailings.length === 0 ? (
                <Empty title="Nenhum mailing disponível">
                  Importe um arquivo na opção "Importar novo mailing".
                </Empty>
              ) : (
                <div className="space-y-4">
                  <Field label="Mailing disponível" required>
                    {(f) => (
                      <Select
                        id={f.id}
                        value={selectedId}
                        onChange={(e) => {
                          const m = mailings.find((x) => x.id === e.target.value);
                          setMailing(e.target.value || null, m?.name);
                        }}
                      >
                        <option value="">Selecione um mailing…</option>
                        {mailings.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — {fmtNumber(m.recordCount)} contatos ({fmtDateTime(m.createdAt)})
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  {draft.mailingId && (
                    <div className="flex justify-end pt-2">
                      <Button
                        variant="primary"
                        onClick={() => {
                          if (isBasic) {
                            update(
                              { audienceMode: 'ALL', listVersionId: null },
                              { audienceCount: selectedMailing?.recordCount ?? null },
                            );
                          }
                          onNext();
                        }}
                      >
                        {nextLabel} <ArrowRight className="size-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      }
      right={
        <MailingRightInspector
          isBasic={isBasic}
          selectedMailing={selectedMailing}
          source={source}
          mailingNameFallback={extra.mailingName}
        />
      }
    />
  );
}

// ==================================================================
// ETAPA 2: PÚBLICO (FILTRO)
// ==================================================================
function AudienceStep({
  draft,
  extra,
  mailing,
  lists,
  update,
  onBack,
  onNext,
}: {
  draft: CampaignDraft;
  extra: Extra;
  mailing?: MailingSummary;
  lists?: ListSummary[];
  update: UpdateFn;
  onBack: () => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const publishRef = useRef<(() => Promise<boolean>) | null>(null);
  const [editorState, setEditorState] = useState<{ s: ListEditorState; pending: boolean; selected: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const savedListsForMailing = useMemo(
    () => (lists ?? []).filter((l) => l.mailing.id === draft.mailingId && l.latestVersion),
    [lists, draft.mailingId],
  );

  const hasCustomFilters =
    (editorState?.s.filters.length ?? 0) > 0 || (editorState?.s.sort.length ?? 0) > 0;

  async function handleNext() {
    if (!hasCustomFilters && !draft.sourceListVersionId) {
      update(
        { audienceMode: 'ALL', listVersionId: null },
        { audienceCount: mailing?.recordCount ?? null },
      );
      onNext();
      return;
    }

    setBusy(true);
    const ok = await publishRef.current?.();
    setBusy(false);
    if (ok) {
      update({ audienceMode: 'LIST' });
      onNext();
    }
  }

  return (
    <WizardTwoColumnLayout
      left={
        <>
          {draft.mailingId && savedListsForMailing.length > 0 && (
            <Card
              title="Listas salvas neste mailing (opcional)"
              tooltip="Selecione uma lista já segmentada para reutilizá-la diretamente ou configure novos filtros abaixo."
            >
              <div className="flex flex-wrap gap-2">
                {savedListsForMailing.map((l) => {
                  const selected = draft.listVersionId && l.latestVersion?.id === draft.listVersionId;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        if (!l.latestVersion) return;
                        update(
                          { audienceMode: 'LIST', listVersionId: l.latestVersion.id },
                          {
                            listId: l.id,
                            listName: l.name,
                            listVersion: l.latestVersion.version,
                            audienceCount: l.latestVersion.memberCount,
                          },
                        );
                      }}
                      className={clsx(
                        'rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer',
                        selected
                          ? 'border-brand-700 bg-brand-50 text-brand-900 font-semibold'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      {l.name} ({fmtNumber(l.latestVersion?.memberCount ?? 0)} contatos · v{l.latestVersion?.version})
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {draft.mailingId && (
            <Card
              title="Filtros e Segmentação do Mailing"
              tooltip="Para acionar 100% da base sem restrições, avance diretamente sem adicionar filtros."
            >
              <ListEditor
                mailingId={draft.mailingId}
                listId={extra.listId}
                initial={extra.listEditor}
                publishRef={publishRef}
                onChange={(s: ListEditorState, meta: { pending: boolean; selected: number | null }) => {
                  setEditorState({ s, pending: meta.pending, selected: meta.selected });
                  update(
                    {},
                    {
                      listEditor: s,
                      audienceCount: meta.selected ?? mailing?.recordCount ?? null,
                    },
                  );
                }}
                onPublished={(res, s) => {
                  qc.invalidateQueries({ queryKey: ['lists'] });
                  update(
                    { listVersionId: res.listVersionId, audienceMode: 'LIST' },
                    {
                      listId: res.listId,
                      listVersion: res.version,
                      audienceCount: res.memberCount,
                      listPublishedState: JSON.stringify(s),
                    },
                  );
                }}
              />
            </Card>
          )}
        </>
      }
      right={
        <AudienceRightInspector
          mailing={mailing}
          mailingNameFallback={extra.mailingName}
          hasCustomFilters={hasCustomFilters}
          filterCount={editorState?.s.filters.length ?? 0}
          sortCount={editorState?.s.sort.length ?? 0}
          selectedCount={editorState?.selected ?? extra.audienceCount ?? null}
          listName={extra.listName}
        />
      }
      footer={
        <div className="flex items-center justify-between pt-2">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft className="size-4 mr-1" /> Voltar para mailing
          </Button>
          <Button variant="primary" onClick={handleNext} disabled={busy} loading={busy}>
            {hasCustomFilters ? 'Salvar filtro e ir para acionamento' : 'Continuar com todos os contatos'}{' '}
            <ArrowRight className="size-4 ml-1" />
          </Button>
        </div>
      }
    />
  );
}

// ==================================================================
// ETAPA 3: ACIONAMENTO (JORNADAS E ESTRATÉGIAS)
// ==================================================================
function AgentSelectorCard({
  title,
  tooltip,
  voiceAgents,
  selectedAgent,
  boundTenantId,
  isVoiceRequired,
  error,
  onSelectAgent,
}: {
  title: string;
  tooltip: string;
  voiceAgents: TenantConfig[];
  selectedAgent?: TenantConfig | null;
  boundTenantId?: string | null;
  isVoiceRequired: boolean;
  error?: string;
  onSelectAgent: (agent: TenantConfig) => void;
}) {
  return (
    <Card
      title={title}
      tooltip={tooltip}
      actions={
        <div className="flex items-center gap-2">
          {!isVoiceRequired && <Badge tone="gray">Opcional para canal digital</Badge>}
          <Link
            to="/agentes-de-voz"
            target="_blank"
            className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
          >
            Gerenciar agentes <ExternalLink className="size-3" />
          </Link>
        </div>
      }
    >
      {voiceAgents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500">
          Nenhum agente de voz ativo cadastrado.{' '}
          <Link to="/agentes-de-voz" className="font-semibold text-brand-700 underline">
            Cadastrar agente
          </Link>
          .
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {voiceAgents.map((ag) => {
            const isSelected = selectedAgent?.id === ag.id;
            const isBoundDefault = Boolean(boundTenantId && ag.id === boundTenantId);
            const engineLabel =
              ag.stsEngine === 'elevenlabs'
                ? ['ElevenLabs', ag.elevenlabsModel, ag.elevenlabsVoiceId].filter(Boolean).join(' · ')
                : ['OpenAI Realtime', ag.openaiModel, ag.voice].filter(Boolean).join(' · ');

            return (
              <div
                key={ag.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectAgent(ag)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectAgent(ag);
                  }
                }}
                className={clsx(
                  'flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 text-left transition-all select-none',
                  isSelected
                    ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bot className="size-4 shrink-0 text-brand-700" />
                    <span className="truncate text-[13px] font-semibold text-slate-900">
                      {ag.name || ag.id}
                    </span>
                  </div>
                  {isBoundDefault && (
                    <Badge tone="green" className="shrink-0 text-[10px]">
                      Padrão do canal
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 truncate font-mono text-[11px] text-slate-500">
                  {engineLabel || ag.id}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </Card>
  );
}

function SimpleChannelCard({
  connections,
  selectedConnection,
  voiceAgents,
  error,
  onSelectConnection,
}: {
  connections?: Connection[];
  selectedConnection?: Connection;
  voiceAgents: TenantConfig[];
  error?: string;
  onSelectConnection: (conn: Connection) => void;
}) {
  const list = connections ?? [];
  return (
    <Card
      title="2. Canal simples"
      tooltip="Lista os canais ativos cadastrados em Configuração → Canais e cria automaticamente uma jornada simples de etapa única."
      actions={
        <Link
          to="/canais"
          className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
        >
          Configuração → Canais <ExternalLink className="size-3" />
        </Link>
      }
    >
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500">
          Nenhum canal ativo configurado em{' '}
          <Link to="/canais" className="font-semibold text-brand-700 underline">
            Configuração → Canais
          </Link>
          . Ative ao menos um canal para disparar campanhas.
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {list.map((c) => {
            const isSelected = selectedConnection?.id === c.id;
            const boundAgent = c.tenantId ? voiceAgents.find((a) => a.id === c.tenantId) : undefined;
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConnection(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectConnection(c);
                  }
                }}
                className={clsx(
                  'flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 text-left transition-all select-none',
                  isSelected
                    ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cable className="size-4 shrink-0 text-brand-700" />
                    <span className="truncate text-[13px] font-semibold text-slate-900">{c.name}</span>
                  </div>
                  <Badge tone="brand">{CONNECTION_CHANNEL_LABEL[c.channelType]}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="truncate">{c.provider}</span>
                  {boundAgent && (
                    <span className="truncate text-emerald-700 font-medium">
                      Agente: {boundAgent.name}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </Card>
  );
}

function CalendarSelectorCard({
  title,
  activeCalendars,
  selectedCalendarId,
  onSelectCalendar,
}: {
  title: string;
  activeCalendars: OperationCalendar[];
  selectedCalendarId?: string;
  onSelectCalendar: (cal: OperationCalendar) => void;
}) {
  const DAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return (
    <Card
      title={title}
      tooltip="Define em quais dias, horários e feriados esta campanha pode realizar disparos."
      actions={
        <Link
          to="/calendarios"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900"
        >
          Gerenciar calendários <ExternalLink className="size-3" />
        </Link>
      }
    >
      {activeCalendars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500">
          Nenhum calendário ativo cadastrado.{' '}
          <Link to="/calendarios" className="font-semibold text-brand-700 underline">
            Criar calendário
          </Link>{' '}
          ou usar o horário padrão da estratégia.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {activeCalendars.map((cal) => {
            const selected = selectedCalendarId === cal.id;
            return (
              <div
                key={cal.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectCalendar(cal)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectCalendar(cal);
                  }
                }}
                className={clsx(
                  'flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all select-none',
                  selected
                    ? 'border-brand-700 bg-brand-50/40 ring-1 ring-brand-700'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="size-4 text-brand-700 shrink-0" />
                      <div className="font-semibold text-slate-900 text-sm">{cal.name}</div>
                    </div>
                    <Badge tone={cal.holidayPolicy === 'BLOCK' ? 'amber' : 'green'} className="text-[10px]">
                      {cal.holidayPolicy === 'BLOCK' ? 'Bloqueia feriados' : 'Permite feriados'}
                    </Badge>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {cal.windows.map((w, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                      >
                        <Clock className="size-3 text-slate-500" />
                        {w.days.map((d) => DAYS_SHORT[d]).join(', ')} · {w.start}–{w.end}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                  <span>{cal.timezone}</span>
                  <span>
                    {(cal.holidays?.length ?? 0) > 0
                      ? `${cal.holidays!.length} feriado(s)`
                      : 'Sem feriados cadastrados'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ActivationStep({
  isBasic,
  draft,
  extra,
  connections,
  allConnections,
  voiceAgents,
  journeys,
  strategies,
  calendars,
  selectedConnection,
  selectedAgent,
  selectedJourney,
  selectedStrategy,
  selectedCalendar,
  ensureSimpleChannelJourney,
  update,
  onBack,
  onNext,
}: {
  isBasic: boolean;
  draft: CampaignDraft;
  extra: Extra;
  connections?: Connection[];
  allConnections?: Connection[];
  voiceAgents: TenantConfig[];
  journeys?: Journey[];
  strategies?: Strategy[];
  calendars?: OperationCalendar[];
  selectedConnection?: Connection;
  selectedAgent?: TenantConfig | null;
  selectedJourney?: Journey;
  selectedStrategy?: Strategy;
  selectedCalendar?: OperationCalendar;
  ensureSimpleChannelJourney: (conn: Connection) => Promise<string>;
  update: UpdateFn;
  onBack: () => void;
  onNext: () => void;
}) {
  const [journeyTab, setJourneyTab] = useState<'SIMPLE' | 'MULTI'>('SIMPLE');
  const [strategyTab, setStrategyTab] = useState<'SIMPLE' | 'COMPLETE'>('SIMPLE');
  const [showStrategyDetails, setShowStrategyDetails] = useState(false);
  const [focus, setFocus] = useState<ActivationFocus>('AGENT');
  const [preparingNext, setPreparingNext] = useState(false);
  const [err, setErr] = useState<{
    agent?: string;
    channel?: string;
    journey?: string;
    strategy?: string;
  }>({});

  const activeCalendars = useMemo(
    () => (calendars ?? []).filter((c) => c.active && !c.archivedAt),
    [calendars],
  );

  // Canal de voz vinculado pela jornada (Avançado) ou selecionado (Básico)
  const boundVoiceConn = useMemo(() => {
    if (selectedConnection && (selectedConnection.channelType === 'VOICE' || selectedConnection.provider === 'VOICE_APP')) {
      return selectedConnection;
    }
    const voiceStep = selectedJourney?.latestVersion?.steps.find((s) => s.channelType === 'VOICE');
    if (voiceStep?.connectionId) {
      return (allConnections ?? connections ?? []).find((c) => c.id === voiceStep.connectionId);
    }
    return (connections ?? []).find((c) => c.channelType === 'VOICE' || c.provider === 'VOICE_APP');
  }, [selectedConnection, selectedJourney, allConnections, connections]);

  const boundChannelAgent = useMemo(() => {
    if (!boundVoiceConn?.tenantId) return null;
    return voiceAgents.find((a) => a.id === boundVoiceConn.tenantId) ?? null;
  }, [boundVoiceConn, voiceAgents]);

  const isVoiceRequired = isBasic
    ? Boolean(
        selectedConnection &&
          (selectedConnection.channelType === 'VOICE' || selectedConnection.provider === 'VOICE_APP'),
      )
    : Boolean(selectedJourney?.latestVersion?.steps.some((s) => s.channelType === 'VOICE'));

  // Auto-seleciona defaults se nenhum tiver sido escolhido
  useEffect(() => {
    if (!isBasic && !draft.journeyVersionId && journeys && journeys.length > 0) {
      const defJ =
        journeys.find((j) => j.latestVersion?.steps.some((s) => s.channelType === 'VOICE')) ??
        journeys.find((j) => j.name.includes('WhatsApp')) ??
        journeys[0];
      if (defJ.latestVersion) update({ journeyVersionId: defJ.latestVersion.id });
    }
    if (isBasic && !extra.selectedConnectionId && connections && connections.length > 0) {
      const defConn =
        selectedConnection ??
        connections.find((c) => c.channelType === 'VOICE' || c.provider === 'VOICE_APP') ??
        connections[0];
      if (defConn) update({}, { selectedConnectionId: defConn.id });
    }
    if (!draft.strategyVersionId && strategies && strategies.length > 0) {
      const defS =
        strategies.find(
          (s) => s.name.toLowerCase().includes('simples') || s.name.includes('24x7'),
        ) ?? strategies[0];
      if (defS.latestVersion) update({ strategyVersionId: defS.latestVersion.id });
    }
    if (!extra.calendarId && activeCalendars.length > 0) {
      const defC =
        activeCalendars.find((c) => c.name.includes('Comercial')) ?? activeCalendars[0];
      update({}, { calendarId: defC.id, calendarName: defC.name });
    }
  }, [
    isBasic,
    draft.journeyVersionId,
    draft.strategyVersionId,
    extra.calendarId,
    extra.selectedConnectionId,
    selectedConnection,
    connections,
    journeys,
    strategies,
    activeCalendars,
    update,
  ]);

  // Pré-seleciona automaticamente o agente padrão vinculado ao canal quando não houver sobrescrita manual
  useEffect(() => {
    if (extra.voiceAgentManual) return;
    const boundId = boundVoiceConn?.tenantId;
    if (boundId && extra.voiceAgentId !== boundId) {
      const ag = voiceAgents.find((a) => a.id === boundId);
      update({}, { voiceAgentId: boundId, voiceAgentName: ag?.name ?? boundId });
    }
  }, [extra.voiceAgentManual, extra.voiceAgentId, boundVoiceConn, voiceAgents, update]);

  // Filtra jornadas por Simples (1 canal) e Multicanal
  const simpleJourneys = useMemo(
    () => journeys?.filter((j) => (j.latestVersion?.steps.length ?? 0) <= 1) ?? [],
    [journeys],
  );
  const multiJourneys = useMemo(
    () => journeys?.filter((j) => (j.latestVersion?.steps.length ?? 0) > 1) ?? [],
    [journeys],
  );

  // Filtra estratégias por Simples e Completas
  const simpleStrategies = useMemo(
    () =>
      strategies?.filter(
        (s) =>
          s.name.toLowerCase().includes('simples') || (s.latestVersion?.config.limits.total ?? 0) <= 6,
      ) ?? [],
    [strategies],
  );
  const completeStrategies = useMemo(
    () =>
      strategies?.filter(
        (s) =>
          !s.name.toLowerCase().includes('simples') && (s.latestVersion?.config.limits.total ?? 0) > 6,
      ) ?? [],
    [strategies],
  );

  // Sincroniza abas com a seleção atual (ex: vinda de modelo)
  useEffect(() => {
    if (multiJourneys.some((j) => j.latestVersion?.id === draft.journeyVersionId)) {
      setJourneyTab('MULTI');
    }
  }, [draft.journeyVersionId, multiJourneys]);

  useEffect(() => {
    if (completeStrategies.some((s) => s.latestVersion?.id === draft.strategyVersionId)) {
      setStrategyTab('COMPLETE');
    }
  }, [draft.strategyVersionId, completeStrategies]);

  async function handleNext() {
    if (isBasic) {
      const errors: typeof err = {};
      if (!selectedConnection) {
        errors.channel = 'Selecione um canal ativo de Configuração → Canais.';
      }
      if (isVoiceRequired && !selectedAgent && voiceAgents.length > 0) {
        errors.agent = 'Selecione um agente para realizar as ligações.';
      }
      setErr(errors);
      if (Object.keys(errors).length > 0 || !selectedConnection) return;

      const resolvedStrategyId =
        draft.strategyVersionId ||
        simpleStrategies[0]?.latestVersion?.id ||
        strategies?.[0]?.latestVersion?.id;

      setPreparingNext(true);
      try {
        const curStep = selectedJourney?.latestVersion?.steps?.[0];
        const matchesConn =
          selectedJourney?.latestVersion?.steps.length === 1 &&
          curStep?.connectionId === selectedConnection.id &&
          curStep?.channelType === selectedConnection.channelType;

        const journeyVersionId = matchesConn
          ? selectedJourney!.latestVersion!.id
          : await ensureSimpleChannelJourney(selectedConnection);

        update(
          { journeyVersionId, strategyVersionId: resolvedStrategyId },
          { selectedConnectionId: selectedConnection.id },
        );
        onNext();
      } catch (e) {
        setErr({ channel: errorMessage(e) });
      } finally {
        setPreparingNext(false);
      }
      return;
    }

    const errors: typeof err = {};
    if (!draft.journeyVersionId) errors.journey = 'Selecione uma jornada para os disparos.';
    if (!draft.strategyVersionId) errors.strategy = 'Selecione uma estratégia com janelas e limites.';
    setErr(errors);
    if (Object.keys(errors).length === 0) onNext();
  }

  const stratCfg = selectedStrategy?.latestVersion?.config;

  return (
    <WizardTwoColumnLayout
      left={
        <>
          <AgentSelectorCard
            title={isBasic ? '1. Agente' : '1. Agente de Voz por Campanha'}
            tooltip="Define qual agente IA responderá pelas ligações desta campanha. Por padrão usa o agente vinculado ao canal, podendo ser sobrescrito sem alterar Configuração → Canais."
            voiceAgents={voiceAgents}
            selectedAgent={selectedAgent}
            boundTenantId={boundVoiceConn?.tenantId}
            isVoiceRequired={isVoiceRequired}
            error={err.agent}
            onSelectAgent={(ag) => {
              setFocus('AGENT');
              setErr((prev) => ({ ...prev, agent: undefined }));
              update({}, { voiceAgentId: ag.id, voiceAgentName: ag.name, voiceAgentManual: true });
            }}
          />

          {isBasic ? (
            <SimpleChannelCard
              connections={connections}
              selectedConnection={selectedConnection}
              voiceAgents={voiceAgents}
              error={err.channel}
              onSelectConnection={(c) => {
                setFocus('CHANNEL');
                setErr((prev) => ({ ...prev, channel: undefined }));
                const nextExtra: Partial<Extra> = { selectedConnectionId: c.id };
                if (!extra.voiceAgentManual && c.tenantId) {
                  const ag = voiceAgents.find((a) => a.id === c.tenantId);
                  nextExtra.voiceAgentId = c.tenantId;
                  nextExtra.voiceAgentName = ag?.name ?? c.tenantId;
                }
                const matchingJ = journeys?.find((j) => {
                  const st = j.latestVersion?.steps ?? [];
                  return (
                    st.length === 1 &&
                    st[0].connectionId === c.id &&
                    st[0].channelType === c.channelType
                  );
                });
                update({ journeyVersionId: matchingJ?.latestVersion?.id }, nextExtra);
              }}
            />
          ) : (
            <>
              {/* SEÇÃO 2 (AVANÇADO): JORNADAS */}
              <Card
                title="2. Selecione a Jornada de Canais"
                tooltip="A jornada determina quais canais serão acionados e em qual ordem com tempo de transbordo."
                actions={
                  <Link
                    to="/jornadas"
                    target="_blank"
                    className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    <Plus className="size-3.5" /> Nova jornada
                    <ExternalLink className="size-3" />
                  </Link>
                }
              >
                <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFocus('JOURNEY');
                      setJourneyTab('SIMPLE');
                    }}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      journeyTab === 'SIMPLE'
                        ? 'bg-brand-50 text-brand-900 border border-brand-200'
                        : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    Jornadas Simples (1 Canal)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFocus('JOURNEY');
                      setJourneyTab('MULTI');
                    }}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      journeyTab === 'MULTI'
                        ? 'bg-brand-50 text-brand-900 border border-brand-200'
                        : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    Jornadas Multicanal (Transbordo Inteligente)
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {(journeyTab === 'SIMPLE' ? simpleJourneys : multiJourneys).map((j) => {
                    const v = j.latestVersion;
                    if (!v) return null;
                    const isSelected = draft.journeyVersionId === v.id;
                    return (
                      <div
                        key={j.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setFocus('JOURNEY');
                          setErr((prev) => ({ ...prev, journey: undefined }));
                          update({ journeyVersionId: v.id });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setFocus('JOURNEY');
                            setErr((prev) => ({ ...prev, journey: undefined }));
                            update({ journeyVersionId: v.id });
                          }
                        }}
                        className={clsx(
                          'flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer select-none',
                          isSelected
                            ? 'border-brand-500 bg-brand-50/50 shadow-2xs ring-1 ring-brand-500'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50',
                        )}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-slate-900">{j.name}</span>
                            <Badge tone={v.steps.length > 1 ? 'brand' : 'gray'}>
                              {v.steps.length > 1 ? `${v.steps.length} canais` : '1 canal'}
                            </Badge>
                          </div>
                          <div className="mt-2 text-xs text-slate-600">
                            <JourneySteps steps={v.steps} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {err.journey && <p className="mt-2 text-xs font-medium text-red-600">{err.journey}</p>}
              </Card>

              {/* SEÇÃO 3 (AVANÇADO): ESTRATÉGIAS */}
              <Card
                title="3. Selecione a Estratégia de Disparo"
                tooltip="A estratégia define o calendário comercial permitido, limites diários e regras de retentativas."
                actions={
                  <Link
                    to="/estrategias"
                    target="_blank"
                    className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    <Plus className="size-3.5" /> Nova estratégia
                    <ExternalLink className="size-3" />
                  </Link>
                }
              >
                <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFocus('STRATEGY');
                      setStrategyTab('SIMPLE');
                    }}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      strategyTab === 'SIMPLE'
                        ? 'bg-brand-50 text-brand-900 border border-brand-200'
                        : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    Estratégias Simples (Começo Rápido)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFocus('STRATEGY');
                      setStrategyTab('COMPLETE');
                    }}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      strategyTab === 'COMPLETE'
                        ? 'bg-brand-50 text-brand-900 border border-brand-200'
                        : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    Estratégias Completas (Avançadas)
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {(strategyTab === 'SIMPLE' ? simpleStrategies : completeStrategies).map((s) => {
                    const v = s.latestVersion;
                    if (!v) return null;
                    const isSelected = draft.strategyVersionId === v.id;
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setFocus('STRATEGY');
                          setErr((prev) => ({ ...prev, strategy: undefined }));
                          update({ strategyVersionId: v.id });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setFocus('STRATEGY');
                            setErr((prev) => ({ ...prev, strategy: undefined }));
                            update({ strategyVersionId: v.id });
                          }
                        }}
                        className={clsx(
                          'flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer select-none',
                          isSelected
                            ? 'border-brand-500 bg-brand-50/50 shadow-2xs ring-1 ring-brand-500'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50',
                        )}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[13px] font-semibold text-slate-900 truncate">{s.name}</span>
                            {s.protected && <Badge tone="gray">Padrão</Badge>}
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-slate-600">
                            <div>
                              Horário: <strong>{v.config.calendar.start}–{v.config.calendar.end}</strong>
                            </div>
                            <div>
                              Até <strong>{v.config.limits.total} tentativas</strong> ({v.config.limits.daily}/dia)
                            </div>
                            <div>
                              Retentativa em <strong>{v.config.retry.intervalMinutes} min</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {err.strategy && <p className="mt-2 text-xs font-medium text-red-600">{err.strategy}</p>}

                {selectedStrategy && stratCfg && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SlidersHorizontal className="size-4 text-brand-700" />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Estratégia Ativa: {selectedStrategy.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowStrategyDetails(!showStrategyDetails)}
                        className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline cursor-pointer"
                      >
                        {showStrategyDetails ? 'Ocultar detalhes configuráveis' : 'Ver / Configurar detalhes da estratégia'}
                        {showStrategyDetails ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      </button>
                    </div>

                    {showStrategyDetails && (
                      <div className="mt-4 border-t border-slate-200 pt-3 space-y-3 text-xs text-slate-700">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="font-semibold text-slate-500 uppercase text-[10px]">Calendário Operacional</div>
                            <div className="mt-1 font-bold text-slate-900">{stratCfg.calendar.start} às {stratCfg.calendar.end}</div>
                            <div className="mt-0.5 text-slate-500">Dias: {stratCfg.calendar.days.map((d: number) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d]).join(', ')}</div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="font-semibold text-slate-500 uppercase text-[10px]">Limites de Disparo</div>
                            <div className="mt-1 font-bold text-slate-900">{stratCfg.limits.total} totais / {stratCfg.limits.daily} por dia</div>
                            <div className="mt-0.5 text-slate-500">Escopo: {stratCfg.limits.scope}</div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="font-semibold text-slate-500 uppercase text-[10px]">Retentativas</div>
                            <div className="mt-1 font-bold text-slate-900">Intervalo de {stratCfg.retry.intervalMinutes} min</div>
                            <div className="mt-0.5 text-slate-500">Máx {stratCfg.retry.maxPerDestination} por destino</div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="font-semibold text-slate-500 uppercase text-[10px]">Lote & Distribuição</div>
                            <div className="mt-1 font-bold text-slate-900">Lote {stratCfg.distribution.batchSize} contatos</div>
                            <div className="mt-0.5 text-slate-500">Teto pendente: {stratCfg.distribution.maxPending}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] text-slate-500">
                            Regras de tabulação: {Object.keys(stratCfg.tabulationRules).length} códigos configurados.
                          </span>
                          <Link
                            to={`/estrategias/${selectedStrategy.id}`}
                            target="_blank"
                            className="flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                          >
                            Ajustar ou copiar esta estratégia em nova aba <ExternalLink className="size-3" />
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}

          <CalendarSelectorCard
            title={isBasic ? '3. Calendário' : '4. Selecione o Calendário de Funcionamento'}
            activeCalendars={activeCalendars}
            selectedCalendarId={selectedCalendar?.id ?? extra.calendarId}
            onSelectCalendar={(cal) => {
              setFocus('CALENDAR');
              update({}, { calendarId: cal.id, calendarName: cal.name });
            }}
          />

          {!isBasic && (
            <VoiceReadinessCard
              journey={selectedJourney}
              showTrunksPreflight={false}
              selectedAgent={selectedAgent}
              allConnections={allConnections}
            />
          )}
        </>
      }
      right={
        <ActivationRightInspector
          isBasic={isBasic}
          focus={focus}
          onChangeFocus={setFocus}
          selectedAgent={selectedAgent}
          boundChannelAgentName={boundChannelAgent?.name ?? boundVoiceConn?.tenantId ?? null}
          selectedConnection={selectedConnection}
          selectedJourney={selectedJourney}
          selectedStrategy={selectedStrategy}
          selectedCalendar={selectedCalendar}
          isVoiceRequired={isVoiceRequired}
        />
      }
      footer={
        <div className="flex items-center justify-between pt-2">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft className="size-4 mr-1" /> {isBasic ? 'Voltar para mailing' : 'Voltar para público'}
          </Button>
          <Button variant="primary" onClick={handleNext} loading={preparingNext} disabled={preparingNext}>
            {isBasic ? 'Continuar para resumo' : 'Continuar para revisar e finalizar'}
            <ArrowRight className="size-4 ml-1" />
          </Button>
        </div>
      }
    />
  );
}

function VoiceReadinessCard({
  journey,
  showTrunksPreflight,
  selectedAgent,
  allConnections,
}: {
  journey?: Journey;
  showTrunksPreflight: boolean;
  selectedAgent?: TenantConfig | null;
  allConnections?: Connection[];
}) {
  const hasVoice = Boolean(journey?.latestVersion?.steps.some((s) => s.channelType === 'VOICE'));

  const connsQ = useQuery({
    queryKey: ['connections'],
    queryFn: () => get<{ items: Connection[] }>('/connections'),
    enabled: hasVoice && !allConnections,
  });

  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ tenants: TenantConfig[] }>('/telephony/tenants'),
    enabled: hasVoice && !selectedAgent,
    retry: false,
  });

  const statusQ = useQuery({
    queryKey: ['telephony', 'status'],
    queryFn: () => get<{ status?: string }>('/telephony/status'),
    enabled: hasVoice && showTrunksPreflight,
    retry: false,
  });

  const trunksQ = useQuery({
    queryKey: ['telephony', 'trunks'],
    queryFn: () =>
      get<{ trunks: Array<{ id: string; name?: string; active?: boolean; online?: boolean }> }>('/telephony/trunks'),
    enabled: hasVoice && showTrunksPreflight,
    retry: false,
  });

  if (!hasVoice) return null;

  const connItems = allConnections ?? connsQ.data?.items ?? [];
  const voiceStepConnId = journey?.latestVersion?.steps.find((s) => s.channelType === 'VOICE')?.connectionId;
  const voiceConn =
    (voiceStepConnId ? connItems.find((c) => c.id === voiceStepConnId) : undefined) ??
    connItems.find(
      (c) => (c.provider === 'VOICE_APP' || c.channelType === 'VOICE') && c.active,
    ) ??
    connItems.find((c) => c.provider === 'VOICE_APP' || c.channelType === 'VOICE');

  const boundTenantId = voiceConn?.tenantId ?? '';
  const resolvedAgent =
    selectedAgent ??
    tenantsQ.data?.tenants.find((t) => t.id === boundTenantId) ??
    null;

  const activeTrunks = (trunksQ.data?.trunks ?? []).filter((t) => t.active !== false);
  const onlineTrunks = activeTrunks.filter((t) => t.online !== false);
  const gatewayOffline =
    showTrunksPreflight &&
    (statusQ.isError || (statusQ.data !== undefined && statusQ.data.status !== 'ok'));
  const noActiveTrunk = showTrunksPreflight && trunksQ.isSuccess && activeTrunks.length === 0;
  const noOnlineTrunk = showTrunksPreflight && trunksQ.isSuccess && activeTrunks.length > 0 && onlineTrunks.length === 0;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <PhoneCall className="size-4 text-brand-700" />
          Agente de Voz & Preflight de Telefonia
        </span>
      }
      actions={
        <Link to="/agentes-de-voz" className="text-xs font-medium text-brand-700 hover:underline">
          Gerenciar Agentes de Voz →
        </Link>
      }
    >
      <div className="space-y-3 text-xs">
        {resolvedAgent ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
            <div>
              <span className="font-semibold text-emerald-950">
                Agente ({voiceConn?.name ?? 'Canal Voz'}): {resolvedAgent.name}
              </span>
              <span className="ml-2 font-mono text-[11px] text-emerald-800">
                {[
                  resolvedAgent.stsEngine,
                  resolvedAgent.stsEngine === 'elevenlabs'
                    ? resolvedAgent.elevenlabsModel
                    : resolvedAgent.openaiModel,
                  resolvedAgent.stsEngine === 'elevenlabs' ? resolvedAgent.elevenlabsVoiceId : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <Badge tone="green">
              {boundTenantId && resolvedAgent.id === boundTenantId ? 'Padrão do canal' : 'Específico da campanha'}
            </Badge>
          </div>
        ) : (
          <Alert tone="warn" title="Nenhum Agente IA vinculado ao canal Voice-App">
            Vincule um agente em{' '}
            <Link to="/canais" className="font-semibold underline">
              Canais
            </Link>{' '}
            ou selecione um agente acima antes de iniciar disparos de voz.
          </Alert>
        )}

        {showTrunksPreflight && (
          <>
            {gatewayOffline ? (
              <Alert tone="error" title="Gateway Voice-App offline">
                O gateway de voz não respondeu no momento. Verifique o servidor de telefonia antes de iniciar a campanha.
              </Alert>
            ) : noActiveTrunk ? (
              <Alert tone="warn" title="Nenhum tronco SIP ativo encontrado">
                Todos os troncos estão pausados ou nenhum tronco foi cadastrado em{' '}
                <Link to="/telefonia?tab=settings" className="font-semibold underline">
                  Telefonia → Configurações
                </Link>
                .
              </Alert>
            ) : noOnlineTrunk ? (
              <Alert tone="warn" title="Tronco(s) SIP offline no Sofia/FreeSWITCH">
                Há {activeTrunks.length} tronco(s) ativo(s) no cadastro, mas nenhum está online para discar agora. Verifique em{' '}
                <Link to="/telefonia?tab=settings" className="font-semibold underline">
                  Telefonia → Configurações
                </Link>
                .
              </Alert>
            ) : trunksQ.isSuccess ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                <span>
                  Gateway online · <strong>{onlineTrunks.length}</strong> tronco(s) SIP online e prontos para discagem
                </span>
                <Badge tone="green">Preflight OK</Badge>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

// ==================================================================
// ETAPA FINAL: RESUMO / REVISAR E FINALIZAR
// ==================================================================
function ReviewStep({
  isBasic,
  draft,
  extra,
  selectedMailing,
  selectedConnection,
  selectedAgent,
  selectedJourney,
  selectedStrategy,
  selectedCalendar,
  allConnections,
  ensureSimpleChannelJourney,
  update,
  onBack,
  onDone,
}: {
  isBasic: boolean;
  draft: CampaignDraft;
  extra: Extra;
  selectedMailing?: MailingSummary;
  selectedConnection?: Connection;
  selectedAgent?: TenantConfig | null;
  selectedJourney?: Journey;
  selectedStrategy?: Strategy;
  selectedCalendar?: OperationCalendar;
  allConnections?: Connection[];
  voiceAgents?: TenantConfig[];
  ensureSimpleChannelJourney: (conn: Connection) => Promise<string>;
  update: UpdateFn;
  onBack: () => void;
  onDone: (c: Campaign) => void;
}) {
  const { me } = useAuth();
  const canEditDialerConfig = isDialerManagerRole(me?.role);
  const [name, setName] = useState(draft.name ?? `Campanha ${new Date().toLocaleDateString('pt-BR')}`);
  const [description, setDescription] = useState(draft.description ?? '');
  const [startNow, setStartNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState(extra.scheduleLocal ?? nowSaoPauloLocal(60));
  const [trunkIds, setTrunkIds] = useState<string[]>(extra.trunkIds ?? []);
  const [dialMultiplier, setDialMultiplier] = useState<number>(extra.dialMultiplier ?? 1);
  const [focus, setFocus] = useState<ReviewFocus>('OVERVIEW');
  const [err, setErr] = useState<string | null>(null);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);

  const trunksQ = useQuery({
    queryKey: ['telephony-trunks-availability', trunkIds.join(',')],
    queryFn: () =>
      get<TrunkAvailabilityResponse>(
        trunkIds.length > 0
          ? `/telephony/trunks/availability?trunkIds=${encodeURIComponent(trunkIds.join(','))}`
          : '/telephony/trunks/availability',
      ),
    enabled: !isBasic,
    refetchInterval: 10_000,
  });

  const outboundRoutesQ = useQuery({
    queryKey: ['telephony', 'outbound-routes'],
    queryFn: () =>
      get<{ routes: Array<{ id: string; name?: string; trunkId?: string; active?: boolean }> }>(
        '/telephony/outbound-routes',
      ),
    enabled: !isBasic,
    retry: false,
  });

  const activeOutboundRoutes = (outboundRoutesQ.data?.routes ?? []).filter(
    (r) => r.active !== false && (trunkIds.length === 0 || (r.trunkId && trunkIds.includes(r.trunkId))),
  );
  const outboundRoutesSummary =
    activeOutboundRoutes.length > 0
      ? activeOutboundRoutes.map((r) => r.name || r.id).slice(0, 2).join(', ') +
        (activeOutboundRoutes.length > 2 ? ` +${activeOutboundRoutes.length - 2}` : '')
      : undefined;

  const freeChannels = trunksQ.data?.availableChannels ?? 0;
  const totalChannels = trunksQ.data?.totalChannels ?? 0;
  const effectiveQuota = Math.max(0, Math.floor(freeChannels * dialMultiplier));

  const createMut = useMutation({
    mutationFn: async (status: 'RUNNING' | 'DRAFT' | 'SCHEDULED') => {
      let journeyVersionId = draft.journeyVersionId;
      if (!journeyVersionId && selectedConnection) {
        journeyVersionId = await ensureSimpleChannelJourney(selectedConnection);
      }
      if (!journeyVersionId) {
        throw new Error('Selecione uma jornada ou canal antes de criar a campanha.');
      }

      return post<Campaign>('/campaigns', {
        name: name.trim(),
        description: description.trim() || undefined,
        mailingId: draft.mailingId,
        listVersionId: draft.audienceMode === 'LIST' ? draft.listVersionId : null,
        journeyVersionId,
        strategyVersionId: draft.strategyVersionId,
        calendarId: selectedCalendar?.id ?? extra.calendarId ?? null,
        voiceAgentId: selectedAgent?.id ?? null,
        startMode: status === 'RUNNING' ? 'NOW' : status === 'SCHEDULED' ? 'SCHEDULE' : 'READY',
        status,
        scheduledAt: status === 'SCHEDULED' ? saoPauloLocalToIso(scheduledAt) : null,
        ...( !isBasic && canEditDialerConfig ? { trunkIds, dialMultiplier } : {}),
      });
    },
    onSuccess: (c) => onDone(c),
    onError: (e) => setErr(errorMessage(e)),
  });

  function handleSubmit(status: 'RUNNING' | 'DRAFT' | 'SCHEDULED') {
    if (!name.trim()) {
      setErr('Informe o nome da campanha.');
      return;
    }
    if (status === 'SCHEDULED') {
      const iso = saoPauloLocalToIso(scheduledAt);
      if (!iso || new Date(iso).getTime() <= Date.now()) {
        setErr('Informe uma data e hora futura para o agendamento.');
        return;
      }
    }
    setErr(null);
    createMut.mutate(status);
  }

  const audienceLabel =
    draft.audienceMode === 'LIST'
      ? `Lista filtrada: ${extra.listName ?? 'Personalizada'} (${fmtNumber(extra.audienceCount ?? 0)} contatos)`
      : `Base completa (100% · ${fmtNumber(selectedMailing?.recordCount ?? extra.audienceCount ?? 0)} contatos)`;

  const agentLabel = selectedAgent?.name ?? selectedAgent?.id ?? 'Padrão do canal';
  const channelLabel = selectedConnection
    ? `${selectedConnection.name} (${CONNECTION_CHANNEL_LABEL[selectedConnection.channelType]})`
    : selectedJourney?.name ?? '—';

  return (
    <WizardTwoColumnLayout
      left={
        <>
          {/* Identificação (Nome e Descrição) */}
          <Card
            title="Identificação da Campanha"
            tooltip="Nome exibido nos relatórios e anotações operacionais desta campanha."
          >
            <div className="space-y-4">
              <Field label="Nome da campanha" required error={err && !name.trim() ? err : undefined}>
                {(f) => (
                  <Input
                    id={f.id}
                    value={name}
                    onFocus={() => setFocus('OVERVIEW')}
                    onChange={(e) => {
                      setFocus('OVERVIEW');
                      setName(e.target.value);
                      update({ name: e.target.value });
                    }}
                    placeholder="Ex: Cobrança Novembro — Faixa 30+"
                  />
                )}
              </Field>
              <Field label="Descrição (opcional)">
                {(f) => (
                  <Textarea
                    id={f.id}
                    value={description}
                    onFocus={() => setFocus('OVERVIEW')}
                    onChange={(e) => {
                      setFocus('OVERVIEW');
                      setDescription(e.target.value);
                      update({ description: e.target.value });
                    }}
                    placeholder="Notas operacionais, objetivos ou foco da ação."
                    rows={2}
                  />
                )}
              </Field>
            </div>
          </Card>

          {/* Agendamento */}
          <Card
            title="Agendamento do Disparo"
            tooltip="Escolha entre iniciar na próxima janela válida do calendário ou programar data e hora futura."
          >
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <RadioCard
                  name="start-option"
                  value="NOW"
                  checked={startNow}
                  onChange={() => {
                    setFocus('SCHEDULE');
                    setStartNow(true);
                  }}
                  title="Iniciar imediatamente"
                  description="Entra em processamento na próxima janela válida do calendário."
                />
                <RadioCard
                  name="start-option"
                  value="SCHEDULE"
                  checked={!startNow}
                  onChange={() => {
                    setFocus('SCHEDULE');
                    setStartNow(false);
                  }}
                  title="Agendar data futura"
                  description="Aguarda a data e hora programadas."
                />
              </div>

              {!startNow && (
                <Field label="Data e hora do disparo (Horário de Brasília)" required>
                  {(f) => (
                    <Input
                      id={f.id}
                      type="datetime-local"
                      value={scheduledAt}
                      onFocus={() => setFocus('SCHEDULE')}
                      onChange={(e) => {
                        setFocus('SCHEDULE');
                        setScheduledAt(e.target.value);
                        update({}, { scheduleLocal: e.target.value });
                      }}
                      className="max-w-xs"
                    />
                  )}
                </Field>
              )}
            </div>
          </Card>

          {/* Blocos exclusivos do Modo Avançado */}
          {!isBasic && (
            <>
              <Card title="Resumo dos Pilares da Campanha">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                      <Database className="size-4 text-brand-700" />
                      1. Mailing
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {selectedMailing?.name ?? extra.mailingName ?? '—'}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Total de registros: {fmtNumber(selectedMailing?.recordCount ?? 0)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                      <Layers className="size-4 text-brand-700" />
                      2. Público
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{audienceLabel}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {draft.audienceMode === 'LIST'
                        ? 'Filtros e ordenação aplicados sobre a base.'
                        : 'Sem filtros — 100% da base elegível.'}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                      <Bot className="size-4 text-brand-700" />
                      3. Agente & Jornada
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {selectedJourney?.name ?? '—'}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">Agente: {agentLabel}</div>
                    {selectedJourney?.latestVersion && (
                      <div className="mt-1 text-xs text-slate-600">
                        <JourneySteps steps={selectedJourney.latestVersion.steps} />
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                      <SlidersHorizontal className="size-4 text-brand-700" />
                      4. Estratégia
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {selectedStrategy?.name ?? '—'}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {selectedStrategy?.latestVersion?.config ? (
                        <>
                          Até {selectedStrategy.latestVersion.config.limits.total} tentativas ·{' '}
                          {selectedStrategy.latestVersion.config.limits.daily}/dia
                        </>
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                        <CalendarDays className="size-4 text-brand-700" />
                        5. Calendário de Funcionamento
                      </div>
                      {selectedCalendar && (
                        <Badge tone={selectedCalendar.holidayPolicy === 'BLOCK' ? 'amber' : 'green'}>
                          {selectedCalendar.holidayPolicy === 'BLOCK' ? 'Bloqueia feriados' : 'Permite feriados'}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {selectedCalendar?.name ?? extra.calendarName ?? 'Padrão da estratégia'}
                    </div>
                  </div>
                </div>
              </Card>

              <VoiceReadinessCard
                journey={selectedJourney}
                showTrunksPreflight
                selectedAgent={selectedAgent}
                allConnections={allConnections}
              />

              <Card
                title="Troncos de Saída & Ritmo do Discador"
                tooltip="A quantidade de contatos enviados para discagem acompanha os canais livres multiplicados pelo fator de ritmo. Somente Gestores podem alterar."
                actions={
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={freeChannels > 0 ? 'green' : 'amber'}>
                      {freeChannels} / {totalChannels} canais livres
                    </Badge>
                    <Badge tone="brand">Cota estimada: {fmtNumber(effectiveQuota)}</Badge>
                    {!canEditDialerConfig && <Badge tone="gray">Definido pelo Gestor</Badge>}
                  </div>
                }
              >
                {trunksQ.isLoading ? (
                  <div className="text-xs text-slate-500">Consultando troncos disponíveis...</div>
                ) : (
                  <div className="space-y-4">
                    {canEditDialerConfig ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field
                          label="Troncos de saída permitidos"
                          tooltip="Sem seleção específica, a campanha utiliza todos os troncos ativos e online do workspace."
                        >
                          {() => {
                            const trunks = trunksQ.data?.trunks ?? [];
                            const allSelected = trunkIds.length === 0;
                            return (
                              <div className="space-y-2">
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFocus('DIALER');
                                      setTrunkIds([]);
                                      update({}, { trunkIds: [] });
                                    }}
                                    className={clsx(
                                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                                      allSelected
                                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                                    )}
                                  >
                                    Todos os troncos ativos ({trunks.length})
                                  </button>
                                  {trunks.map((t) => {
                                    const selected = trunkIds.includes(t.id);
                                    return (
                                      <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => {
                                          setFocus('DIALER');
                                          const next = selected
                                            ? trunkIds.filter((id) => id !== t.id)
                                            : [...trunkIds, t.id];
                                          setTrunkIds(next);
                                          update({}, { trunkIds: next });
                                        }}
                                        className={clsx(
                                          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                                          selected
                                            ? 'border-brand-600 bg-brand-50 font-medium text-brand-800'
                                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                                        )}
                                      >
                                        <span
                                          className={clsx(
                                            'size-1.5 rounded-full',
                                            t.online ? 'bg-emerald-500' : 'bg-slate-300',
                                          )}
                                        />
                                        <span>{t.name}</span>
                                        <span className="text-[11px] text-slate-500">
                                          ({t.availableChannels}/{t.maxChannels})
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                                {trunks.length === 0 && (
                                  <div className="text-xs text-slate-500">
                                    {trunksQ.data?.gatewayConfigured
                                      ? 'Nenhum tronco ativo no workspace.'
                                      : 'Gateway de voz em modo local/simulado.'}
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-[11px] text-slate-600">
                                  <span>
                                    {allSelected ? (
                                      <>
                                        Regra:{' '}
                                        <strong className="text-slate-800">Automático por Rotas de Saída</strong>
                                        {outboundRoutesSummary ? ` (${outboundRoutesSummary})` : ''}
                                      </>
                                    ) : (
                                      <>
                                        Regra:{' '}
                                        <strong className="text-brand-700">Sobrescrito na Campanha</strong> ({trunkIds.length} tronco(s))
                                      </>
                                    )}
                                  </span>
                                  <Link to="/rotas?tab=outbound" className="font-semibold text-brand-700 hover:underline whitespace-nowrap">
                                    Gerenciar Rotas →
                                  </Link>
                                </div>
                              </div>
                            );
                          }}
                        </Field>

                        <Field
                          label="Multiplicador de envio (ritmo)"
                          tooltip="Define quantos contatos podem ser enviados por canal de tronco livre (padrão 1x = 1 contato por canal disponível)."
                        >
                          {(f) => (
                            <Select
                              id={f.id}
                              value={String(dialMultiplier)}
                              onFocus={() => setFocus('DIALER')}
                              onChange={(e) => {
                                setFocus('DIALER');
                                const val = Number(e.target.value) || 1;
                                setDialMultiplier(val);
                                update({}, { dialMultiplier: val });
                              }}
                            >
                              <option value="0.5">0,5x (Conservador — metade dos canais livres)</option>
                              <option value="1">1,0x (Padrão 1:1 — exatamente 1 contato por canal)</option>
                              <option value="1.5">1,5x (Moderado)</option>
                              <option value="2">2,0x (Preditivo 2:1)</option>
                              <option value="3">3,0x (Agressivo 3:1)</option>
                              <option value="4">4,0x (Intensivo 4:1)</option>
                              <option value="5">5,0x (Máximo 5:1)</option>
                            </Select>
                          )}
                        </Field>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                        <Badge tone="gray">Troncos: Todos os troncos ativos ({trunksQ.data?.trunks.length ?? 0})</Badge>
                        <Badge tone="gray">Multiplicador: 1,0x (padrão)</Badge>
                        <InfoTooltip content="A quantidade de troncos e o multiplicador são gerenciados exclusivamente pelo Gestor." />
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}

          {err && <Alert tone="error">{err}</Alert>}

          {saveAsTemplateOpen && !isBasic && (
            <SaveAsTemplateModal
              open={saveAsTemplateOpen}
              onClose={() => setSaveAsTemplateOpen(false)}
              initialName={name ? `Modelo - ${name}` : undefined}
              initialDescription={description}
              directData={{
                journeyId: selectedJourney?.id || draft.journeyVersionId || undefined,
                journeyVersionId: draft.journeyVersionId ?? undefined,
                journeyName: selectedJourney?.name,
                strategyId: selectedStrategy?.id || draft.strategyVersionId || undefined,
                strategyVersionId: draft.strategyVersionId ?? undefined,
                strategyName: selectedStrategy?.name,
                purposeCode: (extra.purposeCode as OperationPurpose) ?? 'COBRANCA',
                startMode: startNow ? 'NOW' : 'SCHEDULE',
              }}
              onSaved={(tmpl) => {
                update({}, { templateApplied: tmpl.id, templateName: tmpl.name });
              }}
            />
          )}
        </>
      }
      right={
        <ReviewRightInspector
          isBasic={isBasic}
          focus={focus}
          onChangeFocus={setFocus}
          name={name}
          description={description}
          startNow={startNow}
          scheduledAt={scheduledAt}
          mailingName={selectedMailing?.name ?? extra.mailingName}
          audienceLabel={audienceLabel}
          agentLabel={agentLabel}
          channelLabel={channelLabel}
          calendarName={selectedCalendar?.name ?? extra.calendarName}
          trunksData={trunksQ.data}
          trunkIds={trunkIds}
          outboundRoutesSummary={outboundRoutesSummary}
          dialMultiplier={dialMultiplier}
          effectiveQuota={effectiveQuota}
        />
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft className="size-4 mr-1" /> Voltar para acionamento
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            {!isBasic && (
              <Button
                variant="secondary"
                onClick={() => setSaveAsTemplateOpen(true)}
                icon={<Bookmark className="size-3.5 text-brand-700" />}
                title="Salvar jornada, estratégia e acionamento desta campanha como modelo reutilizável"
              >
                Salvar como modelo
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => handleSubmit('DRAFT')}
              disabled={createMut.isPending}
              loading={createMut.isPending && createMut.variables === 'DRAFT'}
            >
              <Save className="size-4 mr-1" /> Salvar como rascunho
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmit(startNow ? 'RUNNING' : 'SCHEDULED')}
              disabled={createMut.isPending}
              loading={createMut.isPending && createMut.variables !== 'DRAFT'}
            >
              <Rocket className="size-4 mr-1" /> {startNow ? 'Criar e iniciar campanha' : 'Criar e agendar campanha'}
            </Button>
          </div>
        </div>
      }
    />
  );
}

export function WizardReturnBanner() {
  return (
    <Alert tone="info" className="mb-4" title="Você veio do assistente de campanha">
      Crie uma cópia, publique a versão ajustada e volte para escolher a estratégia na campanha.{' '}
      <Link to="/campanhas/nova" className="font-medium text-brand-800 underline">
        Voltar à criação de campanha
      </Link>
    </Alert>
  );
}

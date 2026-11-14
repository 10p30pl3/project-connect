import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  Filter,
  Layers,
  ListFilter,
  Loader2,
  Megaphone,
  Pencil,
  PhoneCall,
  Plus,
  Rocket,
  Save,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import {
  CHANNEL_LABEL,
  type CampaignDraft,
  type ChannelType,
  type OperationPurpose,
} from '@voll/shared';
import type {
  Campaign,
  CampaignTemplate,
  Journey,
  ListSummary,
  MailingSummary,
  Preflight,
  Strategy,
  Tabulation,
} from '../lib/types';
import {
  fmtDateTime,
  fmtMoney,
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
import { useAuth } from '../lib/auth';

type Step = CampaignDraft['step'];
const STEPS: { id: Step; label: string; num: number }[] = [
  { id: 'MAILING', label: 'Mailing', num: 1 },
  { id: 'AUDIENCE', label: 'Público (filtro)', num: 2 },
  { id: 'ACTIVATION', label: 'Acionamento', num: 3 },
  { id: 'CAMPAIGN', label: 'Revisar e finalizar', num: 4 },
];

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
};

const EMPTY: CampaignDraft = { step: 'MAILING', extra: {} };

type DraftEnvelope = { draft: CampaignDraft; revision: number; savedAt: string };
type UpdateFn = (patch: Partial<CampaignDraft>, extraPatch?: Partial<Extra>) => void;

export function NewCampaignPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp] = useSearchParams();
  const modeloId = sp.get('modeloId');
  const listaId = sp.get('lista');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const listaAppliedRef = useRef(false);

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
        setDraft(draftQ.data.draft);
        setRevision(draftQ.data.revision);
        if (draftQ.data.savedAt) {
          const d = new Date(draftQ.data.savedAt);
          if (!isNaN(d.getTime())) setSavedAt(d);
        }
      } else {
        setDraft({ ...EMPTY });
      }
    }
  }, [draftQ.data, draft]);

  const saveMut = useMutation({
    mutationFn: (d: CampaignDraft) =>
      put<DraftEnvelope>('/campaign-draft', { draft: d, clientRevision: revRef.current }),
    onSuccess: (data) => {
      setRevision(data.revision);
      setSavedAt(new Date(data.savedAt));
      setSaveState('idle');
      dirtyRef.current = false;
      qc.setQueryData(['campaign-draft'], data);
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
        step: 'AUDIENCE',
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
  }, [listaId, listsQ.data, draft, update, toast]);

  const journeysQ = useQuery({
    queryKey: ['journeys'],
    queryFn: () => get<{ items: Journey[] }>('/journeys'),
  });

  const strategiesQ = useQuery({
    queryKey: ['strategies'],
    queryFn: () => get<{ items: Strategy[] }>('/strategies'),
  });

  const tabulationsQ = useQuery({
    queryKey: ['tabulations'],
    queryFn: () => get<{ items: Tabulation[] }>('/tabulations'),
  });

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

  const curIdx = STEPS.findIndex((s) => s.id === currentStep);

  const goStep = (target: Step) => {
    const tIdx = STEPS.findIndex((s) => s.id === target);
    if (tIdx > 0 && !draft?.mailingId) {
      toast('info', 'Importe ou selecione um mailing antes de avançar.');
      return;
    }
    if (tIdx > 2 && (!draft?.journeyVersionId || !draft?.strategyVersionId)) {
      toast('info', 'Selecione uma jornada e uma estratégia antes de avançar.');
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
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Nova campanha"
        subtitle="Configuração 100% manual em 4 pilares: Mailing, Público (filtro), Jornadas e Estratégias."
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
            <Link to="/campanhas/modelos">
              <Button size="sm" variant="secondary" icon={<Bookmark className="size-3.5" />}>
                Modelos de campanhas
              </Button>
            </Link>
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
      {(draft.extra?.templateName || templateQ.data) && (
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

      {/* Stepper Superior (1. Mailing → 2. Público → 3. Acionamento → 4. Revisar) */}
      <nav aria-label="Progresso da criação" className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
        <ol className="flex items-center justify-between gap-2 overflow-x-auto">
          {STEPS.map((s, idx) => {
            const isActive = s.id === currentStep;
            const isCompleted = idx < curIdx;
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
                {idx < STEPS.length - 1 && <span className="text-slate-300 font-light select-none">/</span>}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Conteúdo do Passo Ativo */}
      <div className="space-y-6">
        {currentStep === 'MAILING' && (
          <MailingStep
            draft={draft}
            extra={extra}
            mailings={mailingsQ.data?.items}
            update={update}
            onNext={() => goStep('AUDIENCE')}
          />
        )}

        {currentStep === 'AUDIENCE' && (
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
            draft={draft}
            extra={extra}
            journeys={journeysQ.data?.items}
            strategies={strategiesQ.data?.items}
            selectedJourney={selectedJourney}
            selectedStrategy={selectedStrategy}
            update={update}
            onBack={() => goStep('AUDIENCE')}
            onNext={() => goStep('CAMPAIGN')}
          />
        )}

        {currentStep === 'CAMPAIGN' && (
          <ReviewStep
            draft={draft}
            extra={extra}
            selectedMailing={selectedMailing}
            selectedJourney={selectedJourney}
            selectedStrategy={selectedStrategy}
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
  draft,
  extra,
  mailings,
  update,
  onNext,
}: {
  draft: CampaignDraft;
  extra: Extra;
  mailings?: MailingSummary[];
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
        ...(andGoNext && mailingId ? { step: 'AUDIENCE' } : {}),
      },
      { mailingSource: source, mailingName: name, audienceCount: null },
    );
  };

  return (
    <div className="space-y-4">
      {/* Banner de atalho para modelos */}
      <div className="flex items-center justify-between rounded-xl border border-brand-100 bg-brand-50/40 px-3.5 py-2 text-xs text-brand-900">
        <span className="flex items-center gap-2">
          <Bookmark className="size-3.5 text-brand-700 shrink-0" />
          <span>Quer agilizar? Você pode carregar um modelo pré-configurado de jornada e estratégia.</span>
        </span>
        <Link to="/campanhas/modelos" className="font-semibold text-brand-700 hover:text-brand-900 hover:underline shrink-0">
          Explorar modelos →
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <RadioCard
          name="mailing-source"
          value="IMPORT"
          checked={source === 'IMPORT'}
          onChange={() => update({}, { mailingSource: 'IMPORT' })}
          title="Importar novo mailing"
          description="Envie um arquivo CSV ou cole linhas com detecção automática de colunas."
        />
        <RadioCard
          name="mailing-source"
          value="MAILING"
          checked={source === 'MAILING'}
          onChange={() => update({}, { mailingSource: 'MAILING' })}
          title="Selecionar mailing existente"
          description="Reutilize um mailing já importado na sua conta com seus contatos e metadados."
        />
      </div>

      {source === 'IMPORT' && (
        <Card title="Importar arquivo ou colar dados de mailing">
          {draft.mailingId && extra.mailingName ? (
            <div className="space-y-3">
              <Alert tone="success" title={`Mailing "${extra.mailingName}" importado com sucesso!`}>
                O arquivo foi validado e vinculado a esta campanha. Você pode continuar para o público ou importar outro arquivo.
              </Alert>
              <div className="flex gap-2">
                <Button variant="primary" onClick={onNext}>
                  Continuar para público (filtro)
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
        <Card title="Escolha um mailing da base">
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
                  <Button variant="primary" onClick={onNext}>
                    Continuar para público (filtro) <ArrowRight className="size-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
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
    // Se o usuário não adicionou nenhum filtro, avança com a base total em 1 clique
    if (!hasCustomFilters && !draft.sourceListVersionId) {
      update(
        { audienceMode: 'ALL', listVersionId: null },
        { audienceCount: mailing?.recordCount ?? null },
      );
      onNext();
      return;
    }

    // Se adicionou filtros ou ordenação, publica a lista filtrada
    setBusy(true);
    const ok = await publishRef.current?.();
    setBusy(false);
    if (ok) {
      update({ audienceMode: 'LIST' });
      onNext();
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de resumo do mailing selecionado */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-2xs">
        <div className="flex items-center gap-3">
          <Database className="size-5 text-brand-700 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Mailing selecionado: <span className="text-brand-900">{mailing?.name ?? extra.mailingName ?? '—'}</span>
            </div>
            <div className="text-xs text-slate-500">
              {mailing?.recordCount !== undefined ? (
                <>
                  <strong>{fmtNumber(mailing.recordCount)} contatos</strong> na base.{' '}
                  {hasCustomFilters
                    ? 'Filtros personalizados ativos abaixo.'
                    : 'Todos os contatos selecionados por padrão.'}
                </>
              ) : (
                'Carregando registros da base…'
              )}
            </div>
          </div>
        </div>

        <Badge tone={hasCustomFilters ? 'brand' : 'green'}>
          {hasCustomFilters ? 'Filtro personalizado ativo' : 'Base completa (100%)'}
        </Badge>
      </div>

      {/* Seletor rápido de listas já publicadas para este mailing */}
      {draft.mailingId && savedListsForMailing.length > 0 && (
        <Card
          title="Listas já salvas neste mailing (opcional)"
          tooltip="Selecione uma lista já segmentada para reutilizá-la diretamente ou continue usando os filtros personalizados abaixo."
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

      {/* Editor direto de filtros e ordenação */}
      {draft.mailingId && (
        <Card
          title="Filtros e Segmentação do Mailing"
          tooltip="Se desejar acionar toda a base sem restrições, basta clicar em Continuar sem adicionar filtros."
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

      {/* Rodapé de navegação */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" /> Voltar para mailing
        </Button>
        <Button variant="primary" onClick={handleNext} disabled={busy} loading={busy}>
          {hasCustomFilters ? 'Salvar filtro e ir para acionamento' : 'Continuar com todos os contatos'}{' '}
          <ArrowRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ==================================================================
// ETAPA 3: ACIONAMENTO (JORNADAS E ESTRATÉGIAS)
// ==================================================================
function ActivationStep({
  draft,
  journeys,
  strategies,
  selectedJourney,
  selectedStrategy,
  update,
  onBack,
  onNext,
}: {
  draft: CampaignDraft;
  extra: Extra;
  journeys?: Journey[];
  strategies?: Strategy[];
  selectedJourney?: Journey;
  selectedStrategy?: Strategy;
  update: UpdateFn;
  onBack: () => void;
  onNext: () => void;
}) {
  const [journeyTab, setJourneyTab] = useState<'SIMPLE' | 'MULTI'>('SIMPLE');
  const [strategyTab, setStrategyTab] = useState<'SIMPLE' | 'COMPLETE'>('SIMPLE');
  const [showStrategyDetails, setShowStrategyDetails] = useState(false);
  const [err, setErr] = useState<{ journey?: string; strategy?: string }>({});

  // Auto-seleciona defaults se nenhum tiver sido escolhido
  useEffect(() => {
    if (!draft.journeyVersionId && journeys && journeys.length > 0) {
      const defJ =
        journeys.find((j) => j.latestVersion?.steps.some((s) => s.channelType === 'VOICE')) ??
        journeys.find((j) => j.name.includes('WhatsApp')) ??
        journeys[0];
      if (defJ.latestVersion) update({ journeyVersionId: defJ.latestVersion.id });
    }
    if (!draft.strategyVersionId && strategies && strategies.length > 0) {
      const defS = strategies.find((s) => s.name.includes('Simples') || s.name.includes('24x7')) ?? strategies[0];
      if (defS.latestVersion) update({ strategyVersionId: defS.latestVersion.id });
    }
  }, [draft.journeyVersionId, draft.strategyVersionId, journeys, strategies, update]);

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
    () => strategies?.filter((s) => s.name.toLowerCase().includes('simples') || (s.latestVersion?.config.limits.total ?? 0) <= 6) ?? [],
    [strategies],
  );
  const completeStrategies = useMemo(
    () => strategies?.filter((s) => !s.name.toLowerCase().includes('simples') && (s.latestVersion?.config.limits.total ?? 0) > 6) ?? [],
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

  function handleNext() {
    const errors: typeof err = {};
    if (!draft.journeyVersionId) errors.journey = 'Selecione uma jornada para os disparos.';
    if (!draft.strategyVersionId) errors.strategy = 'Selecione uma estratégia com janelas e limites.';
    setErr(errors);
    if (Object.keys(errors).length === 0) onNext();
  }

  const stratCfg = selectedStrategy?.latestVersion?.config;

  return (
    <div className="space-y-6">
      {/* SEÇÃO 1: JORNADAS */}
      <Card
        title="1. Selecione a Jornada de Canais"
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
        {/* Abas Simples vs Multicanal */}
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
          <button
            type="button"
            onClick={() => setJourneyTab('SIMPLE')}
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
            onClick={() => setJourneyTab('MULTI')}
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

        {/* Lista de Jornadas da Aba */}
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
                  setErr((prev) => ({ ...prev, journey: undefined }));
                  update({ journeyVersionId: v.id });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
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

      {/* SEÇÃO 2: ESTRATÉGIAS */}
      <Card
        title="2. Selecione a Estratégia de Disparo"
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
        {/* Abas Simples vs Completas */}
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
          <button
            type="button"
            onClick={() => setStrategyTab('SIMPLE')}
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
            onClick={() => setStrategyTab('COMPLETE')}
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

        {/* Lista de Estratégias */}
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
                  setErr((prev) => ({ ...prev, strategy: undefined }));
                  update({ strategyVersionId: v.id });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
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

        {/* Painel Expansível de Detalhes da Estratégia Selecionada */}
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
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
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

      {/* Integração de Voz IA (Telefonia como fonte única) */}
      <VoiceReadinessCard journey={selectedJourney} showTrunksPreflight={false} />

      {/* Rodapé de navegação */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" /> Voltar para público
        </Button>
        <Button variant="primary" onClick={handleNext}>
          Continuar para revisar e finalizar <ArrowRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function VoiceReadinessCard({
  journey,
  showTrunksPreflight,
}: {
  journey?: Journey;
  showTrunksPreflight: boolean;
}) {
  const hasVoice = Boolean(journey?.latestVersion?.steps.some((s) => s.channelType === 'VOICE'));

  const connsQ = useQuery({
    queryKey: ['connections'],
    queryFn: () =>
      get<{
        items: Array<{
          id: string;
          channelType: string;
          name: string;
          status?: string;
          config?: Record<string, unknown>;
        }>;
      }>('/connections'),
    enabled: hasVoice,
  });

  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () =>
      get<{
        tenants: Array<{
          id: string;
          name: string;
          stsEngine?: string;
          openaiModel?: string;
          elevenlabsModel?: string;
          elevenlabsVoiceId?: string;
        }>;
      }>('/telephony/tenants'),
    enabled: hasVoice,
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
      get<{ trunks: Array<{ id: string; name?: string; active?: boolean }> }>('/telephony/trunks'),
    enabled: hasVoice && showTrunksPreflight,
    retry: false,
  });

  if (!hasVoice) return null;

  const voiceConn =
    connsQ.data?.items.find((c) => c.channelType === 'VOICE_APP' && c.status === 'ACTIVE') ??
    connsQ.data?.items.find((c) => c.channelType === 'VOICE_APP');
  const boundTenantId =
    voiceConn?.config && typeof voiceConn.config.tenantId === 'string'
      ? voiceConn.config.tenantId
      : '';
  const boundTenant = tenantsQ.data?.tenants.find((t) => t.id === boundTenantId);

  const activeTrunks = (trunksQ.data?.trunks ?? []).filter((t) => t.active !== false);
  const gatewayOffline =
    showTrunksPreflight &&
    (statusQ.isError || (statusQ.data !== undefined && statusQ.data.status !== 'ok'));
  const noActiveTrunk = showTrunksPreflight && trunksQ.isSuccess && activeTrunks.length === 0;

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
        {boundTenant ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
            <div>
              <span className="font-semibold text-emerald-950">
                Agente Vinculado ({voiceConn?.name ?? 'Canal Voz'}): {boundTenant.name}
              </span>
              <span className="ml-2 font-mono text-[11px] text-emerald-800">
                {[
                  boundTenant.stsEngine,
                  boundTenant.stsEngine === 'elevenlabs'
                    ? boundTenant.elevenlabsModel
                    : boundTenant.openaiModel,
                  boundTenant.stsEngine === 'elevenlabs' ? boundTenant.elevenlabsVoiceId : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <Badge tone="green">Pronto (Fonte: Telefonia)</Badge>
          </div>
        ) : (
          <Alert tone="warn" title="Nenhum Agente IA vinculado ao canal Voice-App">
            Vincule um agente de Telefonia em{' '}
            <Link to="/canais" className="font-semibold underline">
              Canais
            </Link>{' '}
            ou configure um agente em{' '}
            <Link to="/agentes-de-voz" className="font-semibold underline">
              Agentes de Voz
            </Link>{' '}
            antes de iniciar disparos de voz.
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
            ) : trunksQ.isSuccess ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                <span>
                  Gateway online · <strong>{activeTrunks.length}</strong> tronco(s) SIP ativo(s) prontos para discagem
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
// ETAPA 4: REVISAR E FINALIZAR
// ==================================================================
function ReviewStep({
  draft,
  extra,
  selectedMailing,
  selectedJourney,
  selectedStrategy,
  update,
  onBack,
  onDone,
}: {
  draft: CampaignDraft;
  extra: Extra;
  selectedMailing?: MailingSummary;
  selectedJourney?: Journey;
  selectedStrategy?: Strategy;
  update: UpdateFn;
  onBack: () => void;
  onDone: (c: Campaign) => void;
}) {
  const [name, setName] = useState(draft.name ?? `Campanha ${new Date().toLocaleDateString('pt-BR')}`);
  const [description, setDescription] = useState(draft.description ?? '');
  const [startNow, setStartNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState(extra.scheduleLocal ?? nowSaoPauloLocal(60));
  const [err, setErr] = useState<string | null>(null);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);

  const createMut = useMutation({
    mutationFn: (status: 'RUNNING' | 'DRAFT' | 'SCHEDULED') =>
      post<Campaign>('/campaigns', {
        name: name.trim(),
        description: description.trim() || undefined,
        mailingId: draft.mailingId,
        listVersionId: draft.audienceMode === 'LIST' ? draft.listVersionId : null,
        journeyVersionId: draft.journeyVersionId,
        strategyVersionId: draft.strategyVersionId,
        status,
        scheduledAt: status === 'SCHEDULED' ? saoPauloLocalToIso(scheduledAt) : null,
      }),
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
      : `Base total: ${fmtNumber(selectedMailing?.recordCount ?? extra.audienceCount ?? 0)} contatos`;

  return (
    <div className="space-y-6">
      {/* Dados Principais da Campanha */}
      <Card title="Identificação da Campanha">
        <div className="space-y-4">
          <Field label="Nome da campanha" required error={err && !name.trim() ? err : undefined}>
            {(f) => (
              <Input
                id={f.id}
                value={name}
                onChange={(e) => {
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
                onChange={(e) => {
                  setDescription(e.target.value);
                  update({ description: e.target.value });
                }}
                placeholder="Notas operacionais, objetivos de recuperação ou foco da ação."
                rows={2}
              />
            )}
          </Field>
        </div>
      </Card>

      {/* Resumo Visual dos 4 Pilares Manuais */}
      <Card title="Resumo dos 4 Pilares da Campanha">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Pilar 1: Mailing */}
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

          {/* Pilar 2: Público (filtro) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Filter className="size-4 text-brand-700" />
              2. Público (filtro)
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900">{audienceLabel}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {draft.audienceMode === 'LIST'
                ? 'Filtros e ordenação aplicados sobre a base.'
                : 'Sem filtros — 100% da base elegível.'}
            </div>
          </div>

          {/* Pilar 3: Jornada */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Layers className="size-4 text-brand-700" />
              3. Jornada
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900">
              {selectedJourney?.name ?? '—'}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {selectedJourney?.latestVersion ? (
                <JourneySteps steps={selectedJourney.latestVersion.steps} />
              ) : (
                '—'
              )}
            </div>
          </div>

          {/* Pilar 4: Estratégia */}
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
                  Horário: {selectedStrategy.latestVersion.config.calendar.start}–
                  {selectedStrategy.latestVersion.config.calendar.end} · Até{' '}
                  {selectedStrategy.latestVersion.config.limits.total} tentativas
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Preflight de Voz IA & Troncos */}
      <VoiceReadinessCard journey={selectedJourney} showTrunksPreflight />

      {/* Quando Iniciar */}
      <Card title="Agendamento do Disparo">
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <RadioCard
              name="start-option"
              value="NOW"
              checked={startNow}
              onChange={() => setStartNow(true)}
              title="Iniciar imediatamente"
              description="A campanha entra em processamento na próxima janela válida do calendário."
            />
            <RadioCard
              name="start-option"
              value="SCHEDULE"
              checked={!startNow}
              onChange={() => setStartNow(false)}
              title="Agendar data futura"
              description="A campanha fica aguardando a data e hora programadas."
            />
          </div>

          {!startNow && (
            <Field label="Data e hora do disparo (Horário de Brasília)" required>
              {(f) => (
                <Input
                  id={f.id}
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => {
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

      {err && <Alert tone="error">{err}</Alert>}

      {/* Ações Finais */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" /> Voltar para acionamento
        </Button>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => setSaveAsTemplateOpen(true)}
            icon={<Bookmark className="size-3.5 text-brand-700" />}
            title="Salvar jornada, estratégia e acionamento desta campanha como modelo reutilizável"
          >
            Salvar como modelo
          </Button>
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

      {saveAsTemplateOpen && (
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
    </div>
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

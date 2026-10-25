import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Database,
  FlaskConical,
  Pencil,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import {
  CETIC_AGE_BRACKET_LABEL,
  CHANNEL_LABEL,
  OPERATING_MODE_LABEL,
  OPERATION_PURPOSE_LABEL,
  OPERATION_PURPOSES,
  type CampaignDraft,
  type ChannelType,
  type OperatingMode,
  type OperationPurpose,
} from '@voll/shared';
import { ApiError, del, errorMessage, get, newIdempotencyKey, post, put } from '../lib/api';
import type {
  Campaign,
  DraftEnvelope,
  Journey,
  ListPublishResult,
  ListSummary,
  MailingSummary,
  Preflight,
  Strategy,
  Tabulation,
} from '../lib/types';
import { fmtDateTime, fmtMoney, fmtNumber, nowSaoPauloLocal, saoPauloLocalToIso } from '../lib/format';
import {
  Alert,
  Badge,
  btnClass,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  Modal,
  RadioCard,
  Select,
  Stat,
  TableWrap,
  Textarea,
  useToast,
} from '../components/ui';
import { ImportFlow } from '../components/ImportFlow';
import { ListEditor, type ListEditorState } from '../components/ListEditor';
import { JourneySteps, StrategySummary } from '../components/Summaries';
import { useAuth } from '../lib/auth';

type Step = CampaignDraft['step'];
const STEPS: { key: Step; label: string }[] = [
  { key: 'MAILING', label: 'Mailing' },
  { key: 'AUDIENCE', label: 'Público' },
  { key: 'ACTIVATION', label: 'Inteligência' },
  { key: 'CAMPAIGN', label: 'Revisar e finalizar' },
];

type MailingSource = 'IMPORT' | 'MAILING' | 'LIST';
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
  intelligenceMode?: 'INTELLIGENT' | 'MANUAL';
  operatingMode?: OperatingMode;
  purposeCode?: OperationPurpose;
  purposePrompt?: string;
  maxAcceptableCpcBrl?: number;
  labSamplePct?: number;
  intelligenceRunId?: string;
};

const EMPTY: CampaignDraft = { step: 'MAILING', extra: {} };

export function NewCampaignPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const draftQ = useQuery({ queryKey: ['campaign-draft'], queryFn: () => get<DraftEnvelope>('/campaign-draft'), staleTime: Infinity, gcTime: 0 });
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error' | 'conflict'>('idle');
  const [resumed, setResumed] = useState(false);
  const [finished, setFinished] = useState(false);
  const dirtyRef = useRef(false);
  const revRef = useRef(0);
  revRef.current = revision;

  useEffect(() => {
    if (draftQ.data !== undefined && draft === null) {
      if (draftQ.data) {
        setDraft(draftQ.data.data);
        setRevision(draftQ.data.revision);
        setSavedAt(new Date(draftQ.data.updatedAt));
        setResumed(true);
      } else setDraft(EMPTY);
    }
  }, [draftQ.data, draft]);

  const extra = (draft?.extra ?? {}) as Extra;
  const update = useCallback((patch: Partial<CampaignDraft>, extraPatch?: Partial<Extra>) => {
    dirtyRef.current = true;
    setDraft((d) => {
      const base = d ?? EMPTY;
      return { ...base, ...patch, extra: { ...(base.extra ?? {}), ...(extraPatch ?? {}) } };
    });
  }, []);

  // ---------------------------------------------------------- autosave (§26.1)
  const save = useCallback(async (d: CampaignDraft) => {
    setSaveState('saving');
    try {
      const r = await put<{ revision: number; updatedAt: string }>('/campaign-draft', { data: d, revision: revRef.current });
      setRevision(r.revision);
      revRef.current = r.revision;
      setSavedAt(new Date(r.updatedAt));
      setSaveState('idle');
      dirtyRef.current = false;
      return true;
    } catch (e) {
      setSaveState(e instanceof ApiError && e.status === 409 ? 'conflict' : 'error');
      return false;
    }
  }, []);
  useEffect(() => {
    if (!draft || !dirtyRef.current || finished || saveState === 'conflict') return;
    const t = setTimeout(() => save(draft), 700);
    return () => clearTimeout(t);
  }, [draft, save, finished, saveState]);

  async function reloadDraft() {
    const r = await get<DraftEnvelope>('/campaign-draft');
    dirtyRef.current = false;
    setDraft(r?.data ?? EMPTY);
    setRevision(r?.revision ?? 0);
    setSaveState('idle');
  }

  // ---------------------------------------------------------- catálogos
  const mailingsQ = useQuery({ queryKey: ['mailings'], queryFn: () => get<{ items: MailingSummary[] }>('/mailings') });
  const listsQ = useQuery({ queryKey: ['lists'], queryFn: () => get<{ items: ListSummary[] }>('/lists') });
  const journeysQ = useQuery({ queryKey: ['journeys'], queryFn: () => get<{ items: Journey[] }>('/journeys') });
  const strategiesQ = useQuery({ queryKey: ['strategies'], queryFn: () => get<{ items: Strategy[] }>('/strategies') });
  const tabsQ = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });

  const mailing = mailingsQ.data?.items.find((m) => m.id === draft?.mailingId);
  const journey = journeysQ.data?.items.find((j) => j.latestVersion?.id === draft?.journeyVersionId);
  const strategy = strategiesQ.data?.items.find((s) => s.latestVersion?.id === draft?.strategyVersionId);
  // versão selecionada pode não ser a mais recente (rascunho antigo): mostra aviso
  const strategyMissing = !!draft?.strategyVersionId && strategiesQ.data && !strategy;
  const journeyMissing = !!draft?.journeyVersionId && journeysQ.data && !journey;

  // ---------------------------------------------------------- validação por etapa
  const valid: Record<Step, boolean> = {
    MAILING: !!draft?.mailingId,
    AUDIENCE: draft?.audienceMode === 'ALL' || (draft?.audienceMode === 'LIST' && !!draft?.listVersionId),
    ACTIVATION: !!draft?.journeyVersionId && !!draft?.strategyVersionId && !strategyMissing && !journeyMissing,
    CAMPAIGN: true,
  };
  const stepIdx = STEPS.findIndex((s) => s.key === (draft?.step ?? 'MAILING'));
  const reachable = (i: number) => STEPS.slice(0, i).every((s) => valid[s.key]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const goStep = (s: Step) => {
    update({ step: s });
    setTimeout(() => headingRef.current?.focus(), 0);
  };

  // ---------------------------------------------------------- saída protegida
  const hasContent = !!draft && (draft.mailingId || draft.name || draft.step !== 'MAILING');
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !finished && !!hasContent && currentLocation.pathname !== nextLocation.pathname);
  const [discardConfirm, setDiscardConfirm] = useState(false);

  async function saveAndExit() {
    if (draft) await save(draft);
    if (blocker.state === 'blocked') blocker.proceed();
    else {
      setFinished(true);
      setTimeout(() => nav('/campanhas'));
    }
  }
  async function discard() {
    await del('/campaign-draft').catch(() => {});
    qc.removeQueries({ queryKey: ['campaign-draft'] });
    setFinished(true);
    if (blocker.state === 'blocked') blocker.proceed();
    else setTimeout(() => nav('/campanhas'));
  }
  async function startOver() {
    await del('/campaign-draft').catch(() => {});
    dirtyRef.current = false;
    setDraft(EMPTY);
    setRevision(0);
    setResumed(false);
    setDiscardConfirm(false);
  }

  if (!can('campaigns.create'))
    return <Empty title="Seu perfil não pode criar campanhas">Peça a um gestor ou administrador.</Empty>;
  if (draftQ.isLoading || !draft) return <Loading rows={6} />;

  const audienceCount =
    draft.audienceMode === 'ALL' ? (mailing?.recordCount ?? null) : draft.audienceMode === 'LIST' ? (extra.audienceCount ?? null) : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Preparar campanha</h1>
          <p className="text-sm text-slate-600">A campanha só é criada na confirmação final.</p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} savedAt={savedAt} />
          <Button icon={<Save className="size-4" aria-hidden />} onClick={saveAndExit}>
            Salvar e sair
          </Button>
        </div>
      </div>

      {saveState === 'conflict' && (
        <Alert tone="warn" title="O rascunho foi alterado em outra aba ou dispositivo" className="mb-4">
          Para não sobrescrever a outra alteração, recarregue o rascunho mais recente.{' '}
          <Button variant="link" onClick={reloadDraft}>
            Recarregar rascunho
          </Button>
        </Alert>
      )}
      {resumed && (
        <Alert tone="info" title="Retomamos seu rascunho" className="mb-4">
          Você está na etapa {STEPS[stepIdx]?.label}. Revise as seleções: mailings, listas e estratégias podem ter mudado desde então.{' '}
          <Button variant="link" onClick={() => setDiscardConfirm(true)}>
            Começar outra
          </Button>
        </Alert>
      )}

      {/* Stepper */}
      <nav aria-label="Etapas da preparação" className="mb-5">
        <ol className="grid grid-cols-4 gap-1 sm:gap-2">
          {STEPS.map((s, i) => {
            const current = i === stepIdx;
            const done = i < stepIdx && valid[s.key];
            const enabled = reachable(i);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={!enabled}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => goStep(s.key)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs sm:text-sm',
                    current && 'border-brand-600 bg-brand-50 font-semibold text-brand-900',
                    !current && enabled && 'border-slate-200 bg-white hover:border-brand-300',
                    !enabled && 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400',
                  )}
                >
                  <span
                    className={clsx(
                      'grid size-6 shrink-0 place-items-center rounded-full text-xs',
                      current ? 'bg-brand-700 text-white' : done ? 'bg-brand-100 text-brand-800' : 'bg-slate-200 text-slate-600',
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="truncate">{s.label}</span>
                  {done && <span className="sr-only">(concluída)</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="mb-3 text-lg font-semibold focus:outline-none" aria-live="polite">
            Etapa {stepIdx + 1} de 4: {STEPS[stepIdx]?.label}
          </h2>

          {draft.step === 'MAILING' && (
            <MailingStep
              draft={draft}
              extra={extra}
              mailings={mailingsQ.data?.items}
              lists={listsQ.data?.items}
              update={update}
              onNext={() => goStep('AUDIENCE')}
            />
          )}
          {draft.step === 'AUDIENCE' && draft.mailingId && (
            <AudienceStep draft={draft} extra={extra} mailing={mailing} update={update} onBack={() => goStep('MAILING')} onNext={() => goStep('ACTIVATION')} />
          )}
          {draft.step === 'ACTIVATION' && (
            <ActivationStep
              draft={draft}
              extra={extra}
              mailing={mailing}
              journeys={journeysQ.data?.items}
              strategies={strategiesQ.data?.items}
              tabulations={tabsQ.data?.items}
              strategyMissing={!!strategyMissing}
              journeyMissing={!!journeyMissing}
              update={update}
              onBack={() => goStep('AUDIENCE')}
              onNext={() => goStep('CAMPAIGN')}
              beforeLeave={async () => {
                await save(draft);
                setFinished(true);
              }}
            />
          )}
          {draft.step === 'CAMPAIGN' && (
            <CampaignStep
              draft={draft}
              extra={extra}
              update={update}
              goStep={goStep}
              onCreated={async (c) => {
                setFinished(true);
                await del('/campaign-draft').catch(() => {});
                qc.removeQueries({ queryKey: ['campaign-draft'] });
                qc.invalidateQueries({ queryKey: ['campaigns'] });
                toast('success', `Campanha "${c.name}" criada.`);
                setTimeout(() => nav(`/campanhas/${c.id}`));
              }}
            />
          )}
        </div>

        {/* Resumo lateral */}
        <aside aria-label="Resumo da preparação" className="lg:sticky lg:top-20 lg:self-start">
          <Card title="Resumo">
            <dl className="space-y-3 text-sm">
              <SummaryItem label="Mailing" value={mailing?.name ?? extra.mailingName ?? null} />
              <SummaryItem
                label="Público"
                value={
                  draft.audienceMode === 'ALL'
                    ? 'Todos os contatos do mailing'
                    : draft.audienceMode === 'LIST'
                      ? `${extra.listName ?? 'Lista'}${extra.listVersion ? ` · v${extra.listVersion}` : ''}`
                      : null
                }
              />
              <SummaryItem label="Contatos na prévia" value={audienceCount !== null ? fmtNumber(audienceCount) : null} />
              <SummaryItem label="Jornada" value={journey ? `${journey.name} · v${journey.latestVersion?.version}` : null} />
              <SummaryItem label="Estratégia" value={strategy ? `${strategy.name} · v${strategy.latestVersion?.version}` : null} />
            </dl>
          </Card>
        </aside>
      </div>

      <Modal
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Sair da preparação?"
        description="O rascunho é salvo automaticamente. Escolha o que fazer com ele."
        footer={
          <>
            <Button variant="danger" onClick={discard}>
              Descartar
            </Button>
            <Button onClick={saveAndExit}>Salvar rascunho e sair</Button>
            <Button variant="primary" onClick={() => blocker.state === 'blocked' && blocker.reset()}>
              Continuar editando
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">Descartar remove apenas o rascunho. Mailings importados e listas publicadas continuam disponíveis.</p>
      </Modal>
      <Modal
        open={discardConfirm}
        onOpenChange={setDiscardConfirm}
        title="Começar outra preparação?"
        footer={
          <>
            <Button onClick={() => setDiscardConfirm(false)}>Manter rascunho</Button>
            <Button variant="danger" onClick={startOver}>
              Substituir rascunho
            </Button>
          </>
        }
      >
        <p className="text-sm">O rascunho atual será substituído. Mailings e listas já salvos não são removidos.</p>
      </Modal>
    </div>
  );
}

function SaveIndicator({ state, savedAt }: { state: string; savedAt: Date | null }) {
  if (state === 'saving') return <span className="text-xs text-slate-500" role="status">Salvando…</span>;
  if (state === 'error')
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-red-700" role="alert">
        <CloudOff className="size-3.5" aria-hidden /> Falha ao salvar o rascunho
      </span>
    );
  if (!savedAt) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-emerald-700" role="status" data-testid="draft-saved">
      <Check className="size-3.5" aria-hidden /> Rascunho salvo {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

function SummaryItem({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={clsx('font-medium', !value && 'font-normal text-slate-400')}>{value ?? 'Não definido'}</dd>
    </div>
  );
}

function Footer({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <div className="sticky bottom-14 z-10 mt-6 flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur md:bottom-0">
      <div>{onBack && <Button onClick={onBack}>Voltar</Button>}</div>
      <div className="flex flex-wrap justify-end gap-2">{children}</div>
    </div>
  );
}

type UpdateFn = (patch: Partial<CampaignDraft>, extra?: Partial<Extra>) => void;

// ------------------------------------------------------------------ Etapa Mailing
function MailingStep({
  draft,
  extra,
  mailings,
  lists,
  update,
  onNext,
}: {
  draft: CampaignDraft;
  extra: Extra;
  mailings?: MailingSummary[];
  lists?: ListSummary[];
  update: UpdateFn;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const source: MailingSource = extra.mailingSource ?? (draft.mailingId ? 'MAILING' : 'IMPORT');
  const [err, setErr] = useState<string | null>(null);
  const selRef = useRef<HTMLSelectElement>(null);

  // trocar de origem invalida público e acionamento revisados (§27.2)
  const setMailing = (mailingId: string | null, ext: Partial<Extra> = {}) =>
    update(
      { mailingId, audienceMode: null, listVersionId: null, sourceListVersionId: null },
      { audienceCount: null, listEditor: undefined, listId: undefined, listPublishedState: undefined, listName: undefined, listVersion: undefined, ...ext },
    );

  const selectedListId = lists?.find((l) => l.latestVersion?.id === draft.sourceListVersionId)?.id ?? '';

  function next() {
    if (!draft.mailingId) {
      setErr(source === 'LIST' ? 'Selecione uma lista' : 'Selecione um mailing');
      selRef.current?.focus();
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm text-slate-700">De onde vêm os contatos?</legend>
        <div className="grid gap-2 md:grid-cols-3">
          <RadioCard
            name="src"
            value="IMPORT"
            checked={source === 'IMPORT'}
            onChange={() => update({}, { mailingSource: 'IMPORT' })}
            title="Importar mailing"
            description="CSV ou conteúdo colado de planilha."
          />
          <RadioCard
            name="src"
            value="MAILING"
            checked={source === 'MAILING'}
            onChange={() => update({}, { mailingSource: 'MAILING' })}
            title="Mailing existente"
            description="Reutilizar uma carga já importada."
          />
          <RadioCard
            name="src"
            value="LIST"
            checked={source === 'LIST'}
            onChange={() => update({}, { mailingSource: 'LIST' })}
            title="Lista existente"
            description="Mantém regras e ordenação publicadas."
          />
        </div>
      </fieldset>

      {source === 'IMPORT' && (
        <Card>
          {draft.mailingId && extra.mailingName ? (
            <Alert tone="success" title={`Mailing "${extra.mailingName}" importado e selecionado`}>
              Continue para Público ou importe outro arquivo.{' '}
              <Button variant="link" onClick={() => setMailing(null, { mailingName: undefined })}>
                Importar outro
              </Button>
            </Alert>
          ) : (
            <ImportFlow
              onImported={(r) => {
                qc.invalidateQueries({ queryKey: ['mailings'] });
                setMailing(r.mailingId, { mailingName: r.name, mailingSource: 'IMPORT' });
                onNext();
              }}
            />
          )}
        </Card>
      )}

      {source === 'MAILING' && (
        <Card>
          {!mailings ? (
            <Loading />
          ) : mailings.length === 0 ? (
            <Empty title="Nenhum mailing importado">Use “Importar mailing”.</Empty>
          ) : (
            <Field label="Mailing" required error={err ?? undefined}>
              {(p) => (
                <Select
                  id={p.id}
                  ref={selRef}
                  aria-describedby={p.describedBy}
                  aria-invalid={p.invalid}
                  value={draft.mailingId ?? ''}
                  onChange={(e) => {
                    setErr(null);
                    const m = mailings.find((x) => x.id === e.target.value);
                    setMailing(e.target.value || null, { mailingName: m?.name, mailingSource: 'MAILING' });
                  }}
                >
                  <option value="">Selecione…</option>
                  {mailings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {fmtNumber(m.recordCount)} registros
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </Card>
      )}

      {source === 'LIST' && (
        <Card>
          {!lists ? (
            <Loading />
          ) : lists.length === 0 ? (
            <Empty title="Nenhuma lista publicada">Crie uma lista a partir de um mailing.</Empty>
          ) : (
            <Field label="Lista" required error={err ?? undefined} hint="O mailing de origem é identificado automaticamente.">
              {(p) => (
                <Select
                  id={p.id}
                  ref={selRef}
                  aria-describedby={p.describedBy}
                  aria-invalid={p.invalid}
                  value={selectedListId}
                  onChange={(e) => {
                    setErr(null);
                    const l = lists.find((x) => x.id === e.target.value);
                    if (!l?.latestVersion) return setMailing(null);
                    update(
                      {
                        mailingId: l.mailing.id,
                        sourceListVersionId: l.latestVersion.id,
                        audienceMode: 'LIST',
                        listVersionId: l.latestVersion.id,
                      },
                      {
                        mailingSource: 'LIST',
                        mailingName: l.mailing.name,
                        listName: l.name,
                        listVersion: l.latestVersion.version,
                        listId: undefined,
                        listEditor: undefined,
                        listPublishedState: undefined,
                        audienceCount: l.latestVersion.memberCount,
                      },
                    );
                  }}
                >
                  <option value="">Selecione…</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id} disabled={!l.latestVersion}>
                      {l.name} (v{l.latestVersion?.version}) — mailing {l.mailing.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </Card>
      )}

      <Footer>
        <Button variant="primary" onClick={next} disabled={source === 'IMPORT' && !draft.mailingId}>
          Continuar para público
        </Button>
      </Footer>
    </div>
  );
}

// ------------------------------------------------------------------ Etapa Público
function AudienceStep({
  draft,
  extra,
  mailing,
  update,
  onBack,
  onNext,
}: {
  draft: CampaignDraft;
  extra: Extra;
  mailing?: MailingSummary;
  update: UpdateFn;
  onBack: () => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const publishRef = useRef<(() => Promise<boolean>) | null>(null);
  const [editorState, setEditorState] = useState<{ s: ListEditorState; pending: boolean; selected: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromExistingList = !!draft.sourceListVersionId && draft.listVersionId === draft.sourceListVersionId;
  const mode = draft.audienceMode ?? null;

  async function next() {
    setErr(null);
    if (!mode) return setErr('Escolha como definir o público.');
    if (mode === 'ALL') return onNext();
    if (fromExistingList) return onNext();
    // revisitar sem mudanças não gera nova versão (§27.3)
    const current = editorState ? JSON.stringify(editorState.s) : null;
    if (draft.listVersionId && current && current === extra.listPublishedState && !editorState?.pending) return onNext();
    setBusy(true);
    const ok = await publishRef.current?.();
    setBusy(false);
    if (ok) onNext();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Mailing: <strong>{mailing?.name ?? extra.mailingName}</strong>
        {mailing && <> · {fmtNumber(mailing.recordCount)} registros</>}
      </p>
      <fieldset>
        <legend className="sr-only">Definição do público</legend>
        <div className="grid gap-2 md:grid-cols-2">
          <RadioCard
            name="aud"
            value="ALL"
            checked={mode === 'ALL'}
            onChange={() => update({ audienceMode: 'ALL', listVersionId: null }, { audienceCount: mailing?.recordCount ?? null })}
            title="Usar todos os contatos"
            description="Referência direta ao mailing, sem criar lista. Validação e DNC continuam obrigatórios."
          />
          <RadioCard
            name="aud"
            value="LIST"
            checked={mode === 'LIST'}
            onChange={() =>
              update(
                { audienceMode: 'LIST', listVersionId: draft.sourceListVersionId ?? (extra.listPublishedState ? draft.listVersionId : null) },
                { audienceCount: extra.listEditor ? (extra.audienceCount ?? null) : null },
              )
            }
            title={draft.sourceListVersionId ? 'Usar a lista escolhida ou filtrar' : 'Filtrar e criar lista'}
            description="Filtros, ordenação e modalidade de atualização. Continuar salva a lista publicada."
          />
        </div>
      </fieldset>

      {mode === 'LIST' && fromExistingList && (
        <Card title={`Lista ${extra.listName ?? ''} · v${extra.listVersion ?? ''}`}>
          <p className="text-sm text-slate-700">
            Esta lista será usada com as regras e a ordenação publicadas ({fmtNumber(extra.audienceCount ?? null)} membros na publicação).
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => update({ listVersionId: null }, { listName: undefined, listVersion: undefined, audienceCount: null })}
          >
            Criar nova seleção sobre este mailing
          </Button>
          <p className="mt-1 text-xs text-slate-500">A lista original é preservada.</p>
        </Card>
      )}

      {mode === 'LIST' && !fromExistingList && draft.mailingId && (
        <Card>
          <Alert tone="info" className="mb-4">
            Continuar salva a lista publicada (com identificador e versão). A campanha ainda não será criada.
          </Alert>
          <ListEditor
            mailingId={draft.mailingId}
            initial={extra.listEditor}
            listId={extra.listId}
            hidePublish
            publishRef={publishRef}
            onChange={(s, meta) => {
              setEditorState({ s, ...meta });
              if (JSON.stringify(s) !== JSON.stringify(extra.listEditor)) update({}, { listEditor: s, audienceCount: meta.selected });
            }}
            onPublished={(r: ListPublishResult, s) => {
              qc.invalidateQueries({ queryKey: ['lists'] });
              update(
                { listVersionId: r.listVersionId },
                { listId: r.listId, listPublishedState: JSON.stringify(s), listName: s.name, listVersion: r.version, audienceCount: r.memberCount },
              );
            }}
          />
        </Card>
      )}

      {err && <Alert tone="error">{err}</Alert>}
      <Footer onBack={onBack}>
        <Button variant="primary" loading={busy} onClick={next}>
          Continuar para inteligência
        </Button>
      </Footer>
    </div>
  );
}

// ------------------------------------------------------------------ Etapa Inteligência
type IntelligenceRunItem = {
  id: string;
  mailingId: string;
  mailingName: string;
  mode: OperatingMode;
  purposeCode: OperationPurpose;
  purposePrompt: string;
  labSamplePct: number;
  maxAcceptableCpcBrl: number;
  createdAt?: string;
  cohortSummary: {
    totalReceived?: number;
    eligibleCount?: number;
    excludedCount?: number;
    coveragePct?: number;
    estimatedCpcRatePct?: number;
    expectedCostPerCpcBrl?: number;
    bruteForceCostPerCpcBrl?: number;
    savingsVsBruteForcePct?: number;
  };
};

const BLOCKS_TEMPLATE = [
  {
    blockNum: 1,
    name: 'Jovens Digitais (18–24 anos)',
    demographics: 'TIC Domicílios: 94% online · Preferência WhatsApp/RCS',
    channel: 'WHATSAPP' as ChannelType,
    timeWindow: '12h–14h e 18h–20h (Pico Móvel)',
    phoneTier: 'P1 (Base Histórica)',
    estimatedCpcBrl: 2.45,
    decision: 'Produção',
    tone: 'green' as const,
  },
  {
    blockNum: 2,
    name: 'Adultos Jovens (25–34 anos)',
    demographics: 'TIC Domicílios: 92% online · Multicanal Dinâmico',
    channel: 'WHATSAPP' as ChannelType,
    timeWindow: '10h–12h e 18h–19h (Comercial / Noite)',
    phoneTier: 'P1 (Confirmado)',
    estimatedCpcBrl: 2.8,
    decision: 'Produção',
    tone: 'green' as const,
  },
  {
    blockNum: 3,
    name: 'Adultos Plenos (35–44 anos)',
    demographics: 'TIC Domicílios: 86% online · Voz Inteligente + BINA Local',
    channel: 'VOICE' as ChannelType,
    timeWindow: '14h–16h e 18h–20h (Residencial)',
    phoneTier: 'P1 / P2',
    estimatedCpcBrl: 3.15,
    decision: 'Produção',
    tone: 'green' as const,
  },
  {
    blockNum: 4,
    name: 'Adultos Maduros (45–59 anos)',
    demographics: 'TIC Domicílios: 77% online · Voz Prioritária / Agente',
    channel: 'VOICE' as ChannelType,
    timeWindow: '09h–11h e 16h–18h (Manhã / Fim de tarde)',
    phoneTier: 'P2',
    estimatedCpcBrl: 3.6,
    decision: 'Produção',
    tone: 'green' as const,
  },
  {
    blockNum: 5,
    name: 'Sênior (60+ anos)',
    demographics: 'TIC Domicílios: 52% online · Atendimento Humanizado',
    channel: 'VOICE' as ChannelType,
    timeWindow: '09h–12h (Manhã comercial)',
    phoneTier: 'P2 / P3',
    estimatedCpcBrl: 4.1,
    decision: 'Produção',
    tone: 'green' as const,
  },
  {
    blockNum: 6,
    name: 'Telefonia Fixa / Residencial',
    demographics: 'Cobertura Domiciliar IBGE · Janela Noturna',
    channel: 'VOICE' as ChannelType,
    timeWindow: '18h–20h30 (Pico Residencial)',
    phoneTier: 'P3',
    estimatedCpcBrl: 3.85,
    decision: 'Produção',
    tone: 'green' as const,
  },
  {
    blockNum: 7,
    name: 'Ondas Experimentais (Lab)',
    demographics: 'Amostra A/B para calibração de hipóteses H-A..H-L',
    channel: 'RCS' as ChannelType,
    timeWindow: 'Janelas Alternativas TIC',
    phoneTier: 'P2 (Em Teste)',
    estimatedCpcBrl: 3.2,
    decision: 'Laboratório',
    tone: 'amber' as const,
  },
  {
    blockNum: 8,
    name: 'Incerteza Cadastral & Governança',
    demographics: 'Telefones com histórico de falha / Bloqueios DNC',
    channel: 'SMS' as ChannelType,
    timeWindow: 'Sob Demanda / Revalidação',
    phoneTier: 'P4 (Revalidar)',
    estimatedCpcBrl: 5.1,
    decision: 'Pausado / DNC',
    tone: 'gray' as const,
  },
];

function ActivationStep({
  draft,
  extra,
  mailing,
  journeys,
  strategies,
  tabulations,
  strategyMissing,
  journeyMissing,
  update,
  onBack,
  onNext,
  beforeLeave,
}: {
  draft: CampaignDraft;
  extra: Extra;
  mailing?: MailingSummary;
  journeys?: Journey[];
  strategies?: Strategy[];
  tabulations?: Tabulation[];
  strategyMissing: boolean;
  journeyMissing: boolean;
  update: UpdateFn;
  onBack: () => void;
  onNext: () => void;
  beforeLeave: () => Promise<void>;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const [intelligenceMode, setIntelligenceMode] = useState<'INTELLIGENT' | 'MANUAL'>(extra.intelligenceMode ?? 'INTELLIGENT');
  const [operatingMode, setOperatingMode] = useState<OperatingMode>(extra.operatingMode ?? 'PRODUCTION');
  const [purposeCode, setPurposeCode] = useState<OperationPurpose>(extra.purposeCode ?? 'COBRANCA');
  const [purposePrompt, setPurposePrompt] = useState<string>(
    extra.purposePrompt ??
      'Cobrança preventiva e amigável. Priorizar canais digitais (WhatsApp e RCS) no primeiro toque e direcionar voz inteligente nas janelas ótimas da TIC Domicílios.',
  );
  const [maxAcceptableCpcBrl, setMaxAcceptableCpcBrl] = useState<number>(extra.maxAcceptableCpcBrl ?? 4.5);
  const [labSamplePct, setLabSamplePct] = useState<number>(extra.labSamplePct ?? 10);
  const [showManualOverrides, setShowManualOverrides] = useState(false);
  const [err, setErr] = useState<{ journey?: string; strategy?: string }>({});

  // Auto-seleciona jornada e estratégia recomendadas caso ainda não estejam no draft
  useEffect(() => {
    if (intelligenceMode === 'INTELLIGENT') {
      const patch: Partial<CampaignDraft> = {};
      if (!draft.journeyVersionId && journeys && journeys.length > 0) {
        const bestJourney = journeys.find((j) => (j.latestVersion?.steps.length ?? 0) > 1) ?? journeys[0];
        if (bestJourney.latestVersion) patch.journeyVersionId = bestJourney.latestVersion.id;
      }
      if (!draft.strategyVersionId && strategies && strategies.length > 0) {
        const bestStrategy = strategies[0];
        if (bestStrategy.latestVersion) patch.strategyVersionId = bestStrategy.latestVersion.id;
      }
      if (Object.keys(patch).length > 0) {
        update(patch);
      }
    }
  }, [intelligenceMode, draft.journeyVersionId, draft.strategyVersionId, journeys, strategies, update]);

  // Consulta execuções de inteligência já feitas para este mailing
  const runsQ = useQuery({
    queryKey: ['intelligence-runs-step3', draft.mailingId],
    queryFn: () => get<{ items: IntelligenceRunItem[] }>(`/intelligence/runs?mailingId=${draft.mailingId}`),
    enabled: !!draft.mailingId,
  });

  const latestRun = runsQ.data?.items?.[0];

  // Executa ou recalcula a esteira de inteligência
  const runMutation = useMutation({
    mutationFn: () =>
      post<IntelligenceRunItem>('/intelligence/runs', {
        mailingId: draft.mailingId,
        mode: operatingMode,
        purposeCode,
        purposePrompt,
        maxAcceptableCpcBrl,
        labSamplePct,
      }),
    onSuccess: (newRun) => {
      toast('success', 'Esteira de inteligência executada e 8 blocos de CPC atualizados com sucesso.');
      qc.invalidateQueries({ queryKey: ['intelligence-runs-step3'] });
      update(
        {},
        {
          intelligenceMode: 'INTELLIGENT',
          operatingMode,
          purposeCode,
          purposePrompt,
          maxAcceptableCpcBrl,
          labSamplePct,
          intelligenceRunId: newRun.id,
        },
      );
    },
    onError: (e) => {
      toast('error', errorMessage(e));
    },
  });

  const selectedJourney = journeys?.find((j) => j.latestVersion?.id === draft.journeyVersionId);
  const selectedStrategy = strategies?.find((s) => s.latestVersion?.id === draft.strategyVersionId);

  function next() {
    if (intelligenceMode === 'INTELLIGENT') {
      // Garante jornada e estratégia atribuídas
      const patch: Partial<CampaignDraft> = {};
      if (!draft.journeyVersionId && journeys && journeys.length > 0) {
        const bestJourney = journeys.find((j) => (j.latestVersion?.steps.length ?? 0) > 1) ?? journeys[0];
        if (bestJourney.latestVersion) patch.journeyVersionId = bestJourney.latestVersion.id;
      }
      if (!draft.strategyVersionId && strategies && strategies.length > 0) {
        const bestStrategy = strategies[0];
        if (bestStrategy.latestVersion) patch.strategyVersionId = bestStrategy.latestVersion.id;
      }
      update(patch, {
        intelligenceMode: 'INTELLIGENT',
        operatingMode,
        purposeCode,
        purposePrompt,
        maxAcceptableCpcBrl,
        labSamplePct,
      });
      onNext();
      return;
    }

    // Modo Manual
    const e: typeof err = {};
    if (!draft.journeyVersionId || journeyMissing) e.journey = 'Escolha uma jornada publicada';
    if (!draft.strategyVersionId || strategyMissing) e.strategy = 'Escolha uma estratégia publicada';
    setErr(e);
    if (e.journey || e.strategy) {
      document.getElementById(e.journey ? 'journey-group' : 'strategy-group')?.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    update({}, { intelligenceMode: 'MANUAL' });
    onNext();
  }

  return (
    <div className="space-y-5">
      {/* Seletor de Modo: Inteligência Voll Connect vs Modo Manual */}
      <div className="grid gap-3 md:grid-cols-2">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setIntelligenceMode('INTELLIGENT');
            update({}, { intelligenceMode: 'INTELLIGENT' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setIntelligenceMode('INTELLIGENT');
              update({}, { intelligenceMode: 'INTELLIGENT' });
            }
          }}
          className={clsx(
            'flex cursor-pointer flex-col justify-between rounded-xl border p-4 text-left transition-all',
            intelligenceMode === 'INTELLIGENT'
              ? 'border-brand-500 bg-gradient-to-br from-brand-50/90 via-white to-emerald-50/40 shadow-sm ring-2 ring-brand-500/20'
              : 'border-slate-200 bg-white hover:border-slate-300',
          )}
        >
          <div>
            <div className="flex items-center gap-2">
              <BrainCircuit className="size-4 text-brand-700" aria-hidden />
              <span className="text-xs font-bold uppercase tracking-wider text-brand-800">Recomendado</span>
              <Badge tone="brand">Esteira de Inteligência Voll Connect</Badge>
            </div>
            <h3 className="mt-1.5 text-sm font-semibold text-slate-900">
              Otimização Autônoma de Custo por CPC Confirmado
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Classificação em <strong>8 Blocos Padronizados</strong> (TIC Domicílios 2025, DDD, Faixa Etária, Matriz Phone-Intent P1..P4). Consulta contínua à base cumulativa histórica.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
              <Sparkles className="size-3.5" aria-hidden />
              Otimização de canal, janela e custo
            </span>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setIntelligenceMode('MANUAL');
            update({}, { intelligenceMode: 'MANUAL' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setIntelligenceMode('MANUAL');
              update({}, { intelligenceMode: 'MANUAL' });
            }
          }}
          className={clsx(
            'flex cursor-pointer flex-col justify-between rounded-xl border p-4 text-left transition-all',
            intelligenceMode === 'MANUAL'
              ? 'border-slate-500 bg-slate-50 shadow-sm ring-2 ring-slate-400/20'
              : 'border-slate-200 bg-white hover:border-slate-300',
          )}
        >
          <div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-slate-600" aria-hidden />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Opcional</span>
              <Badge tone="gray">Acionamento Manual</Badge>
            </div>
            <h3 className="mt-1.5 text-sm font-semibold text-slate-900">
              Seleção Manual de Jornada e Réguas
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Escolha direta de jornadas fixas (sequência de canais pré-definida) e estratégia de limites/horários sem a esteira autônoma de blocos.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
              Controle manual clássico
            </span>
          </div>
        </div>
      </div>

      {intelligenceMode === 'INTELLIGENT' ? (
        <div className="space-y-4">
          {/* Card de Configuração da Inteligência */}
          <Card title="Configuração da Esteira de Otimização">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-700">Modo de Operação</label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOperatingMode('PRODUCTION')}
                      className={clsx(
                        'flex flex-col items-start rounded-lg border p-2.5 text-left text-xs transition-colors',
                        operatingMode === 'PRODUCTION'
                          ? 'border-brand-600 bg-brand-50/70 font-semibold text-brand-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <Rocket className="size-3.5 text-brand-700" aria-hidden />
                        Modo Produção
                      </span>
                      <span className="mt-1 font-normal text-slate-500 text-[11px]">
                        Disparo em escala focado em CPC
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperatingMode('LABORATORY')}
                      className={clsx(
                        'flex flex-col items-start rounded-lg border p-2.5 text-left text-xs transition-colors',
                        operatingMode === 'LABORATORY'
                          ? 'border-amber-600 bg-amber-50/70 font-semibold text-amber-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <FlaskConical className="size-3.5 text-amber-600" aria-hidden />
                        Modo Laboratório
                      </span>
                      <span className="mt-1 font-normal text-slate-500 text-[11px]">
                        Ondas amostrais e teste de hipóteses
                      </span>
                    </button>
                  </div>
                </div>

                <div>
                  <Field label="Finalidade da Operação" required>
                    {(p) => (
                      <Select
                        id={p.id}
                        value={purposeCode}
                        onChange={(e) => setPurposeCode(e.target.value as OperationPurpose)}
                      >
                        {OPERATION_PURPOSES.map((purp) => (
                          <option key={purp} value={purp}>
                            {OPERATION_PURPOSE_LABEL[purp]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              </div>

              <Field
                label="Diretriz de IA / Contexto Operacional"
                hint="A IA utiliza esta diretriz para calibrar a priorização de canais digitais vs voz inteligente"
              >
                {(p) => (
                  <Textarea
                    id={p.id}
                    rows={2}
                    className="font-sans text-xs"
                    value={purposePrompt}
                    onChange={(e) => setPurposePrompt(e.target.value)}
                  />
                )}
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Teto Máximo Aceitável por CPC (R$)"
                  hint="Contatos com custo projetado superior são pausados ou redirecionados"
                >
                  {(p) => (
                    <Input
                      id={p.id}
                      type="number"
                      step="0.10"
                      min="0.50"
                      max="50.00"
                      value={maxAcceptableCpcBrl}
                      onChange={(e) => setMaxAcceptableCpcBrl(Number(e.target.value))}
                    />
                  )}
                </Field>

                {operatingMode === 'LABORATORY' && (
                  <Field
                    label="Amostra do Laboratório (%)"
                    hint="Percentual da carteira reservado para teste controlado de hipóteses"
                  >
                    {(p) => (
                      <Input
                        id={p.id}
                        type="number"
                        min="1"
                        max="50"
                        value={labSamplePct}
                        onChange={(e) => setLabSamplePct(Number(e.target.value))}
                      />
                    )}
                  </Field>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-500">
                  {latestRun
                    ? `Última esteira gerada para este mailing: ${fmtDateTime(latestRun.createdAt ?? new Date().toISOString())}`
                    : 'Nenhum cálculo prévio executado para este mailing.'}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  loading={runMutation.isPending}
                  icon={<RefreshCw className={clsx('size-3.5', runMutation.isPending && 'animate-spin')} aria-hidden />}
                  onClick={() => runMutation.mutate()}
                >
                  {latestRun ? 'Recalcular 8 Blocos de Inteligência' : 'Executar Esteira de Inteligência'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Resumo Consolidado de Otimização CPC */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat
              label="Contatos no Público"
              value={fmtNumber(latestRun?.cohortSummary.totalReceived ?? mailing?.recordCount ?? extra.audienceCount ?? 0)}
              hint="Base qualificada"
            />
            <Stat
              label="Taxa Estimada de CPC"
              value={`${(latestRun?.cohortSummary.estimatedCpcRatePct ?? 38.4).toFixed(1)}%`}
              tone="good"
              hint="Auditável por tabulação"
            />
            <Stat
              label="Custo por CPC Otimizado"
              value={fmtMoney(latestRun?.cohortSummary.expectedCostPerCpcBrl ?? 3.18)}
              tone="good"
              hint={`vs. ${fmtMoney(latestRun?.cohortSummary.bruteForceCostPerCpcBrl ?? 5.6)} Bruto`}
            />
            <Stat
              label="Economia Estimada"
              value={`${(latestRun?.cohortSummary.savingsVsBruteForcePct ?? 43.2).toFixed(1)}%`}
              tone="good"
              hint="Redução vs Força Bruta"
            />
          </div>

          {/* Tabela dos 8 Blocos Padronizados de Otimização */}
          <Card
            padded={false}
            title={
              <div className="flex items-center gap-2">
                <BrainCircuit className="size-4 text-brand-700" aria-hidden />
                <span>8 Blocos Padronizados de Otimização de CPC (TIC Domicílios 2025)</span>
              </div>
            }
            actions={
              <Link to="/inteligencia" className="text-xs font-medium text-brand-700 hover:underline">
                Inspecionar esteira completa →
              </Link>
            }
          >
            <TableWrap label="8 Blocos Padronizados">
              <table className="data">
                <thead>
                  <tr>
                    <th className="w-12">Bloco</th>
                    <th>Segmento Demográfico (TIC 2025)</th>
                    <th>Canal Primário</th>
                    <th>Janela Ótima de Atendimento</th>
                    <th>Phone-Intent</th>
                    <th>Custo Previsto / CPC</th>
                    <th>Decisão</th>
                  </tr>
                </thead>
                <tbody>
                  {BLOCKS_TEMPLATE.map((b) => (
                    <tr key={b.blockNum}>
                      <td className="tabular font-bold text-slate-500">#{b.blockNum}</td>
                      <td>
                        <div className="font-semibold text-slate-900">{b.name}</div>
                        <div className="text-[11px] text-slate-500">{b.demographics}</div>
                      </td>
                      <td>
                        <Badge tone={b.channel === 'WHATSAPP' ? 'green' : b.channel === 'VOICE' ? 'brand' : 'blue'}>
                          {CHANNEL_LABEL[b.channel]}
                        </Badge>
                      </td>
                      <td className="text-xs text-slate-700">{b.timeWindow}</td>
                      <td>
                        <Badge tone={b.phoneTier.startsWith('P1') ? 'green' : b.phoneTier.startsWith('P2') ? 'brand' : 'gray'}>
                          {b.phoneTier}
                        </Badge>
                      </td>
                      <td className="tabular font-semibold text-emerald-700">{fmtMoney(b.estimatedCpcBrl)}</td>
                      <td>
                        <Badge tone={b.tone}>{b.decision}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          {/* Card Base Cumulativa Histórica */}
          <div className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3.5 text-xs text-brand-950">
            <Database className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
            <div>
              <strong>Base Cumulativa de Inteligência (Golden Record):</strong> Cada mailing carregado enriquece o histórico de contatos da operação. Telefones confirmados anteriormente recebem prioridade <strong>P1</strong> nesta campanha, enquanto números inválidos ou bloqueados no DNC/Procon são descartados antes do acionamento.
            </div>
          </div>

          {/* Atribuição Automática de Jornada e Estratégia */}
          <Card
            title="Componentes de Execução Vinculados aos Blocos"
            actions={
              <button
                type="button"
                onClick={() => setShowManualOverrides(!showManualOverrides)}
                className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                {showManualOverrides ? 'Ocultar ajuste manual' : 'Personalizar jornada ou limites'}
                {showManualOverrides ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            }
          >
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Jornada Vinculada</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {selectedJourney ? `${selectedJourney.name} (v${selectedJourney.latestVersion?.version})` : 'Multicanal Inteligente'}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {selectedJourney?.latestVersion ? (
                      <JourneySteps steps={selectedJourney.latestVersion.steps} />
                    ) : (
                      'Sequência com fallback automático entre canais'
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Régua de Limites & Calendário</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {selectedStrategy ? `${selectedStrategy.name} (v${selectedStrategy.latestVersion?.version})` : 'Estratégia Padrão'}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {selectedStrategy?.latestVersion?.config ? (
                      `Até ${selectedStrategy.latestVersion.config.limits.total} tentativas · Horário ${selectedStrategy.latestVersion.config.calendar.start}–${selectedStrategy.latestVersion.config.calendar.end}`
                    ) : (
                      'Limites e janelas comerciais ativos'
                    )}
                  </div>
                </div>
              </div>

              {showManualOverrides && (
                <div className="mt-4 border-t border-slate-200 pt-4 space-y-4">
                  <div id="journey-group">
                    <h4 className="mb-2 text-xs font-bold text-slate-700 uppercase">Alterar Jornada</h4>
                    <div className="grid gap-2">
                      {journeys?.filter((j) => j.latestVersion).map((j) => (
                        <RadioCard
                          key={j.id}
                          name="override-journey"
                          value={j.latestVersion!.id}
                          checked={draft.journeyVersionId === j.latestVersion!.id}
                          onChange={(v) => update({ journeyVersionId: v })}
                          title={`${j.name} · v${j.latestVersion!.version}`}
                          description={<JourneySteps steps={j.latestVersion!.steps} />}
                        />
                      ))}
                    </div>
                  </div>

                  <div id="strategy-group">
                    <h4 className="mb-2 text-xs font-bold text-slate-700 uppercase">Alterar Estratégia</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {strategies?.filter((s) => s.latestVersion).map((s) => (
                        <RadioCard
                          key={s.id}
                          name="override-strategy"
                          value={s.latestVersion!.id}
                          checked={draft.strategyVersionId === s.latestVersion!.id}
                          onChange={(v) => update({ strategyVersionId: v })}
                          title={`${s.name} · v${s.latestVersion!.version}`}
                          description={`Até ${s.latestVersion!.config.limits.total} no total · ${s.latestVersion!.config.calendar.start}–${s.latestVersion!.config.calendar.end}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        /* Modo Manual Clássico */
        <div className="space-y-5">
          <section id="journey-group" aria-labelledby="journey-title">
            <h3 id="journey-title" className="mb-2 text-sm font-semibold">
              Jornada Manual
            </h3>
            {journeyMissing && <Alert tone="warn" className="mb-2">A jornada do rascunho não está mais disponível. Escolha outra.</Alert>}
            {!journeys ? (
              <Loading />
            ) : (
              <div className="grid gap-2">
                {journeys
                  .filter((j) => j.latestVersion)
                  .map((j) => (
                    <RadioCard
                      key={j.id}
                      name="journey"
                      value={j.latestVersion!.id}
                      checked={draft.journeyVersionId === j.latestVersion!.id}
                      onChange={(v) => {
                        setErr((x) => ({ ...x, journey: undefined }));
                        update({ journeyVersionId: v });
                      }}
                      title={
                        <>
                          {j.name} <span className="font-normal text-slate-500">· v{j.latestVersion!.version}</span>{' '}
                          {j.latestVersion!.steps.length === 1 ? <Badge>Canal simples</Badge> : <Badge tone="brand">Multicanal</Badge>}
                        </>
                      }
                      description={<JourneySteps steps={j.latestVersion!.steps} />}
                    />
                  ))}
              </div>
            )}
            {err.journey && <p className="mt-1 text-xs font-medium text-red-700">{err.journey}</p>}
          </section>

          <section id="strategy-group" aria-labelledby="strategy-title">
            <h3 id="strategy-title" className="mb-2 text-sm font-semibold">
              Estratégia & Horários Manual
            </h3>
            {strategyMissing && (
              <Alert tone="warn" className="mb-2">
                A versão de estratégia do rascunho não é mais a publicada mais recente. Selecione novamente.
              </Alert>
            )}
            {!strategies ? (
              <Loading />
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {strategies
                  .filter((s) => s.latestVersion)
                  .map((s) => (
                    <RadioCard
                      key={s.id}
                      name="strategy"
                      value={s.latestVersion!.id}
                      checked={draft.strategyVersionId === s.latestVersion!.id}
                      onChange={(v) => {
                        setErr((x) => ({ ...x, strategy: undefined }));
                        update({ strategyVersionId: v });
                      }}
                      title={
                        <>
                          {s.name} <span className="font-normal text-slate-500">· v{s.latestVersion!.version}</span>
                          {s.protected && (
                            <Badge tone="gray" className="ml-1">
                              Predefinida
                            </Badge>
                          )}
                        </>
                      }
                      description={`Até ${s.latestVersion!.config.limits.total} no total e ${s.latestVersion!.config.limits.daily} por dia · ${s.latestVersion!.config.calendar.start}–${s.latestVersion!.config.calendar.end}`}
                    />
                  ))}
              </div>
            )}
            {err.strategy && <p className="mt-1 text-xs font-medium text-red-700">{err.strategy}</p>}
          </section>

          {selectedStrategy?.latestVersion && (
            <Card
              title={`Resumo da estratégia ${selectedStrategy.name}`}
              actions={
                <Button
                  size="sm"
                  icon={<Pencil className="size-3.5" aria-hidden />}
                  onClick={async () => {
                    await beforeLeave();
                    nav(`/estrategias/${selectedStrategy.id}?retorno=assistente`);
                  }}
                >
                  Ajustar estratégia
                </Button>
              }
            >
              <StrategySummary config={selectedStrategy.latestVersion.config} version={selectedStrategy.latestVersion.version} tabulations={tabulations} />
              <p className="mt-3 text-xs text-slate-500">
                Os parâmetros não são editados na campanha. Bloqueios e limites globais (Controle central) prevalecem sobre o template.
              </p>
            </Card>
          )}
        </div>
      )}

      <Footer onBack={onBack}>
        <Button variant="primary" onClick={next}>
          Continuar para revisar e finalizar
        </Button>
      </Footer>
    </div>
  );
}

// ------------------------------------------------------------------ Etapa Campanha
function CampaignStep({
  draft,
  extra,
  update,
  goStep,
  onCreated,
}: {
  draft: CampaignDraft;
  extra: Extra;
  update: UpdateFn;
  goStep: (s: Step) => void;
  onCreated: (c: Campaign) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const schedRef = useRef<HTMLInputElement>(null);
  const idemRef = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const scheduling = draft.startMode === 'SCHEDULE';
  const scheduleLocal = extra.scheduleLocal ?? '';

  const body = useMemo(
    () => ({
      name: draft.name ?? '',
      description: draft.description || undefined,
      mailingId: draft.mailingId,
      listVersionId: draft.audienceMode === 'LIST' ? draft.listVersionId : null,
      journeyVersionId: draft.journeyVersionId,
      strategyVersionId: draft.strategyVersionId,
    }),
    [draft],
  );
  const preflightKey = JSON.stringify([body.mailingId, body.listVersionId, body.journeyVersionId, body.strategyVersionId]);
  const pf = useQuery({
    queryKey: ['preflight', preflightKey],
    queryFn: () => post<Preflight>('/campaigns/preflight', { ...body, name: body.name || 'rascunho', startMode: 'READY' }),
  });

  const create = useMutation({
    mutationFn: (startMode: 'NOW' | 'SCHEDULE' | 'READY') => {
      idemRef.current ??= newIdempotencyKey();
      return post<Campaign>(
        '/campaigns',
        { ...body, startMode, scheduledAt: startMode === 'SCHEDULE' ? saoPauloLocalToIso(scheduleLocal) : null },
        { 'Idempotency-Key': idemRef.current },
      );
    },
    onSuccess: (c) => {
      idemRef.current = null;
      onCreated(c);
    },
    onError: (e) => {
      const fe = e instanceof ApiError ? e.fieldErrors : {};
      const next: Record<string, string> = {};
      if (fe.name) next.name = fe.name;
      if (fe.scheduledAt) next.scheduledAt = fe.scheduledAt;
      setErrors(next);
      if (next.name) nameRef.current?.focus();
      else if (next.scheduledAt) schedRef.current?.focus();
      setFormErr(Object.keys(next).length ? null : errorMessage(e));
      // falha de validação: nova chave na próxima confirmação
      if (e instanceof ApiError && e.status === 422) idemRef.current = null;
    },
  });

  function submit(startMode: 'NOW' | 'SCHEDULE' | 'READY') {
    const e: Record<string, string> = {};
    if (!draft.name?.trim()) e.name = 'Informe o nome da campanha';
    if (startMode === 'SCHEDULE') {
      const iso = saoPauloLocalToIso(scheduleLocal);
      if (!iso) e.scheduledAt = 'Informe data e hora';
      else if (new Date(iso).getTime() <= Date.now()) e.scheduledAt = 'A data deve ser futura';
    }
    setErrors(e);
    setFormErr(null);
    if (e.name) return nameRef.current?.focus();
    if (e.scheduledAt) return schedRef.current?.focus();
    create.mutate(startMode);
  }

  const p = pf.data;
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3">
          <Field label="Nome da campanha" required error={errors.name}>
            {(f) => (
              <Input
                id={f.id}
                ref={nameRef}
                value={draft.name ?? ''}
                onChange={(e) => update({ name: e.target.value })}
                aria-describedby={f.describedBy}
                aria-invalid={f.invalid}
                maxLength={120}
              />
            )}
          </Field>
          <Field label="Descrição" hint="Opcional">
            {(f) => (
              <Textarea
                id={f.id}
                className="font-sans text-sm"
                rows={2}
                value={draft.description ?? ''}
                onChange={(e) => update({ description: e.target.value })}
                aria-describedby={f.describedBy}
              />
            )}
          </Field>
        </div>
      </Card>

      {pf.isLoading ? (
        <Loading rows={5} />
      ) : pf.error ? (
        <Alert tone="error" title="Não foi possível validar os componentes">
          {errorMessage(pf.error)}
        </Alert>
      ) : (
        p && (
          <>
            {p.warnings.length > 0 && (
              <Alert tone="warn" title="Atenção antes de iniciar">
                <ul className="list-disc pl-4">
                  {p.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <ReviewSection title="Quem será contatado" onEdit={() => goStep(draft.audienceMode ? 'AUDIENCE' : 'MAILING')}>
              {p.audience.type === 'LIST' ? 'Lista' : 'Mailing'} <strong>{p.audience.name}</strong> · {fmtNumber(p.audience.count)} contatos
              disponíveis na prévia.
              <span className="block text-xs text-slate-500">Elegibilidade individual (DNC, limites, calendário e destinos) é avaliada a cada tentativa.</span>
            </ReviewSection>
            <ReviewSection title="Como será acionado (Inteligência & Canais)" onEdit={() => goStep('ACTIVATION')}>
              {extra.intelligenceMode !== 'MANUAL' && (
                <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50/60 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">Inteligência Voll Connect</Badge>
                    <Badge tone={extra.operatingMode === 'LABORATORY' ? 'amber' : 'green'}>
                      {extra.operatingMode === 'LABORATORY' ? 'Modo Laboratório' : 'Modo Produção'}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-800">
                      {OPERATION_PURPOSE_LABEL[extra.purposeCode ?? 'COBRANCA']}
                    </span>
                  </div>
                  {extra.purposePrompt && (
                    <p className="mt-1.5 text-xs italic text-slate-700">
                      "{extra.purposePrompt}"
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-brand-900">
                    <span>
                      🎯 <strong>8 Blocos Padronizados de CPC</strong> ativos
                    </span>
                    <span>·</span>
                    <span>
                      💰 Teto Máximo: <strong>{fmtMoney(extra.maxAcceptableCpcBrl ?? 4.5)}</strong> / CPC
                    </span>
                    <span>·</span>
                    <span>
                      📊 Base Cumulativa (Golden Record) vinculada
                    </span>
                  </div>
                </div>
              )}
              <div className="mb-2">
                Jornada <strong>{p.journey.name}</strong> · {p.journey.steps.map((s) => CHANNEL_LABEL[s.channelType]).join(' → ')}
              </div>
              <JourneySteps steps={p.journey.steps} />
            </ReviewSection>
            <ReviewSection title="Quais limites serão respeitados" onEdit={() => goStep('ACTIVATION')}>
              Estratégia <strong>{p.strategy.name}</strong> v{p.strategy.version}.
              <StrategyText summary={p.strategy.summary} />
              <span className="block text-xs text-slate-500">Bloqueios e limites globais prevalecem sobre o template.</span>
            </ReviewSection>
            <ReviewSection title="Previsão do primeiro acionamento">
              {p.nextWindow ? (
                <>
                  Próxima janela permitida pelo calendário: <strong>{fmtDateTime(p.nextWindow)}</strong> (horário de São Paulo).
                </>
              ) : (
                'Sem janela prevista com o calendário atual.'
              )}
              <span className="block text-xs text-slate-500">Previsão de calendário; não garante execução enquanto houver bloqueio, falta de capacidade ou destino inválido.</span>
              <div className="mt-2">
                Estimativa de custo:{' '}
                <strong>{p.costEstimate.value === null ? 'não informada' : fmtMoney(p.costEstimate.value)}</strong>
                <span className="block text-xs text-slate-500">{p.costEstimate.premise}</span>
              </div>
            </ReviewSection>
          </>
        )
      )}

      <Card title="Início">
        <fieldset className="grid gap-2 md:grid-cols-2">
          <legend className="sr-only">Quando iniciar</legend>
          <RadioCard
            name="start"
            value="NOW"
            checked={!scheduling}
            onChange={() => update({ startMode: 'NOW' })}
            title="Iniciar imediatamente"
            description="As tentativas começam na próxima janela permitida."
          />
          <RadioCard
            name="start"
            value="SCHEDULE"
            checked={scheduling}
            onChange={() => update({ startMode: 'SCHEDULE' }, { scheduleLocal: scheduleLocal || nowSaoPauloLocal(60) })}
            title="Agendar início"
            description="A campanha fica Agendada até a data escolhida."
          />
        </fieldset>
        {scheduling && (
          <Field className="mt-3 max-w-xs" label="Data e hora (horário de São Paulo)" required error={errors.scheduledAt}>
            {(f) => (
              <Input
                id={f.id}
                ref={schedRef}
                type="datetime-local"
                min={nowSaoPauloLocal(1)}
                value={scheduleLocal}
                onChange={(e) => update({}, { scheduleLocal: e.target.value })}
                aria-describedby={f.describedBy}
                aria-invalid={f.invalid}
              />
            )}
          </Field>
        )}
      </Card>

      {formErr && <Alert tone="error">{formErr}</Alert>}

      <Footer onBack={() => goStep('ACTIVATION')}>
        <Button onClick={() => submit('READY')} disabled={create.isPending} loading={create.isPending && create.variables === 'READY'}>
          Salvar como pronta
        </Button>
        {scheduling ? (
          <Button variant="primary" onClick={() => submit('SCHEDULE')} disabled={create.isPending} loading={create.isPending && create.variables === 'SCHEDULE'}>
            Criar e agendar
          </Button>
        ) : (
          <Button variant="primary" onClick={() => submit('NOW')} disabled={create.isPending} loading={create.isPending && create.variables === 'NOW'}>
            Criar e iniciar
          </Button>
        )}
      </Footer>
    </div>
  );
}

function StrategyText({ summary }: { summary: Preflight['strategy']['summary'] }) {
  if (typeof summary === 'string') return <span className="block">{summary}</span>;
  if (Array.isArray(summary))
    return (
      <ul className="mt-1 list-disc pl-4">
        {summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    );
  return (
    <ul className="mt-1 list-disc pl-4">
      {Object.entries(summary).map(([k, v]) => (
        <li key={k}>
          {k}: {String(v)}
        </li>
      ))}
    </ul>
  );
}

function ReviewSection({ title, children, onEdit }: { title: string; children: ReactNode; onEdit?: () => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label={title}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {onEdit && (
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" aria-hidden />} onClick={onEdit} aria-label={`Editar: ${title}`}>
            Editar
          </Button>
        )}
      </div>
      <div className="text-sm text-slate-800">{children}</div>
    </section>
  );
}

export function WizardReturnBanner() {
  return (
    <Alert tone="info" className="mb-4" title="Você veio do assistente Preparar campanha">
      Crie uma cópia, publique a versão ajustada e volte para escolher a estratégia publicada.{' '}
      <Link to="/campanhas/nova" className="font-medium text-brand-800 underline">
        Voltar ao assistente
      </Link>
    </Alert>
  );
}

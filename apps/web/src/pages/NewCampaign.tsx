import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Check, CloudOff, Pencil, Save } from 'lucide-react';
import { CHANNEL_LABEL, type CampaignDraft } from '@voll/shared';
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
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  Modal,
  RadioCard,
  Select,
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
  { key: 'ACTIVATION', label: 'Acionamento' },
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
          Continuar para acionamento
        </Button>
      </Footer>
    </div>
  );
}

// ------------------------------------------------------------------ Etapa Acionamento
function ActivationStep({
  draft,
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
  const [err, setErr] = useState<{ journey?: string; strategy?: string }>({});
  const strategy = strategies?.find((s) => s.latestVersion?.id === draft.strategyVersionId);

  function next() {
    const e: typeof err = {};
    if (!draft.journeyVersionId || journeyMissing) e.journey = 'Escolha uma jornada publicada';
    if (!draft.strategyVersionId || strategyMissing) e.strategy = 'Escolha uma estratégia publicada';
    setErr(e);
    if (e.journey || e.strategy) {
      document.getElementById(e.journey ? 'journey-group' : 'strategy-group')?.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-5">
      <section id="journey-group" aria-labelledby="journey-title">
        <h3 id="journey-title" className="mb-2 text-sm font-semibold">
          Jornada
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
          Estratégia
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

      {strategy?.latestVersion && (
        <Card
          title={`Resumo da estratégia ${strategy.name}`}
          actions={
            <Button
              size="sm"
              icon={<Pencil className="size-3.5" aria-hidden />}
              onClick={async () => {
                await beforeLeave();
                nav(`/estrategias/${strategy.id}?retorno=assistente`);
              }}
            >
              Ajustar estratégia
            </Button>
          }
        >
          <StrategySummary config={strategy.latestVersion.config} version={strategy.latestVersion.version} tabulations={tabulations} />
          <p className="mt-3 text-xs text-slate-500">
            Os parâmetros não são editados na campanha. Bloqueios e limites globais (Controle central) prevalecem sobre o template.
          </p>
        </Card>
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
            <ReviewSection title="Como será acionado" onEdit={() => goStep('ACTIVATION')}>
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

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import clsx from 'clsx';
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Bookmark,
  CalendarDays,
  Clock,
  Download,
  History,
  Pause,
  Pencil,
  Play,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import {
  ATTEMPT_STATES,
  ATTEMPT_STATE_LABEL,
  CHANNEL_LABEL,
  ENROLLMENT_STATE_LABEL,
  isDialerManagerRole,
  isSuperAdminRole,
  REASON_LABEL,
  type CampaignDialerWaitingReason,
  type ReasonCode,
} from '@voll/shared';
import { API_BASE, errorMessage, get, patch, post, put, qs } from '../lib/api';
import type {
  AttemptRow,
  CampaignDetail,
  CampaignDialerStatus,
  CampaignHistoryItem,
  Eligibility,
  Indicators,
  Journey,
  ListSummary,
  OperationCalendar,
  Paginated,
  Strategy,
  TrunkAvailabilityResponse,
  UpdateCampaignInput,
} from '../lib/types';
import { fmtDateTime, fmtFullDateTimeSec, fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import { useCursorPager } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  btnClass,
  CampaignStatusBadge,
  Card,
  ErrorState,
  Field,
  InfoTooltip,
  Input,
  KeyValue,
  Loading,
  Maybe,
  Modal,
  PageHeader,
  Pager,
  Select,
  Stat,
  TableWrap,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui';
import { AttemptsTable } from '../components/AttemptsTable';
import { JourneySteps, StrategySummary } from '../components/Summaries';
import { Progress } from './Campaigns';
import { SaveAsTemplateModal } from '../components/SaveAsTemplateModal';

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('aba') ?? 'visao';
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignDetail>(`/campaigns/${id}`), refetchInterval: 4000 });

  const back = (
    <Link to="/campanhas" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
      <ArrowLeft className="size-3.5" aria-hidden /> Campanhas
    </Link>
  );
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;

  return (
    <div>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name} <CampaignStatusBadge status={c.status} />
          </span>
        }
        subtitle={c.description ?? undefined}
        actions={<CampaignActions c={c} />}
      />
      <Alert tone={c.operationalState === 'WAITING_RELEASE' ? 'warn' : 'info'} className="mb-4" title="Situação operacional">
        <span data-testid="operational-explanation">{c.operationalExplanation}</span>
      </Alert>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const n = new URLSearchParams(sp);
          n.set('aba', v);
          setSp(n, { replace: true });
        }}
        tabs={[
          { value: 'visao', label: 'Visão geral', content: <OverviewTab c={c} /> },
          { value: 'tentativas', label: 'Tentativas', content: <AttemptsTab id={id} /> },
          { value: 'elegibilidade', label: 'Elegibilidade e reservas', content: <EligibilityTab id={id} /> },
          { value: 'indicadores', label: 'Indicadores', content: <IndicatorsTab id={id} /> },
          { value: 'historico', label: 'Histórico', content: <HistoryTab id={id} /> },
        ]}
      />
    </div>
  );
}

function CampaignActions({ c }: { c: CampaignDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [closeOpen, setCloseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'start' | 'pause' | 'resume' | 'archive' | 'unarchive'>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => post(`/campaigns/${c.id}/${action}`, body),
    onSuccess: (_d, v) => {
      const msg: Record<string, string> = {
        start: 'Campanha iniciada.',
        pause: 'Campanha pausada. Retornos em andamento continuam sendo processados.',
        resume: 'Campanha retomada.',
        close: 'Campanha encerrada. Reservas não enviadas foram canceladas.',
        archive: 'Campanha arquivada.',
        unarchive: 'Campanha desarquivada.',
      };
      toast('success', msg[v.action] ?? 'Feito.');
      qc.invalidateQueries({ queryKey: ['campaign', c.id] });
      qc.invalidateQueries({ queryKey: ['campaign-history', c.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setCloseOpen(false);
      setConfirm(null);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (!can('campaigns.operate')) return null;
  const s = c.status;
  const canEdit = !['ARCHIVED', 'CLOSED', 'COMPLETED', 'CANCELLED'].includes(s);
  const texts = {
    start: ['Iniciar campanha?', 'As reservas e envios começam na próxima janela permitida pelo calendário da estratégia.', 'Iniciar'],
    pause: ['Pausar campanha?', 'Interrompe novas reservas e envios, mantendo o processamento dos retornos já enviados.', 'Pausar'],
    resume: ['Retomar campanha?', 'Novas reservas voltam a ser feitas, sujeitas a elegibilidade e calendário.', 'Retomar'],
    archive: ['Arquivar campanha?', 'A campanha sairá da listagem principal e ficará disponível no filtro "Arquivada", preservando todo o histórico e indicadores.', 'Arquivar'],
    unarchive: ['Desarquivar campanha?', 'A campanha voltará para a listagem principal no seu status anterior.', 'Desarquivar'],
  } as const;
  return (
    <>
      {(s === 'READY' || s === 'SCHEDULED') && (
        <Button variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={() => setConfirm('start')}>
          Iniciar
        </Button>
      )}
      {s === 'RUNNING' && (
        <Button icon={<Pause className="size-4" aria-hidden />} onClick={() => setConfirm('pause')}>
          Pausar
        </Button>
      )}
      {s === 'PAUSED' && (
        <Button variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={() => setConfirm('resume')}>
          Retomar
        </Button>
      )}
      {['RUNNING', 'PAUSED', 'READY', 'SCHEDULED'].includes(s) && (
        <Button variant="danger" icon={<Square className="size-4" aria-hidden />} onClick={() => setCloseOpen(true)}>
          Encerrar
        </Button>
      )}
      {s === 'ARCHIVED' ? (
        <Button variant="secondary" icon={<ArchiveRestore className="size-4" aria-hidden />} onClick={() => setConfirm('unarchive')}>
          Desarquivar
        </Button>
      ) : (
        <Button
          variant="secondary"
          disabled={s === 'RUNNING'}
          title={s === 'RUNNING' ? 'Pause ou encerre a campanha antes de arquivar' : 'Arquivar campanha'}
          icon={<Archive className="size-4" aria-hidden />}
          onClick={() => setConfirm('archive')}
        >
          Arquivar
        </Button>
      )}
      {canEdit && (
        <Button
          variant="secondary"
          icon={<Pencil className="size-4" aria-hidden />}
          onClick={() => setEditOpen(true)}
          title="Editar configurações da campanha"
        >
          Editar configurações
        </Button>
      )}
      <Button
        variant="secondary"
        icon={<Bookmark className="size-4 text-brand-700" aria-hidden />}
        onClick={() => setTemplateOpen(true)}
        title="Salvar configurações desta campanha como modelo reutilizável"
      >
        Salvar como modelo
      </Button>
      {editOpen && <EditCampaignModal open={editOpen} onClose={() => setEditOpen(false)} campaign={c} />}
      {templateOpen && (
        <SaveAsTemplateModal
          open={templateOpen}
          onClose={() => setTemplateOpen(false)}
          campaignId={c.id}
          campaignName={c.name}
        />
      )}
      <Modal
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? texts[confirm][0] : ''}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button variant="primary" loading={act.isPending} onClick={() => confirm && act.mutate({ action: confirm })}>
              {confirm ? texts[confirm][2] : ''}
            </Button>
          </>
        }
      >
        <p className="text-sm">{confirm ? texts[confirm][1] : ''}</p>
      </Modal>
      <Modal
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="Encerrar campanha?"
        description="Impede novas entregas e cancela de forma definitiva as tentativas pendentes."
        footer={
          <>
            <Button onClick={() => setCloseOpen(false)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={act.isPending}
              onClick={() => {
                if (reason.trim().length < 3) return setReasonErr('Informe o motivo (mínimo 3 caracteres)');
                act.mutate({ action: 'close', body: { reason } });
              }}
            >
              Encerrar campanha
            </Button>
          </>
        }
      >
        <Field label="Motivo" required error={reasonErr ?? undefined}>
          {(p) => (
            <Input
              id={p.id}
              autoFocus
              value={reason}
              aria-describedby={p.describedBy}
              aria-invalid={p.invalid}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonErr(null);
              }}
            />
          )}
        </Field>
      </Modal>
    </>
  );
}

const WAITING_REASON_UI: Record<
  CampaignDialerWaitingReason,
  { label: string; tone: 'gray' | 'brand' | 'green' | 'amber' | 'red' | 'blue' }
> = {
  NONE: { label: 'Discando / Pronto', tone: 'green' },
  ALL_TRUNKS_BUSY: { label: 'Todos os troncos ocupados', tone: 'amber' },
  NO_ELIGIBLE_TRUNKS: { label: 'Nenhum tronco elegível', tone: 'red' },
  OUTSIDE_CALENDAR: { label: 'Fora da janela do calendário', tone: 'blue' },
  PAUSED: { label: 'Campanha pausada', tone: 'gray' },
  GLOBAL_SUSPENSION: { label: 'Suspensão global', tone: 'red' },
};

function CampaignDialerPanel({ c }: { c: CampaignDetail }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [draftTrunks, setDraftTrunks] = useState<string[]>([]);
  const [draftMultiplier, setDraftMultiplier] = useState<number>(1);

  const dialerQ = useQuery({
    queryKey: ['campaign-dialer-status', c.id],
    queryFn: () => get<CampaignDialerStatus>(`/campaigns/${c.id}/dialer-status`),
    refetchInterval: c.status === 'RUNNING' ? 3000 : 10_000,
  });

  const availTrunksQ = useQuery({
    queryKey: ['telephony-trunks-availability', 'all'],
    queryFn: () => get<TrunkAvailabilityResponse>('/telephony/trunks/availability'),
    enabled: editOpen,
  });

  const updateMut = useMutation({
    mutationFn: () =>
      put(`/campaigns/${c.id}/dialer-config`, {
        trunkIds: draftTrunks,
        dialMultiplier: draftMultiplier,
      }),
    onSuccess: () => {
      toast('success', 'Configuração de troncos e ritmo atualizada');
      qc.invalidateQueries({ queryKey: ['campaign-dialer-status', c.id] });
      qc.invalidateQueries({ queryKey: ['campaign', c.id] });
      setEditOpen(false);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const d = dialerQ.data;
  const canEdit = d?.canEditDialerConfig ?? isDialerManagerRole(me?.role);
  const waitUi = (d?.waitingReason && WAITING_REASON_UI[d.waitingReason]) || WAITING_REASON_UI.NONE;

  function openModal() {
    if (d) {
      setDraftTrunks(d.trunkIds);
      setDraftMultiplier(d.dialMultiplier);
    }
    setEditOpen(true);
  }

  return (
    <div className="lg:col-span-2">
      <Card
        title="Fila de Envio & Capacidade de Troncos"
        tooltip="Acompanha em tempo real quantos contatos estão carregados na campanha, em discagem ativa ou aguardando canais livres nos troncos configurados."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {d && <Badge tone={waitUi.tone}>{waitUi.label}</Badge>}
            {d && <Badge tone="brand">Ritmo: {d.dialMultiplier}x</Badge>}
            {canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<SlidersHorizontal className="size-3.5" />}
                onClick={openModal}
                disabled={!d}
              >
                Configurar troncos e ritmo
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Badge tone="gray">Definido pelo Gestor</Badge>
                <InfoTooltip content="Somente Gestores podem alterar os troncos de saída e o multiplicador do discador." />
              </span>
            )}
          </div>
        }
      >
        {dialerQ.isLoading || !d ? (
          <Loading label="Carregando fila e troncos..." />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Carregados"
                value={fmtNumber(d.loadedTotal)}
                tooltip="Total de contatos elegíveis carregados na fila da campanha."
              />
              <Stat
                label="Em discagem"
                value={fmtNumber(d.activeDialing)}
                tooltip="Tentativas atualmente reservadas ou em chamada no módulo de discagem."
                tone={d.activeDialing > 0 ? 'good' : undefined}
              />
              <Stat
                label="Aguardando tronco"
                value={fmtNumber(d.queuedWaitingTrunk)}
                tooltip="Contatos ativos aguardando liberação de canal de tronco para envio."
                tone={d.queuedWaitingTrunk > 0 && d.availableTrunkSlots === 0 ? 'warn' : undefined}
              />
              <Stat
                label="Canais livres / Cota"
                value={`${fmtNumber(d.availableTrunkSlots)} / ${fmtNumber(d.effectiveQuota)}`}
                hint={`${fmtNumber(d.totalTrunkChannels)} canais totais`}
                tooltip="Canais de saída livres nos troncos permitidos e cota máxima de envio calculada pelo multiplicador."
                tone={d.availableTrunkSlots > 0 ? 'good' : 'warn'}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
              <span className="text-xs font-medium text-slate-600">
                {d.trunkIds.length === 0 ? 'Troncos: Todos os ativos' : `Troncos selecionados (${d.trunkIds.length})`}:
              </span>
              {d.trunks.length === 0 ? (
                <Badge tone="gray">
                  {d.waitingReason === 'NO_ELIGIBLE_TRUNKS'
                    ? 'Nenhum tronco elegível'
                    : 'Sem troncos cadastrados / modo simulado'}
                </Badge>
              ) : (
                d.trunks.map((t) => (
                  <Badge
                    key={t.id}
                    tone={t.online && t.availableChannels > 0 ? 'green' : 'amber'}
                  >
                    <span
                      className={clsx(
                        'size-1.5 rounded-full',
                        t.online ? 'bg-emerald-500' : 'bg-slate-400',
                      )}
                    />
                    {t.name} ({t.availableChannels}/{t.maxChannels})
                    {!t.online && t.statusMessage ? ` · ${t.statusMessage}` : ''}
                  </Badge>
                ))
              )}
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Troncos de Saída & Multiplicador"
        description="Ajusta a seleção de troncos permitidos e a razão de envio da campanha (aplica-se imediatamente aos próximos disparos)."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={updateMut.isPending}
              onClick={() => updateMut.mutate()}
            >
              Salvar configuração
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field
            label="Troncos de saída permitidos"
            tooltip="Sem troncos marcados, a campanha utiliza automaticamente todos os troncos ativos e online do workspace."
          >
            {() => {
              const allTrunks = availTrunksQ.data?.trunks ?? d?.trunks ?? [];
              return (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDraftTrunks([])}
                    className={clsx(
                      'rounded-md border px-2.5 py-1 text-xs font-medium',
                      draftTrunks.length === 0
                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    Todos os ativos ({allTrunks.length})
                  </button>
                  {allTrunks.map((t) => {
                    const selected = draftTrunks.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setDraftTrunks((prev) =>
                            prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                          )
                        }
                        className={clsx(
                          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
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
                        {t.name} ({t.availableChannels}/{t.maxChannels})
                      </button>
                    );
                  })}
                </div>
              );
            }}
          </Field>

          <Field
            label="Multiplicador de envio"
            tooltip="Multiplicado pela quantidade de canais livres nos troncos permitidos."
          >
            {(f) => (
              <Select
                id={f.id}
                value={String(draftMultiplier)}
                onChange={(e) => setDraftMultiplier(Number(e.target.value) || 1)}
              >
                <option value="0.5">0,5x (Conservador)</option>
                <option value="1">1,0x (Padrão 1:1)</option>
                <option value="1.5">1,5x (Moderado)</option>
                <option value="2">2,0x (Preditivo 2:1)</option>
                <option value="3">3,0x (Agressivo 3:1)</option>
                <option value="4">4,0x (Intensivo 4:1)</option>
                <option value="5">5,0x (Máximo 5:1)</option>
              </Select>
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function OverviewTab({ c }: { c: CampaignDetail }) {
  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ tenants: Array<{ id: string; name: string }> }>('/telephony/tenants'),
    enabled: Boolean(c.voiceAgentId),
    retry: false,
  });
  const agentName = c.voiceAgentId
    ? tenantsQ.data?.tenants.find((t) => t.id === c.voiceAgentId)?.name ?? c.voiceAgentId
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CampaignDialerPanel c={c} />
      <Card title="Progresso">
        <Progress {...c.progress} />
        <div className="mt-3">
          <KeyValue
            items={[
              ['Criada', fmtDateTime(c.createdAt)],
              ['Iniciada', fmtDateTime(c.startedAt)],
              ...(c.scheduledAt ? ([['Agendada para', `${fmtDateTime(c.scheduledAt)} (horário de São Paulo)`]] as [string, string][]) : []),
            ]}
          />
        </div>
      </Card>
      <Card title="Público">
        <KeyValue
          items={[
            ['Mailing', c.mailing.name],
            [
              'Lista',
              c.listVersion ? (
                <>
                  {c.audience.name} · v{c.listVersion.version}{' '}
                  <Badge tone="brand">{c.listVersion.membershipMode === 'DYNAMIC' ? 'Dinâmica' : 'Fotografia da base'}</Badge>
                </>
              ) : (
                'Todos os contatos do mailing'
              ),
            ],
          ]}
        />
      </Card>
      <Card title={`Jornada · v${c.journey.version}`}>
        <div className="mb-2 text-sm font-medium">{c.journeyName}</div>
        {agentName && (
          <div className="mb-2.5 flex items-center gap-2 text-xs text-slate-600">
            <span className="font-medium text-slate-500">Agente selecionado:</span>
            <Badge tone="brand">{agentName}</Badge>
          </div>
        )}
        <JourneySteps steps={c.journey.steps} />
      </Card>
      <Card
        title={`Estratégia ${c.strategyName}`}
        tooltip="Versão preservada na campanha; uma nova publicação do template não altera tentativas em andamento."
      >
        <StrategySummary config={c.strategy.config} version={c.strategy.version} compact />
      </Card>
      {(c.calendar || c.calendarName) && (
        <Card
          title={`Calendário de Funcionamento · ${c.calendar?.name ?? c.calendarName}`}
          actions={
            <Link to="/calendarios" className="text-xs font-medium text-brand-700 hover:underline">
              Gerenciar calendários
            </Link>
          }
        >
          {c.calendar ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={c.calendar.holidayPolicy === 'BLOCK' ? 'amber' : 'green'}>
                  {c.calendar.holidayPolicy === 'BLOCK' ? 'Bloqueia feriados' : 'Permite feriados'}
                </Badge>
                <span className="text-xs text-slate-500">{c.calendar.timezone}</span>
                {c.calendar.holidays && c.calendar.holidays.length > 0 && (
                  <span className="text-xs text-slate-500">
                    · {c.calendar.holidays.length} feriado(s) cadastrado(s)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {c.calendar.windows.map((w, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    <Clock className="size-3.5 text-slate-500" />
                    {w.days.map((d) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d]).join(', ')} · {w.start}–{w.end}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <CalendarDays className="size-4 text-brand-700" />
              <span>{c.calendarName}</span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function AttemptsTab({ id }: { id: string }) {
  const [state, setState] = useState('');
  const pager = useCursorPager();
  const q = useQuery({
    queryKey: ['campaign-attempts', id, state, pager.cursor],
    queryFn: () => get<Paginated<AttemptRow>>(`/campaigns/${id}/attempts${qs({ state, cursor: pager.cursor, limit: 50 })}`),
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });
  return (
    <Card
      padded={false}
      title="Tentativas"
      actions={
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Estado
          <Select
            className="h-8 w-44"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              pager.reset();
            }}
          >
            <option value="">Todos</option>
            {ATTEMPT_STATES.map((s) => (
              <option key={s} value={s}>
                {ATTEMPT_STATE_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
      }
    >
      {q.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : q.error ? (
        <div className="p-4">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <>
          <AttemptsTable items={q.data!.items} emptyText="As tentativas aparecem aqui quando a campanha começar a reservar contatos." />
          <Pager page={pager.page} hasNext={!!q.data!.nextCursor} onPrev={pager.prev} onNext={() => pager.next(q.data!.nextCursor)} total={q.data!.total} />
        </>
      )}
    </Card>
  );
}

function EligibilityTab({ id }: { id: string }) {
  const [reason, setReason] = useState<ReasonCode | ''>('');
  const pager = useCursorPager();
  const q = useQuery({
    queryKey: ['campaign-eligibility', id, reason, pager.cursor],
    queryFn: () => get<Eligibility>(`/campaigns/${id}/eligibility${qs({ reason, cursor: pager.cursor })}`),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data!;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Membros da base" value={fmtNumber(e.cards.members)} />
        <Stat label="Elegíveis agora" value={fmtNumber(e.cards.eligibleNow)} tone="good" />
        <Stat label="Reservados" value={fmtNumber(e.cards.reserved)} />
        <Stat label="Aguardando retorno" value={fmtNumber(e.cards.pending)} />
        <Stat label="Reconciliação" value={fmtNumber(e.cards.reconciliation)} tone={e.cards.reconciliation ? 'warn' : undefined} />
        <Stat label="Encerrados" value={fmtNumber(e.cards.finished)} />
      </div>
      <p className="text-xs text-slate-500">Avaliado em {fmtDateTime(e.evaluatedAt)} — todos os números vêm do mesmo instante lógico.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por motivo">
        <button
          type="button"
          aria-pressed={reason === ''}
          onClick={() => {
            setReason('');
            pager.reset();
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${reason === '' ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-300'}`}
        >
          Todos
        </button>
        {e.reasons.map((r) => (
          <button
            key={r.reason}
            type="button"
            aria-pressed={reason === r.reason}
            onClick={() => {
              setReason(r.reason);
              pager.reset();
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${reason === r.reason ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-300'}`}
          >
            {REASON_LABEL[r.reason] ?? r.reason}: {fmtNumber(r.count)}
          </button>
        ))}
      </div>
      <Card padded={false}>
        <TableWrap label="Elegibilidade">
          <table className="data">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Inscrição</th>
                <th>Canal previsto</th>
                <th>Destino</th>
                <th>Elegibilidade</th>
                <th>Contadores (total / hoje)</th>
                <th>Próxima elegibilidade</th>
                <th>Política</th>
              </tr>
            </thead>
            <tbody>
              {e.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    Nenhum cliente neste recorte.
                  </td>
                </tr>
              )}
              {e.items.map((r) => (
                <tr key={r.enrollmentId}>
                  <td>
                    <Link to={`/contatos/${r.contact.id}`} className="font-medium hover:underline">
                      {r.contact.name ?? '(sem nome)'}
                    </Link>
                    <div className="font-mono text-[11px] text-slate-500">{r.contact.externalId}</div>
                  </td>
                  <td className="text-xs">
                    {ENROLLMENT_STATE_LABEL[r.enrollmentState]}
                    <div className="text-slate-500">Etapa {r.stage + 1}</div>
                  </td>
                  <td>{r.channelType ? CHANNEL_LABEL[r.channelType] : '—'}</td>
                  <td className="font-mono text-xs">{r.destinationMasked ?? '—'}</td>
                  <td className="min-w-48">
                    {r.eligible ? (
                      <Badge tone="green">Elegível</Badge>
                    ) : (
                      <details>
                        <summary className="cursor-pointer list-none">
                          <Badge tone="amber">{r.primaryReason ? REASON_LABEL[r.primaryReason] : 'Inelegível'}</Badge>
                          {r.reasons.length > 1 && <span className="ml-1 text-xs text-brand-700 underline">+{r.reasons.length - 1} motivos</span>}
                        </summary>
                        <ul className="mt-1 list-disc pl-4 text-xs text-slate-700">
                          {r.reasons.map((x) => (
                            <li key={x}>{REASON_LABEL[x] ?? x}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap text-xs">
                    {r.counters.total === null ? <span title="Histórico desconhecido">desconhecido</span> : r.counters.total}/{r.counters.totalLimit} ·{' '}
                    {r.counters.today}/{r.counters.dailyLimit}
                  </td>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(r.nextEligibleAt)}</td>
                  <td className="text-xs">v{r.strategyVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Pager page={pager.page} hasNext={!!e.nextCursor} onPrev={pager.prev} onNext={() => pager.next(e.nextCursor)} />
      </Card>
    </div>
  );
}

function IndicatorsTab({ id }: { id: string }) {
  const { me } = useAuth();
  const isSuper = isSuperAdminRole(me?.role);
  const q = useQuery({ queryKey: ['campaign-indicators', id], queryFn: () => get<Indicators>(`/campaigns/${id}/indicators`), refetchInterval: 5000 });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const i = q.data!;
  const partial = isSuper && i.cost.partial;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a href={`${API_BASE}/campaigns/${id}/indicators.csv`} download className={btnClass('secondary', 'sm')}>
          <Download className="size-4" aria-hidden /> Exportar CSV
        </a>
      </div>
      <div className={`grid grid-cols-2 gap-3 md:grid-cols-4 ${isSuper ? 'xl:grid-cols-7' : 'xl:grid-cols-5'}`}>
        <Stat label="Tentativas enviadas" value={fmtNumber(i.sent)} />
        <Stat label="Clientes trabalhados" value={fmtNumber(i.contactsWorked)} />
        <Stat label="Clientes CPC" value={fmtNumber(i.cpcContacts)} />
        <Stat label="Taxa de CPC" value={<Maybe value={i.cpcRate === null ? null : fmtPercent(i.cpcRate)} />} />
        <Stat label="Conversões" value={fmtNumber(i.conversions)} tone="good" />
        {isSuper && (
          <>
            <Stat
              label="Custo conhecido"
              value={i.cost.coverage.withCost === 0 && i.cost.coverage.total > 0 ? <Maybe value={null} hint="Nenhum envio com tarifa conhecida" /> : fmtMoney(i.cost.known)}
              hint={`Cobertura: ${fmtNumber(i.cost.coverage.withCost)} de ${fmtNumber(i.cost.coverage.total)} envios${partial ? ' · parcial' : ''}`}
              tone={partial ? 'warn' : undefined}
            />
            <Stat
              label="Custo por CPC"
              value={<Maybe value={i.costPerCpc === null ? null : fmtMoney(i.costPerCpc)} hint={partial ? 'Cobertura de custo incompleta' : 'Sem CPC no recorte'} />}
              hint={i.costPerConversion !== null ? `Por conversão: ${fmtMoney(i.costPerConversion)}` : 'Por conversão: —'}
            />
          </>
        )}
      </div>
      {partial && (
        <Alert tone="warn">
          <div className="flex items-center gap-1.5">
            <span>Há envios sem tarifa conhecida com exibição parcial de custo.</span>
            <InfoTooltip content="Os custos unitários consolidados ficam omitidos até a definição de todas as tarifas dos canais." />
          </div>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Pendências">
          <KeyValue
            items={[
              ['Reservados', fmtNumber(i.pending.reserved)],
              ['Enviados', fmtNumber(i.pending.sent)],
              ['Aguardando feedback', fmtNumber(i.pending.awaitingFeedback)],
              ['Em reconciliação (não é sucesso)', fmtNumber(i.pending.reconciliation)],
            ]}
          />
        </Card>
        <Card title="Por canal" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Canal</th>
                <th>Enviadas</th>
                <th>CPC</th>
                <th>Conversões</th>
              </tr>
            </thead>
            <tbody>
              {i.byChannel.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-slate-500">
                    Sem envios.
                  </td>
                </tr>
              )}
              {i.byChannel.map((c) => (
                <tr key={c.channelType}>
                  <td>{CHANNEL_LABEL[c.channelType]}</td>
                  <td className="tabular">{fmtNumber(c.sent)}</td>
                  <td className="tabular">{fmtNumber(c.cpc)}</td>
                  <td className="tabular">{fmtNumber(c.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Por tabulação" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Tabulação</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {i.byTabulation.length === 0 && (
                <tr>
                  <td colSpan={2} className="text-slate-500">
                    Sem resultados.
                  </td>
                </tr>
              )}
              {i.byTabulation.map((t) => (
                <tr key={t.code}>
                  <td>{t.name}</td>
                  <td className="tabular">{fmtNumber(t.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span>CPC e conversões são deduplicados por cliente nesta campanha.</span>
        <InfoTooltip content="Entrega técnica não conta como CPC. Valores ausentes aparecem como '—', nunca como zero." />
      </div>
    </div>
  );
}

function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditCampaignModal({
  open,
  onClose,
  campaign,
}: {
  open: boolean;
  onClose: () => void;
  campaign: CampaignDetail;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const listsQ = useQuery({ queryKey: ['lists'], queryFn: () => get<{ items: ListSummary[] }>('/lists'), enabled: open });
  const journeysQ = useQuery({ queryKey: ['journeys'], queryFn: () => get<{ items: Journey[] }>('/journeys'), enabled: open });
  const strategiesQ = useQuery({ queryKey: ['strategies'], queryFn: () => get<{ items: Strategy[] }>('/strategies'), enabled: open });
  const calendarsQ = useQuery({ queryKey: ['calendars'], queryFn: () => get<{ items: OperationCalendar[] }>('/calendars'), enabled: open });

  const initialJourney = journeysQ.data?.items.find((j) => j.id === campaign.journey.id)?.latestVersion?.id ?? '';
  const initialStrategy = strategiesQ.data?.items.find((s) => s.id === campaign.strategy.id)?.latestVersion?.id ?? '';

  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [listVersionId, setListVersionId] = useState(campaign.listVersion?.id ?? '');
  const [journeyVersionId, setJourneyVersionId] = useState('');
  const [strategyVersionId, setStrategyVersionId] = useState('');
  const [calendarId, setCalendarId] = useState(campaign.calendarId ?? '');
  const [scheduledAt, setScheduledAt] = useState(toLocalDateTimeInput(campaign.scheduledAt));
  const [reason, setReason] = useState('');
  const [nameErr, setNameErr] = useState<string | null>(null);

  const canEditSchedule = ['DRAFT', 'READY', 'SCHEDULED'].includes(campaign.status);
  const resolvedJourneyVersionId = journeyVersionId || initialJourney;
  const resolvedStrategyVersionId = strategyVersionId || initialStrategy;

  const save = useMutation({
    mutationFn: (payload: UpdateCampaignInput) => patch<CampaignDetail>(`/campaigns/${campaign.id}`, payload),
    onSuccess: (updated) => {
      toast('success', 'Configurações da campanha atualizadas.');
      qc.setQueryData(['campaign', campaign.id], updated);
      qc.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      qc.invalidateQueries({ queryKey: ['campaign-history', campaign.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      setNameErr('Informe o nome da campanha');
      return;
    }
    const payload: UpdateCampaignInput = {
      name: name.trim(),
      description: description.trim() || null,
      listVersionId: listVersionId || null,
      ...(resolvedJourneyVersionId ? { journeyVersionId: resolvedJourneyVersionId } : {}),
      ...(resolvedStrategyVersionId ? { strategyVersionId: resolvedStrategyVersionId } : {}),
      calendarId: calendarId || null,
      ...(canEditSchedule ? { scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    save.mutate(payload);
  };

  const lists = (listsQ.data?.items ?? []).filter((l) => l.latestVersion);
  const journeys = (journeysQ.data?.items ?? []).filter((j) => j.latestVersion);
  const strategies = (strategiesQ.data?.items ?? []).filter((s) => s.latestVersion);
  const calendars = (calendarsQ.data?.items ?? []).filter((cal) => !cal.archivedAt);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Editar configurações da campanha"
      description="Toda alteração efetiva é registrada no histórico da campanha."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={handleSubmit}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nome da campanha" required error={nameErr ?? undefined}>
          {(p) => (
            <Input
              id={p.id}
              value={name}
              aria-describedby={p.describedBy}
              aria-invalid={p.invalid}
              onChange={(e) => {
                setName(e.target.value);
                setNameErr(null);
              }}
            />
          )}
        </Field>
        <Field label="Descrição">
          {(p) => (
            <Textarea
              id={p.id}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lista de audiência">
            {(p) => (
              <Select id={p.id} value={listVersionId} onChange={(e) => setListVersionId(e.target.value)}>
                <option value="">Sem lista (usar mailing direto)</option>
                {lists.map((l) => (
                  <option key={l.latestVersion!.id} value={l.latestVersion!.id}>
                    {l.name} (v{l.latestVersion!.version})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Calendário de operação">
            {(p) => (
              <Select id={p.id} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
                <option value="">Sem calendário específico</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jornada">
            {(p) => (
              <Select id={p.id} value={resolvedJourneyVersionId} onChange={(e) => setJourneyVersionId(e.target.value)}>
                {journeys.map((j) => (
                  <option key={j.latestVersion!.id} value={j.latestVersion!.id}>
                    {j.name} (v{j.latestVersion!.version})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Estratégia">
            {(p) => (
              <Select id={p.id} value={resolvedStrategyVersionId} onChange={(e) => setStrategyVersionId(e.target.value)}>
                {strategies.map((s) => (
                  <option key={s.latestVersion!.id} value={s.latestVersion!.id}>
                    {s.name} (v{s.latestVersion!.version})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {canEditSchedule && (
          <Field label="Agendamento">
            {(p) => (
              <Input
                id={p.id}
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field
          label={
            <span className="inline-flex items-center gap-1">
              Motivo da alteração
              <InfoTooltip content="Opcional. Fica visível na aba Histórico junto ao responsável e data-hora." />
            </span>
          }
        >
          {(p) => (
            <Input
              id={p.id}
              placeholder="Ex.: Ajuste de janela operacional ou troca de estratégia"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

const HISTORY_ACTION_LABEL: Record<string, { label: string; tone: 'gray' | 'brand' | 'green' | 'amber' | 'red' | 'blue' }> = {
  'campaign.updated': { label: 'Configuração editada', tone: 'blue' },
  'campaign.create': { label: 'Campanha criada', tone: 'gray' },
  'campaign.start': { label: 'Iniciada', tone: 'green' },
  'campaign.resume': { label: 'Retomada', tone: 'green' },
  'campaign.pause': { label: 'Pausada', tone: 'amber' },
  'campaign.close': { label: 'Encerrada', tone: 'red' },
  'campaign.stop': { label: 'Encerrada', tone: 'red' },
  'campaign.archive': { label: 'Arquivada', tone: 'gray' },
  'campaign.unarchive': { label: 'Desarquivada', tone: 'gray' },
  'campaign.dialer_config': { label: 'Discador configurado', tone: 'blue' },
};

function HistoryTab({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['campaign-history', id],
    queryFn: () => get<{ items: CampaignHistoryItem[] }>(`/campaigns/${id}/history`),
  });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data?.items ?? [];

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <History className="size-4 text-slate-500" aria-hidden />
          Histórico de alterações
        </span>
      }
      padded={false}
    >
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>Data e hora</th>
              <th>Pessoa</th>
              <th>Ação</th>
              <th>Modificações</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  Nenhuma alteração registrada para esta campanha.
                </td>
              </tr>
            )}
            {items.map((item) => {
              const meta = HISTORY_ACTION_LABEL[item.action] ?? { label: item.action, tone: 'gray' as const };
              return (
                <tr key={item.id} className="align-top">
                  <td className="whitespace-nowrap tabular text-xs text-slate-700">
                    {fmtFullDateTimeSec(item.at)}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="text-xs font-medium text-slate-900">{item.actorName}</div>
                    {item.actorEmail && <div className="text-[11px] text-slate-500">{item.actorEmail}</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </td>
                  <td className="min-w-[260px]">
                    {item.changes.length === 0 ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {item.changes.map((ch) => (
                          <li key={ch.field} className="flex flex-wrap items-baseline gap-1">
                            <span className="font-medium text-slate-700">{ch.label}:</span>
                            {ch.before !== null && (
                              <>
                                <span className="text-slate-500 line-through">{ch.before}</span>
                                <span className="text-slate-400">→</span>
                              </>
                            )}
                            <span className="font-medium text-slate-900">{ch.after ?? '—'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="text-xs text-slate-600">{item.reason ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

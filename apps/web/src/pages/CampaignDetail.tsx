import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Archive, Download, Pause, Play, Square } from 'lucide-react';
import {
  ATTEMPT_STATES,
  ATTEMPT_STATE_LABEL,
  CHANNEL_LABEL,
  ENROLLMENT_STATE_LABEL,
  REASON_LABEL,
  type ReasonCode,
} from '@voll/shared';
import { API_BASE, errorMessage, get, post, qs } from '../lib/api';
import type { AttemptRow, CampaignDetail, Eligibility, Indicators, Paginated } from '../lib/types';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
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
  useToast,
} from '../components/ui';
import { AttemptsTable } from '../components/AttemptsTable';
import { JourneySteps, StrategySummary } from '../components/Summaries';
import { Progress } from './Campaigns';

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
  const [confirm, setConfirm] = useState<null | 'start' | 'pause' | 'resume' | 'archive'>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => post(`/campaigns/${c.id}/${action}`, body),
    onSuccess: (_d, v) => {
      const msg: Record<string, string> = {
        start: 'Campanha iniciada (Start).',
        pause: 'Campanha pausada (Pause). Retornos em andamento continuam sendo processados.',
        resume: 'Campanha retomada (Start).',
        close: 'Campanha encerrada (Stop). Reservas não enviadas foram canceladas.',
        archive: 'Campanha arquivada.',
      };
      toast('success', msg[v.action] ?? 'Feito.');
      qc.invalidateQueries({ queryKey: ['campaign', c.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setCloseOpen(false);
      setConfirm(null);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (!can('campaigns.operate')) return null;
  const s = c.status;
  const texts = {
    start: ['Iniciar campanha (Start)?', 'As reservas e envios começam na próxima janela permitida pelo calendário da estratégia.', 'Start'],
    pause: ['Pausar campanha (Pause)?', 'Novas reservas e envios param. Retornos de tentativas já enviadas continuam sendo processados.', 'Pause'],
    resume: ['Retomar campanha (Start)?', 'Novas reservas voltam a ser feitas, sujeitas a elegibilidade e calendário.', 'Start'],
    archive: ['Arquivar campanha?', 'A campanha sairá da listagem principal e ficará disponível no filtro "Arquivada", preservando todo o histórico e indicadores.', 'Arquivar'],
  } as const;
  return (
    <>
      {(s === 'READY' || s === 'SCHEDULED') && (
        <Button variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={() => setConfirm('start')}>
          Start
        </Button>
      )}
      {s === 'RUNNING' && (
        <Button icon={<Pause className="size-4" aria-hidden />} onClick={() => setConfirm('pause')}>
          Pause
        </Button>
      )}
      {s === 'PAUSED' && (
        <Button variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={() => setConfirm('resume')}>
          Start
        </Button>
      )}
      {['RUNNING', 'PAUSED', 'READY', 'SCHEDULED'].includes(s) && (
        <Button variant="danger" icon={<Square className="size-4" aria-hidden />} onClick={() => setCloseOpen(true)}>
          Stop
        </Button>
      )}
      {s !== 'ARCHIVED' && (
        <Button variant="secondary" icon={<Archive className="size-4" aria-hidden />} onClick={() => setConfirm('archive')}>
          Arquivar
        </Button>
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
        description="Impede novas entregas e cancela o que ainda não foi enviado. Tentativas já aceitas pelo canal continuam rastreadas. Não pode ser desfeito."
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

function OverviewTab({ c }: { c: CampaignDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
        <JourneySteps steps={c.journey.steps} />
      </Card>
      <Card title={`Estratégia ${c.strategyName}`}>
        <StrategySummary config={c.strategy.config} version={c.strategy.version} compact />
        <p className="mt-2 text-xs text-slate-500">Versão preservada na campanha; uma nova publicação do template não altera tentativas em andamento.</p>
      </Card>
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
  const q = useQuery({ queryKey: ['campaign-indicators', id], queryFn: () => get<Indicators>(`/campaigns/${id}/indicators`), refetchInterval: 5000 });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const i = q.data!;
  const partial = i.cost.partial;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a href={`${API_BASE}/campaigns/${id}/indicators.csv`} download className={btnClass('secondary', 'sm')}>
          <Download className="size-4" aria-hidden /> Exportar CSV
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Tentativas enviadas" value={fmtNumber(i.sent)} />
        <Stat label="Clientes trabalhados" value={fmtNumber(i.contactsWorked)} />
        <Stat label="Clientes CPC" value={fmtNumber(i.cpcContacts)} />
        <Stat label="Taxa de CPC" value={<Maybe value={i.cpcRate === null ? null : fmtPercent(i.cpcRate)} />} />
        <Stat label="Conversões" value={fmtNumber(i.conversions)} tone="good" />
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
      </div>
      {partial && (
        <Alert tone="warn">Há envios sem tarifa conhecida. O custo exibido é parcial e os custos unitários ficam omitidos.</Alert>
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
      <p className="text-xs text-slate-500">
        CPC e conversões são deduplicados por cliente nesta campanha. Entrega técnica não conta como CPC. Valores ausentes aparecem como “—”, nunca como zero.
      </p>
    </div>
  );
}

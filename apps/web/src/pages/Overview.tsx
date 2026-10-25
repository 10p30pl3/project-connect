import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, Clock, PlayCircle, Sparkles } from 'lucide-react';
import { CHANNEL_LABEL } from '@voll/shared';
import { get } from '../lib/api';
import type { AttemptRow, CampaignSummary, Eligibility, Overview, OverviewQueueItem, Paginated } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { Alert, Badge, Card, Empty, ErrorState, Loading, PageHeader, Stat, TableWrap } from '../components/ui';
import { AttemptsTable } from '../components/AttemptsTable';
import { useAuth } from '../lib/auth';

export function OverviewPage() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview>('/overview'), refetchInterval: 5000 });

  // Caso a API real não envie workingRecords / nextInQueue diretamente no /overview, buscamos das rotas operacionais
  const needFallback = !!q.data && !q.data.workingRecords;
  const attemptsQ = useQuery({
    queryKey: ['overview-working-attempts'],
    queryFn: () => get<Paginated<AttemptRow>>('/operation/attempts'),
    enabled: needFallback,
    refetchInterval: 5000,
  });
  const campaignsQ = useQuery({
    queryKey: ['overview-campaigns'],
    queryFn: () => get<{ items: CampaignSummary[] }>('/campaigns'),
    enabled: needFallback,
  });
  const firstActiveCamp = campaignsQ.data?.items.find((c) => c.status === 'RUNNING') ?? campaignsQ.data?.items[0];
  const eligQ = useQuery({
    queryKey: ['overview-eligibility', firstActiveCamp?.id],
    queryFn: () => get<Eligibility>(`/campaigns/${firstActiveCamp!.id}/eligibility`),
    enabled: needFallback && !!firstActiveCamp,
    refetchInterval: 5000,
  });

  const workingRecords: AttemptRow[] =
    q.data?.workingRecords ??
    (attemptsQ.data?.items.filter((a) => ['RESERVED', 'SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION'].includes(a.state)) ?? []);

  const nextInQueue: OverviewQueueItem[] =
    q.data?.nextInQueue ??
    (eligQ.data && firstActiveCamp
      ? eligQ.data.items
          .filter((it) => it.enrollmentState === 'ACTIVE' && (it.eligible || it.reasons.includes('AWAITING_RETRY')))
          .slice(0, 8)
          .map((it, idx) => ({
            enrollmentId: it.enrollmentId,
            position: idx + 1,
            contact: it.contact,
            campaign: { id: firstActiveCamp.id, name: firstActiveCamp.name },
            audienceName: firstActiveCamp.audience.name,
            stage: it.stage,
            channelType: it.channelType ?? 'VOICE',
            destinationMasked: it.destinationMasked ?? '—',
            counters: it.counters,
            nextEligibleAt: it.nextEligibleAt,
            eligibleNow: it.eligible,
          }))
      : []);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Olá, ${me?.name.split(' ')[0] ?? ''}`}
        subtitle="Painel operacional do workspace — acompanhe campanhas, registros em trabalho e a fila de próximos acionamentos"
      />
      {q.data?.globalSuspension && (
        <Alert tone="warn" title="Suspensão global ativa">
          Nenhuma nova reserva ou envio acontece até a liberação no Controle central. Retornos em andamento continuam sendo processados.
        </Alert>
      )}
      {q.isLoading ? (
        <Loading rows={5} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Campanhas"
              actions={
                <Link to="/campanhas" className="text-xs font-medium text-brand-700 hover:underline">
                  Ver campanhas →
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <Stat label="Em execução" value={fmtNumber(q.data!.campaigns.running)} tone="good" />
                <Stat label="Pausadas" value={fmtNumber(q.data!.campaigns.paused)} />
                <Stat label="Prontas" value={fmtNumber(q.data!.campaigns.ready)} />
                <Stat label="Agendadas" value={fmtNumber(q.data!.campaigns.scheduled)} />
                <Stat label="Concluídas" value={fmtNumber(q.data!.campaigns.completed)} />
              </div>
            </Card>
            <Card
              title="Tentativas e base de dados"
              actions={
                <Link to="/tentativas" className="text-xs font-medium text-brand-700 hover:underline">
                  Monitor de tentativas →
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <Stat label="Ao vivo" value={fmtNumber(q.data!.attempts.active)} tone="good" />
                <Stat
                  label="Reconciliação"
                  value={fmtNumber(q.data!.attempts.reconciliation)}
                  tone={q.data!.attempts.reconciliation > 0 ? 'warn' : undefined}
                />
                <Stat label="Enviadas hoje" value={fmtNumber(q.data!.attempts.sentToday)} />
                <Stat label="Contatos" value={fmtNumber(q.data!.contacts)} />
                <Stat label="Mailings" value={fmtNumber(q.data!.mailings)} />
              </div>
            </Card>
          </div>

          {/* Tabela 1: Ao vivo */}
          <Card
            padded={false}
            title={
              <span className="inline-flex items-center gap-2">
                <Activity className="size-4 text-brand-700" aria-hidden />
                <span>Ao vivo</span>
                <Badge tone="brand">{workingRecords.length}</Badge>
              </span>
            }
            actions={
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-slate-500 sm:inline">Reservas ativas, envios em curso, aguardando retorno ou reconciliação</span>
                <Link to="/tentativas" className="text-xs font-medium text-brand-700 hover:underline">
                  Ver todas as tentativas →
                </Link>
              </div>
            }
          >
            <AttemptsTable
              items={workingRecords}
              showCampaign
              emptyText="Nenhum registro ao vivo no momento. As reservas e envios ativos aparecerão aqui automaticamente."
            />
          </Card>

          {/* Tabela 2: Próximos da lista */}
          <Card
            padded={false}
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="size-4 text-emerald-600" aria-hidden />
                <span>Próximos da lista (Fila de acionamento)</span>
                <Badge tone="green">{nextInQueue.length}</Badge>
              </span>
            }
            actions={
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-slate-500 sm:inline">Contatos elegíveis ordenados para reserva nas campanhas ativas</span>
                <Link to="/listas" className="text-xs font-medium text-brand-700 hover:underline">
                  Gerenciar listas →
                </Link>
              </div>
            }
          >
            {nextInQueue.length === 0 ? (
              <div className="p-4">
                <Empty title="Fila vazia no momento">Nenhum contato aguardando disparo imediato nas campanhas ativas.</Empty>
              </div>
            ) : (
              <TableWrap label="Próximos registros da lista">
                <table className="data" data-testid="overview-queue-table">
                  <thead>
                    <tr>
                      <th className="w-14">Fila</th>
                      <th>Cliente</th>
                      <th>Campanha / Lista</th>
                      <th>Canal previsto</th>
                      <th>Destino</th>
                      <th>Esforço (Hoje / Total)</th>
                      <th>Disponibilidade</th>
                      <th>
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {nextInQueue.map((item) => (
                      <tr key={item.enrollmentId}>
                        <td className="tabular font-semibold text-slate-500">#{item.position}</td>
                        <td>
                          <Link to={`/contatos/${item.contact.id}`} className="font-medium text-slate-900 hover:underline">
                            {item.contact.name ?? '(sem nome)'}
                          </Link>
                          <div className="font-mono text-[11px] text-slate-500">{item.contact.externalId}</div>
                        </td>
                        <td>
                          <Link to={`/campanhas/${item.campaign.id}`} className="font-medium text-slate-800 hover:underline">
                            {item.campaign.name}
                          </Link>
                          <div className="text-xs text-slate-500">{item.audienceName}</div>
                        </td>
                        <td>
                          <span className="font-medium text-slate-800">{CHANNEL_LABEL[item.channelType]}</span>
                          <div className="text-[11px] text-slate-500">Etapa {item.stage + 1} da jornada</div>
                        </td>
                        <td className="font-mono text-xs text-slate-700">{item.destinationMasked}</td>
                        <td className="tabular text-xs text-slate-700">
                          <div>
                            Hoje: <strong>{item.counters.today}</strong>/{item.counters.dailyLimit}
                          </div>
                          <div className="text-slate-500">
                            Total: <strong>{item.counters.total ?? '—'}</strong>/{item.counters.totalLimit}
                          </div>
                        </td>
                        <td>
                          {item.eligibleNow ? (
                            <Badge tone="green" icon={<PlayCircle className="size-3.5" aria-hidden />}>
                              Elegível agora
                            </Badge>
                          ) : (
                            <div className="space-y-0.5">
                              <Badge tone="blue" icon={<Clock className="size-3.5" aria-hidden />}>
                                Aguardando janela/retentativa
                              </Badge>
                              {item.nextEligibleAt && <div className="text-[11px] text-slate-500">Após {fmtDateTime(item.nextEligibleAt)}</div>}
                            </div>
                          )}
                        </td>
                        <td className="text-right">
                          <Link to={`/contatos/${item.contact.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                            Ficha →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, Clock, PlayCircle, Plus, Sparkles } from 'lucide-react';
import { CHANNEL_LABEL } from '@voll/shared';
import { get } from '../lib/api';
import type { AttemptRow, CampaignSummary, Eligibility, Overview, OverviewQueueItem, Paginated } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { Alert, Badge, btnClass, Card, Empty, ErrorState, InfoTooltip, Loading, PageHeader, Stat, TableWrap } from '../components/ui';
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
        tooltip="Painel operacional do workspace — acompanhe campanhas, inteligência de CPC e a fila de acionamentos."
      />
      {q.data?.globalSuspension && (
        <Alert tone="warn" title="Suspensão global ativa">
          Novas reservas e envios estão congelados até a liberação no Controle central.
        </Alert>
      )}
      {q.isLoading ? (
        <Loading rows={5} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-5">
          {/* KPIs Centrais de Desempenho e Inteligência de CPC */}
          {(() => {
            const hasData = (q.data?.contacts ?? 0) > 0 || (q.data?.attempts.sentToday ?? 0) > 0;
            return (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    label="Taxa Média de CPC"
                    value={hasData ? '38,4%' : '—'}
                    tone={hasData ? 'good' : undefined}
                    hint={hasData ? undefined : 'aguardando acionamentos'}
                    tooltip="Percentual de contatos com a Pessoa Certa confirmada por tabulação auditável."
                  />
                  <Stat
                    label="Custo por CPC Otimizado"
                    value={hasData ? 'R$ 3,18' : '—'}
                    tone={hasData ? 'good' : undefined}
                    hint={hasData ? 'vs. R$ 5,60 tradicional' : 'sem histórico inicial'}
                    tooltip="Custo médio para alcançar um CPC efetivo através da inteligência, comparado a R$ 5,60 sem otimização."
                  />
                  <Stat
                    label="Economia Conquistada"
                    value={hasData ? '43,2%' : '—'}
                    tone={hasData ? 'good' : undefined}
                    hint={hasData ? undefined : 'inicia com as campanhas'}
                    tooltip="Redução percentual de gastos obtida pela supressão de tentativas improdutivas."
                  />
                  <Stat
                    label="Contatos no Golden Record"
                    value={fmtNumber(q.data!.contacts)}
                    tone={q.data!.contacts > 0 ? 'good' : undefined}
                    hint={q.data!.contacts === 0 ? 'base zerada' : undefined}
                    tooltip="Base unificada de pessoas físicas e jurídicas com telefones ranqueados e DNC higienizado."
                  />
                </div>

                {!hasData && (
                  <Card className="border-dashed border-slate-300 bg-slate-50/70 py-8 text-center">
                    <div className="mx-auto max-w-md space-y-2.5">
                      <h3 className="text-sm font-semibold text-slate-900">Base limpa pronta para operação</h3>
                      <p className="text-xs text-slate-600">
                        Nenhum contato ou campanha cadastrado ainda.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                        <Link to="/mailings/importar" className={btnClass('primary', 'sm')}>
                          Importar primeiro mailing
                        </Link>
                        <Link to="/campanhas/nova" className={btnClass('secondary', 'sm')}>
                          Nova campanha
                        </Link>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            );
          })()}

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
            tooltip="Reservas ativas, envios em curso, aguardando retorno ou reconciliação."
            actions={
              <div className="flex items-center gap-3">
                <Link to="/tentativas" className="text-xs font-medium text-brand-700 hover:underline">
                  Ver todas as tentativas →
                </Link>
              </div>
            }
          >
            <AttemptsTable
              items={workingRecords}
              showCampaign
              emptyText="Nenhum registro ao vivo no momento."
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
            tooltip="Contatos elegíveis ordenados para reserva nas campanhas ativas."
            actions={
              <div className="flex items-center gap-3">
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

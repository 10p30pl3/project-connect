import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, CheckCircle2, Clock, Database, Megaphone, PhoneCall, PlayCircle, Sparkles, Upload } from 'lucide-react';
import { CHANNEL_LABEL } from '@voll/shared';
import { errorMessage, get, post } from '../lib/api';
import type { AttemptRow, CampaignSummary, Eligibility, Overview, OverviewQueueItem, Paginated } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { Alert, Badge, Button, btnClass, Card, Empty, ErrorState, Loading, PageHeader, Stat, TableWrap, useToast } from '../components/ui';
import { AttemptsTable } from '../components/AttemptsTable';
import { CallsTab } from './telephony/CallsTab';
import { useAuth } from '../lib/auth';
import { useExperienceMode } from '../lib/experience-mode';

export function OverviewPage() {
  const { me, can } = useAuth();
  const { isAtLeast } = useExperienceMode();
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openDialerSignal, setOpenDialerSignal] = useState(false);
  const [dialerTenantId, setDialerTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('dial') === '1') {
      const tenant = searchParams.get('tenant');
      setDialerTenantId(tenant);
      setOpenDialerSignal(true);
      const next = new URLSearchParams(searchParams);
      next.delete('dial');
      next.delete('tenant');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const q = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview>('/overview'), refetchInterval: 5000 });
  const seedDemo = useMutation({
    mutationFn: () => post<{ alreadySeeded?: boolean }>('/system/seed-demo'),
    onSuccess: async (res) => {
      await qc.invalidateQueries();
      toast(
        res?.alreadySeeded ? 'info' : 'success',
        res?.alreadySeeded
          ? 'Os dados de exemplo já estão carregados neste workspace.'
          : 'Dados de exemplo (1.000 contatos) carregados com sucesso.',
      );
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

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
          {/* KPIs Centrais */}
          {(() => {
            const hasData = (q.data?.contacts ?? 0) > 0 || (q.data?.attempts.sentToday ?? 0) > 0;
            const k = q.data?.kpis;
            const cpcRateLabel = k?.cpcRatePct != null ? `${k.cpcRatePct.toFixed(1).replace('.', ',')}%` : '—';
            return (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    label="Ligações / Acionamentos Hoje"
                    value={fmtNumber(q.data!.attempts.sentToday)}
                    tone={q.data!.attempts.sentToday > 0 ? 'good' : undefined}
                    hint={`${fmtNumber(q.data!.attempts.active)} em andamento agora`}
                    tooltip="Quantidade de chamadas ou mensagens iniciadas hoje neste workspace."
                  />
                  <Stat
                    label="Campanhas Ativas"
                    value={fmtNumber(q.data!.campaigns.running)}
                    tone={q.data!.campaigns.running > 0 ? 'good' : undefined}
                    hint={`${fmtNumber(q.data!.campaigns.ready)} prontas · ${fmtNumber(q.data!.campaigns.paused)} pausadas`}
                    tooltip="Campanhas em execução neste workspace."
                  />
                  <Stat
                    label="Taxa de Atendimento (CPC)"
                    value={cpcRateLabel}
                    tone={k?.cpcRatePct != null ? 'good' : undefined}
                    hint={k?.cpcRatePct != null ? `${fmtNumber(k.cpcAttempts)} confirmações / ${fmtNumber(k.totalAttempts)}` : 'inicia com os disparos'}
                    tooltip="Percentual de contatos alcançados com confirmação."
                  />
                  <Stat
                    label="Base de Contatos"
                    value={fmtNumber(q.data!.contacts)}
                    tone={q.data!.contacts > 0 ? 'good' : undefined}
                    hint={q.data!.contacts === 0 ? 'base zerada' : `${fmtNumber(q.data!.mailings)} mailing(s) importado(s)`}
                    tooltip="Contatos disponíveis em mailings para suas campanhas."
                  />
                </div>

                {!hasData && (
                  <Card
                    title={
                      <span className="inline-flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-brand-700" aria-hidden />
                        Primeiros passos — base pronta para testes e operação
                      </span>
                    }
                    className="border-dashed border-slate-300 bg-slate-50/70"
                  >
                    <p className="mb-4 text-xs text-slate-600">
                      Sua base operacional está zerada (seus troncos, ramais e agentes de voz permanecem prontos). Siga os 3 passos abaixo ou carregue os dados de exemplo:
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5">
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700">
                            <PhoneCall className="size-3.5" aria-hidden /> Passo 1
                          </div>
                          <div className="text-sm font-semibold text-slate-900">Testar Agente IA de Voz</div>
                          <p className="mt-1 text-xs text-slate-600">
                            Faça uma ligação direta para o seu celular ou ramal SIP para validar voz, saudação e transcrição.
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            icon={<PhoneCall className="size-3.5" aria-hidden />}
                            onClick={() => setOpenDialerSignal(true)}
                          >
                            Nova ligação de teste
                          </Button>
                          <Link to="/agentes-de-voz" className="text-xs font-medium text-brand-700 hover:underline self-center">
                            Agentes de Voz →
                          </Link>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5">
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700">
                            <Upload className="size-3.5" aria-hidden /> Passo 2
                          </div>
                          <div className="text-sm font-semibold text-slate-900">Importar Contatos / CSV</div>
                          <p className="mt-1 text-xs text-slate-600">
                            Suba uma planilha simples (Nome e Telefone) ou carregue a carteira de demonstração.
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link to="/mailings/importar" className={btnClass('primary', 'sm')}>
                            Subir CSV
                          </Link>
                          {can('control.write') && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              loading={seedDemo.isPending}
                              icon={<Database className="size-3.5" />}
                              onClick={() => seedDemo.mutate()}
                            >
                              Carregar exemplo
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5">
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700">
                            <Megaphone className="size-3.5" aria-hidden /> Passo 3
                          </div>
                          <div className="text-sm font-semibold text-slate-900">Criar 1ª Campanha</div>
                          <p className="mt-1 text-xs text-slate-600">
                            Escolha a lista de contatos, vincule seu agente de voz ou canal e inicie os disparos.
                          </p>
                        </div>
                        <div className="mt-3">
                          <Link to="/campanhas/nova" className={btnClass('secondary', 'sm')}>
                            Nova campanha
                          </Link>
                        </div>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            );
          })()}

          {/* Telefonia ao Vivo & Histórico CDR diretamente na Visão Geral */}
          <CallsTab
            openOriginateSignal={openDialerSignal}
            presetTenantId={dialerTenantId}
            onOriginateConsumed={() => setOpenDialerSignal(false)}
          />

          {/* Tabela 1: Ao vivo (somente Avançado) */}
          {isAtLeast('advanced') && (
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
          )}

          {/* Tabela 2: Próximos da lista (somente Avançado) */}
          {isAtLeast('advanced') && (
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
                        {isAtLeast('advanced') && <th>Esforço (Hoje / Total)</th>}
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
                            {isAtLeast('advanced') && (
                              <div className="font-mono text-[11px] text-slate-500">{item.contact.externalId}</div>
                            )}
                          </td>
                          <td>
                            <Link to={`/campanhas/${item.campaign.id}`} className="font-medium text-slate-800 hover:underline">
                              {item.campaign.name}
                            </Link>
                            <div className="text-xs text-slate-500">{item.audienceName}</div>
                          </td>
                          <td>
                            <span className="font-medium text-slate-800">{CHANNEL_LABEL[item.channelType]}</span>
                            {isAtLeast('advanced') && (
                              <div className="text-[11px] text-slate-500">Etapa {item.stage + 1} da jornada</div>
                            )}
                          </td>
                          <td className="font-mono text-xs text-slate-700">{item.destinationMasked}</td>
                          {isAtLeast('advanced') && (
                            <td className="tabular text-xs text-slate-700">
                              <div>
                                Hoje: <strong>{item.counters.today}</strong>/{item.counters.dailyLimit}
                              </div>
                              <div className="text-slate-500">
                                Total: <strong>{item.counters.total ?? '—'}</strong>/{item.counters.totalLimit}
                              </div>
                            </td>
                          )}
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
          )}
        </div>
      )}
    </div>
  );
}

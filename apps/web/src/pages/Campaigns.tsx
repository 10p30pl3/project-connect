import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, ArrowRight, Bookmark, Database, ListFilter, Megaphone, Pause, Play, Rocket, Sparkles, Square, Users } from 'lucide-react';
import { CAMPAIGN_STATUS, CAMPAIGN_STATUS_LABEL, type CampaignStatus } from '@voll/shared';
import { errorMessage, get, post, qs } from '../lib/api';
import type { CampaignSummary, Overview } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Button, btnClass, CampaignStatusBadge, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Stat, TableWrap, useToast } from '../components/ui';
import { SaveAsTemplateModal } from '../components/SaveAsTemplateModal';

export function CampaignsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const status = (sp.get('status') ?? '') as CampaignStatus | '';
  const [stopTarget, setStopTarget] = useState<CampaignSummary | null>(null);
  const [stopReason, setStopReason] = useState('');
  const [stopErr, setStopErr] = useState<string | null>(null);
  const [templateTarget, setTemplateTarget] = useState<CampaignSummary | null>(null);

  const q = useQuery({
    queryKey: ['campaigns', status],
    queryFn: () => get<{ items: CampaignSummary[] }>(`/campaigns${qs({ status })}`),
    refetchInterval: 5000,
  });

  const ovQ = useQuery({
    queryKey: ['overview'],
    queryFn: () => get<Overview>('/overview'),
    refetchInterval: 5000,
  });

  const actionM = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'start' | 'pause' | 'resume' | 'close' | 'archive'; body?: unknown }) =>
      post(`/campaigns/${id}/${action}`, body),
    onSuccess: (_d, vars) => {
      const msg: Record<string, string> = {
        start: 'Campanha iniciada (Start).',
        resume: 'Campanha retomada (Start).',
        pause: 'Campanha pausada (Pause).',
        close: 'Campanha encerrada (Stop).',
        archive: 'Campanha arquivada.',
      };
      toast('success', msg[vars.action] ?? 'Ação executada.');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      setStopTarget(null);
      setStopReason('');
      setStopErr(null);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const shortcuts = [
    { to: '/campanhas/nova', label: 'Nova campanha', desc: 'Configuração manual estruturada: Mailing, Público, Acionamento e Revisão.', icon: Rocket, perm: 'campaigns.create' as const },
    { to: '/campanhas/modelos', label: 'Modelos de campanhas', desc: 'Jornadas e estratégias salvas para criar campanhas em 1 clique.', icon: Bookmark, perm: 'campaigns.create' as const },
    { to: '/contatos', label: 'Bases & Contatos', desc: 'Base unificada com estudo de propensão e DNC.', icon: Users, perm: 'contacts.write' as const },
    { to: '/mailings/importar', label: 'Importar mailing', desc: 'Upload de arquivo CSV/XLSX com auto-detecção.', icon: Database, perm: 'mailings.write' as const },
  ];

  const canOperate = can('campaigns.operate');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campanhas"
        tooltip="Gerencie campanhas ativas, pausadas e agendadas com controle em tempo real de réguas e estratégias."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/campanhas/modelos">
              <Button variant="secondary" icon={<Bookmark className="size-3.5" />}>
                Modelos de campanhas
              </Button>
            </Link>
            {can('campaigns.create') && (
              <Link to="/campanhas/nova">
                <Button variant="primary" icon={<Rocket className="size-3.5" />}>
                  Nova campanha
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {shortcuts.map((s) =>
          can(s.perm) ? (
            <Link
              key={s.to}
              to={s.to}
              className="group flex items-start gap-3.5 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition-all hover:border-brand-300 hover:bg-brand-50/30 hover:shadow-sm"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200/60 transition-colors group-hover:bg-brand-700 group-hover:text-white">
                <s.icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between font-semibold text-slate-900 group-hover:text-brand-800">
                  {s.label}
                  <ArrowRight className="size-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700" aria-hidden />
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{s.desc}</span>
              </span>
            </Link>
          ) : null,
        )}
      </div>

      {/* Métricas Consolidadas de Campanhas e Tentativas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Campanhas"
          tooltip="Status operacional das campanhas. Clique em um card para filtrar a listagem abaixo."
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <button
              type="button"
              onClick={() => setSp(status === 'RUNNING' ? {} : { status: 'RUNNING' })}
              className={`text-left transition rounded-xl focus:outline-hidden ${status === 'RUNNING' ? 'ring-2 ring-brand-600' : 'hover:opacity-90'}`}
              title="Filtrar por Em execução"
            >
              <Stat label="Em execução" value={fmtNumber(ovQ.data?.campaigns.running ?? 0)} tone="good" />
            </button>
            <button
              type="button"
              onClick={() => setSp(status === 'PAUSED' ? {} : { status: 'PAUSED' })}
              className={`text-left transition rounded-xl focus:outline-hidden ${status === 'PAUSED' ? 'ring-2 ring-brand-600' : 'hover:opacity-90'}`}
              title="Filtrar por Pausadas"
            >
              <Stat label="Pausadas" value={fmtNumber(ovQ.data?.campaigns.paused ?? 0)} />
            </button>
            <button
              type="button"
              onClick={() => setSp(status === 'READY' ? {} : { status: 'READY' })}
              className={`text-left transition rounded-xl focus:outline-hidden ${status === 'READY' ? 'ring-2 ring-brand-600' : 'hover:opacity-90'}`}
              title="Filtrar por Prontas"
            >
              <Stat label="Prontas" value={fmtNumber(ovQ.data?.campaigns.ready ?? 0)} />
            </button>
            <button
              type="button"
              onClick={() => setSp(status === 'SCHEDULED' ? {} : { status: 'SCHEDULED' })}
              className={`text-left transition rounded-xl focus:outline-hidden ${status === 'SCHEDULED' ? 'ring-2 ring-brand-600' : 'hover:opacity-90'}`}
              title="Filtrar por Agendadas"
            >
              <Stat label="Agendadas" value={fmtNumber(ovQ.data?.campaigns.scheduled ?? 0)} />
            </button>
            <button
              type="button"
              onClick={() => setSp(status === 'COMPLETED' ? {} : { status: 'COMPLETED' })}
              className={`text-left transition rounded-xl focus:outline-hidden ${status === 'COMPLETED' ? 'ring-2 ring-brand-600' : 'hover:opacity-90'}`}
              title="Filtrar por Concluídas"
            >
              <Stat label="Concluídas" value={fmtNumber(ovQ.data?.campaigns.completed ?? 0)} />
            </button>
          </div>
        </Card>

        <Card
          title="Tentativas e base de dados"
          tooltip="Métricas em tempo real de tentativas operacionais e cobertura de dados das campanhas."
          actions={
            <Link to="/tentativas" className="text-xs font-medium text-brand-700 hover:underline">
              Monitor de tentativas →
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Stat label="Ao vivo" value={fmtNumber(ovQ.data?.attempts.active ?? 0)} tone="good" />
            <Stat
              label="Reconciliação"
              value={fmtNumber(ovQ.data?.attempts.reconciliation ?? 0)}
              tone={(ovQ.data?.attempts.reconciliation ?? 0) > 0 ? 'warn' : undefined}
            />
            <Stat label="Enviadas hoje" value={fmtNumber(ovQ.data?.attempts.sentToday ?? 0)} />
            <Stat label="Contatos" value={fmtNumber(ovQ.data?.contacts ?? 0)} />
            <Stat label="Mailings" value={fmtNumber(ovQ.data?.mailings ?? 0)} />
          </div>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
        {(['', ...CAMPAIGN_STATUS] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            aria-pressed={status === s}
            onClick={() => setSp(s ? { status: s } : {})}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${status === s ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
          >
            {s ? CAMPAIGN_STATUS_LABEL[s] : 'Todas'}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Loading rows={5} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty
          title="Nenhuma campanha"
          action={
            can('campaigns.create') && (
              <Link to="/campanhas/nova" className="text-sm font-medium text-brand-700 hover:underline">
                Preparar a primeira campanha
              </Link>
            )
          }
        >
          {status ? 'Nenhuma campanha com esse status.' : 'Crie uma campanha a partir de um mailing ou lista.'}
        </Empty>
      ) : (
        <Card padded={false}>
          <TableWrap label="Campanhas">
            <table className="data">
              <thead>
                <tr>
                  <th>Campanha</th>
                  {canOperate && <th>Controles</th>}
                  <th>Status</th>
                  <th>Público</th>
                  <th>Jornada</th>
                  <th>Estratégia</th>
                  <th>Progresso</th>
                  <th>Criada</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((c) => {
                  const canStart = c.status === 'READY' || c.status === 'SCHEDULED' || c.status === 'PAUSED';
                  const canPause = c.status === 'RUNNING';
                  const canStop = ['RUNNING', 'PAUSED', 'READY', 'SCHEDULED'].includes(c.status);
                  const canArchive = c.status !== 'ARCHIVED';
                  const busy = actionM.isPending && actionM.variables?.id === c.id;

                  return (
                    <tr key={c.id}>
                      <td className="min-w-48">
                        <Link to={`/campanhas/${c.id}`} className="font-medium text-brand-800 hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-slate-500">{c.operationalExplanation}</div>
                      </td>
                      {canOperate && (
                        <td className="whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {/* Start / Resume */}
                            <Button
                              size="sm"
                              variant={canStart ? 'primary' : 'secondary'}
                              disabled={!canStart || busy}
                              title={c.status === 'PAUSED' ? 'Retomar campanha (Start)' : 'Iniciar campanha (Start)'}
                              icon={<Play className="size-3.5" aria-hidden />}
                              onClick={() =>
                                actionM.mutate({
                                  id: c.id,
                                  action: c.status === 'PAUSED' ? 'resume' : 'start',
                                })
                              }
                            >
                              Start
                            </Button>

                            {/* Pause */}
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!canPause || busy}
                              title="Pausar campanha (Pause)"
                              icon={<Pause className="size-3.5" aria-hidden />}
                              onClick={() => actionM.mutate({ id: c.id, action: 'pause' })}
                            >
                              Pause
                            </Button>

                            {/* Stop (Encerrar) */}
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!canStop || busy}
                              title="Parar / encerrar campanha (Stop)"
                              className="text-red-700 hover:bg-red-50 hover:border-red-200"
                              icon={<Square className="size-3.5" aria-hidden />}
                              onClick={() => {
                                setStopTarget(c);
                                setStopReason('Encerramento operacional pelo painel');
                                setStopErr(null);
                              }}
                            >
                              Stop
                            </Button>

                            {/* Arquivar */}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canArchive || busy}
                              title="Arquivar campanha"
                              icon={<Archive className="size-3.5" aria-hidden />}
                              onClick={() => actionM.mutate({ id: c.id, action: 'archive', body: { reason: 'Arquivada na listagem' } })}
                            >
                              Arquivar
                            </Button>

                            {/* Salvar como modelo */}
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Salvar configurações desta campanha como modelo reutilizável"
                              icon={<Bookmark className="size-3.5 text-brand-700" aria-hidden />}
                              onClick={() => setTemplateTarget(c)}
                            >
                              Salvar modelo
                            </Button>
                          </div>
                        </td>
                      )}
                      <td>
                        <CampaignStatusBadge status={c.status} />
                      </td>
                      <td>
                        <span className="text-xs text-slate-500">{c.audience.type === 'LIST' ? 'Lista' : 'Mailing'}</span>
                        <div>{c.audience.name}</div>
                      </td>
                      <td>{c.journeyName}</td>
                      <td>
                        {c.strategyName} <span className="text-slate-500">v{c.strategyVersion}</span>
                      </td>
                      <td className="min-w-36">
                        <Progress {...c.progress} />
                      </td>
                      <td className="whitespace-nowrap text-slate-600">{fmtDateTime(c.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <Modal
        open={!!stopTarget}
        onOpenChange={(o) => !o && setStopTarget(null)}
        title={`Parar (Stop) campanha "${stopTarget?.name ?? ''}"?`}
        description="Impede novas reservas e cancela tentativas pendentes."
        footer={
          <>
            <Button onClick={() => setStopTarget(null)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={actionM.isPending}
              onClick={() => {
                if (!stopTarget) return;
                if (stopReason.trim().length < 3) return setStopErr('Informe o motivo (mínimo 3 caracteres)');
                actionM.mutate({ id: stopTarget.id, action: 'close', body: { reason: stopReason } });
              }}
            >
              Confirmar Stop
            </Button>
          </>
        }
      >
        <Field label="Motivo do encerramento" required error={stopErr ?? undefined}>
          {(p) => (
            <Input
              id={p.id}
              autoFocus
              value={stopReason}
              aria-describedby={p.describedBy}
              aria-invalid={p.invalid}
              onChange={(e) => {
                setStopReason(e.target.value);
                setStopErr(null);
              }}
            />
          )}
        </Field>
      </Modal>

      {templateTarget && (
        <SaveAsTemplateModal
          open={!!templateTarget}
          onClose={() => setTemplateTarget(null)}
          campaignId={templateTarget.id}
          campaignName={templateTarget.name}
        />
      )}
    </div>
  );
}

export function Progress({ members, finished, active }: { members: number; finished: number; active: number }) {
  const pct = members ? Math.round((finished / members) * 100) : 0;
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Inscrições concluídas">
        <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-600">
        {fmtNumber(finished)}/{fmtNumber(members)} concluídas · {fmtNumber(active)} ativas
      </div>
    </div>
  );
}

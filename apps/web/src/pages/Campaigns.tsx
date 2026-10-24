import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { CAMPAIGN_STATUS, CAMPAIGN_STATUS_LABEL, type CampaignStatus } from '@voll/shared';
import { get, qs } from '../lib/api';
import type { CampaignSummary } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { useAuth } from '../lib/auth';
import { btnClass, CampaignStatusBadge, Card, Empty, ErrorState, Loading, PageHeader, TableWrap } from '../components/ui';

export function CampaignsPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const status = (sp.get('status') ?? '') as CampaignStatus | '';
  const q = useQuery({
    queryKey: ['campaigns', status],
    queryFn: () => get<{ items: CampaignSummary[] }>(`/campaigns${qs({ status })}`),
    refetchInterval: 5000,
  });

  return (
    <div>
      <PageHeader
        title="Campanhas"
        subtitle="Mailing ou lista + jornada + estratégia"
        actions={
          can('campaigns.create') && (
            <Link to="/campanhas/nova" className={btnClass('primary')}>
              <Plus className="size-4" aria-hidden />
              Nova campanha
            </Link>
          )
        }
      />
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
                  <th>Status</th>
                  <th>Público</th>
                  <th>Jornada</th>
                  <th>Estratégia</th>
                  <th>Progresso</th>
                  <th>Criada</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((c) => (
                  <tr key={c.id}>
                    <td className="min-w-48">
                      <Link to={`/campanhas/${c.id}`} className="font-medium text-brand-800 hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-slate-500">{c.operationalExplanation}</div>
                    </td>
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
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
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

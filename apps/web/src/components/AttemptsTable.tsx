import { Link } from 'react-router-dom';
import { CHANNEL_LABEL } from '@voll/shared';
import type { AttemptRow } from '../lib/types';
import { fmtDateTimeSec } from '../lib/format';
import { AttemptStateBadge, Empty, TableWrap } from './ui';
import { useOpenAttempt } from './AttemptDrawer';

export function AttemptsTable({ items, showCampaign, emptyText = 'Nenhuma tentativa ainda.' }: { items: AttemptRow[]; showCampaign?: boolean; emptyText?: string }) {
  const open = useOpenAttempt();
  if (items.length === 0) return <Empty title="Sem tentativas">{emptyText}</Empty>;
  return (
    <TableWrap label="Tentativas">
      <table className="data" data-testid="attempts-table">
        <thead>
          <tr>
            <th>Cliente</th>
            {showCampaign && <th>Campanha</th>}
            <th>Canal / Conexão</th>
            <th>Destino</th>
            <th>Estado</th>
            <th>Tabulação</th>
            <th>Atualização</th>
            <th>Próxima ação</th>
            <th>
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>
                <Link to={`/contatos/${a.contact.id}`} className="font-medium text-slate-900 hover:underline">
                  {a.contact.name ?? '(sem nome)'}
                </Link>
                <div className="font-mono text-[11px] text-slate-500">{a.contact.externalId}</div>
              </td>
              {showCampaign && (
                <td>{a.campaign ? <Link to={`/campanhas/${a.campaign.id}`} className="hover:underline">{a.campaign.name}</Link> : '—'}</td>
              )}
              <td>
                {CHANNEL_LABEL[a.channelType]}
                <div className="text-xs text-slate-500">{a.connectionName}</div>
              </td>
              <td className="font-mono text-xs">{a.destinationMasked}</td>
              <td>
                <AttemptStateBadge state={a.state} label={a.stateLabel} />
              </td>
              <td>{a.tabulation?.name ?? <span className="text-slate-400">—</span>}</td>
              <td className="whitespace-nowrap text-xs text-slate-600">{fmtDateTimeSec(a.finalizedAt ?? a.sentAt ?? a.createdAt)}</td>
              <td className="text-xs text-slate-700">{a.nextAction}</td>
              <td>
                <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => open(a.id)}>
                  Ver tentativa
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

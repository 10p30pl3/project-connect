import { useQuery } from '@tanstack/react-query';
import { CHANNEL_LABEL, type ChannelType } from '@voll/shared';

import { get } from '../lib/api';
import type { Tabulation } from '../lib/types';
import { Badge, Card, ErrorState, Loading, PageHeader, TableWrap } from '../components/ui';

/** Aceita array ou literal de array do Postgres ("{VOICE,SMS}"). */
function channelList(v: unknown): ChannelType[] {
  if (Array.isArray(v)) return v as ChannelType[];
  if (typeof v === 'string') return v.replace(/[{}]/g, '').split(',').filter(Boolean) as ChannelType[];
  return [];
}

export function TabulationsPage() {
  const q = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });
  return (
    <div>
      <PageHeader title="Tabulações" subtitle="Catálogo de resultados normalizados. A ação de cada tabulação é definida na estratégia." />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card padded={false}>
          <TableWrap label="Tabulações">
            <table className="data">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nome</th>
                  <th>Indicadores</th>
                  <th>Canais</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((t) => (
                  <tr key={t.id}>
                    <td className="font-mono text-xs">{t.code}</td>
                    <td>{t.name}</td>
                    <td className="space-x-1">
                      {t.isCpc && <Badge tone="blue">CPC</Badge>}
                      {t.isConversion && <Badge tone="green">Conversão</Badge>}
                      {t.isOptOut && <Badge tone="red">Opt-out (DNC)</Badge>}
                      {t.invalidatesDestination && <Badge tone="amber">Invalida destino</Badge>}
                      {!t.isCpc && !t.isConversion && !t.isOptOut && !t.invalidatesDestination && <span className="text-slate-400">—</span>}
                    </td>
                    <td className="text-xs">{channelList(t.channelTypes).map((c) => CHANNEL_LABEL[c] ?? c).join(', ')}</td>
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

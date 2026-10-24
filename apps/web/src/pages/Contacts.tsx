import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Ban } from 'lucide-react';
import { CHANNEL_LABEL } from '@voll/shared';
import { get, qs } from '../lib/api';
import type { ContactRow, Paginated } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { useCursorPager, useDebounced } from '../lib/hooks';
import { Badge, Card, ErrorState, Field, Input, Loading, PageHeader, Pager, TableWrap } from '../components/ui';

export function ContactsPage() {
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const pager = useCursorPager();
  const data = useQuery({
    queryKey: ['contacts', q, pager.cursor],
    queryFn: () => get<Paginated<ContactRow>>(`/contacts${qs({ q, cursor: pager.cursor, limit: 50 })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Contatos" subtitle="Identidade persistente do cliente em todas as cargas e campanhas" />
      <Field label="Buscar por nome ou ID" className="mb-3 max-w-md">
        {(p) => (
          <Input
            id={p.id}
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              pager.reset();
            }}
          />
        )}
      </Field>
      <Card padded={false}>
        {data.isLoading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : data.error ? (
          <div className="p-4">
            <ErrorState error={data.error} onRetry={() => data.refetch()} />
          </div>
        ) : (
          <>
            <TableWrap label="Contatos">
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Bloqueio</th>
                    <th>Destinos</th>
                    <th>Tentativas (importado / novas)</th>
                    <th>Última tabulação</th>
                    <th>Campanhas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data!.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        Nenhum contato encontrado.
                      </td>
                    </tr>
                  )}
                  {data.data!.items.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono text-xs">{c.externalId}</td>
                      <td>
                        <Link to={`/contatos/${c.id}`} className="font-medium text-brand-800 hover:underline">
                          {c.name ?? '(sem nome)'}
                        </Link>
                      </td>
                      <td>
                        {c.blocked ? (
                          <Badge tone="red" icon={<Ban className="size-3.5" aria-hidden />}>
                            DNC
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {c.destinations.length === 0
                          ? '—'
                          : c.destinations.map((d) => `${CHANNEL_LABEL[d.channelType]} ${d.count}`).join(' · ')}
                      </td>
                      <td className="tabular text-xs">
                        {c.attempts.total === null ? <span title="Histórico importado desconhecido">desconhecido</span> : fmtNumber(c.attempts.total)} /{' '}
                        {fmtNumber(c.attempts.new)}
                      </td>
                      <td className="text-xs">
                        {c.lastTabulation ? (
                          <>
                            {c.lastTabulation.name}
                            <div className="text-slate-500">{fmtDateTime(c.lastTabulation.at)}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tabular">{fmtNumber(c.campaigns)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pager page={pager.page} hasNext={!!data.data!.nextCursor} onPrev={pager.prev} onNext={() => pager.next(data.data!.nextCursor)} total={data.data!.total} />
          </>
        )}
      </Card>
    </div>
  );
}

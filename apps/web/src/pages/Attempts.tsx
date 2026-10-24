import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ATTEMPT_STATES, ATTEMPT_STATE_LABEL } from '@voll/shared';
import { get, qs } from '../lib/api';
import type { AttemptRow, CampaignSummary, Paginated } from '../lib/types';
import { useCursorPager, useDebounced } from '../lib/hooks';
import { Card, ErrorState, Field, Input, Loading, PageHeader, Pager, Select } from '../components/ui';
import { AttemptsTable } from '../components/AttemptsTable';

export function AttemptsPage() {
  const [state, setState] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const pager = useCursorPager();
  const campaigns = useQuery({ queryKey: ['campaigns', ''], queryFn: () => get<{ items: CampaignSummary[] }>('/campaigns') });
  const data = useQuery({
    queryKey: ['operation-attempts', state, campaignId, q, pager.cursor],
    queryFn: () => get<Paginated<AttemptRow>>(`/operation/attempts${qs({ state, campaignId, q, cursor: pager.cursor })}`),
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });
  const reset = pager.reset;
  return (
    <div>
      <PageHeader title="Tentativas" subtitle="Operação de todas as campanhas — reservas, envios, retornos e reconciliações" />
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Field label="Buscar">
          {(p) => (
            <Input
              id={p.id}
              type="search"
              placeholder="Cliente, ID ou attempt_id"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                reset();
              }}
            />
          )}
        </Field>
        <Field label="Estado">
          {(p) => (
            <Select
              id={p.id}
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                reset();
              }}
            >
              <option value="">Todos</option>
              {ATTEMPT_STATES.map((s) => (
                <option key={s} value={s}>
                  {ATTEMPT_STATE_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Campanha">
          {(p) => (
            <Select
              id={p.id}
              value={campaignId}
              onChange={(e) => {
                setCampaignId(e.target.value);
                reset();
              }}
            >
              <option value="">Todas</option>
              {campaigns.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
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
            <AttemptsTable items={data.data!.items} showCampaign emptyText="Nenhuma tentativa com esses filtros." />
            <Pager page={pager.page} hasNext={!!data.data!.nextCursor} onPrev={pager.prev} onNext={() => pager.next(data.data!.nextCursor)} total={data.data!.total} />
          </>
        )}
      </Card>
    </div>
  );
}

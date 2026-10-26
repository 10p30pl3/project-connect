import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Ban, Download, Sparkles } from 'lucide-react';
import { CHANNEL_LABEL } from '@voll/shared';
import clsx from 'clsx';
import { get, qs } from '../lib/api';
import type { ContactRow, Paginated } from '../lib/types';
import { fmtDateTime, fmtMoney, fmtNumber } from '../lib/format';
import { buildContactIntelligenceRationale } from '../lib/intelligence-rationale';
import { useCursorPager, useDebounced } from '../lib/hooks';
import { Badge, Card, ErrorState, Field, InfoTooltip, Input, Loading, PageHeader, Pager, TableWrap } from '../components/ui';

export function ContactsSection() {
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const pager = useCursorPager();
  const data = useQuery({
    queryKey: ['contacts', q, pager.cursor],
    queryFn: () => get<Paginated<ContactRow>>(`/contacts${qs({ q, cursor: pager.cursor, limit: 50 })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-slate-800">Contatos e Bloqueios (DNC)</h2>
          <InfoTooltip content="Identidade persistente do cliente em todas as cargas e campanhas, com contadores globais e lista de Não Perturbe (DNC)." />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Buscar por nome ou ID" className="w-full sm:w-80">
            {(p) => (
              <Input
                id={p.id}
                type="search"
                placeholder="Digite nome ou código do cliente…"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  pager.reset();
                }}
              />
            )}
          </Field>
          <a
            href="/mailing_1000_contatos_cpc.csv"
            download="mailing_1000_contatos_cpc.csv"
            className="inline-flex h-9 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-600"
            title="Baixar CSV piloto com 1.000 contatos fictícios para inteligência de CPC"
          >
            <Download className="size-4 text-brand-600" aria-hidden /> Baixar CSV (1.000)
          </a>
        </div>
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
            <TableWrap label="Contatos">
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Racional da Inteligência (TIC Domicílios)</th>
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
                      <td colSpan={8} className="py-6 text-center text-slate-500">
                        Nenhum contato encontrado.
                      </td>
                    </tr>
                  )}
                  {data.data!.items.map((c) => {
                    const r = c.intelligence ?? buildContactIntelligenceRationale(c);
                    return (
                      <tr key={c.id}>
                        <td className="font-mono text-xs">{c.externalId}</td>
                        <td>
                          <Link to={`/contatos/${c.id}`} className="font-medium text-brand-800 hover:underline">
                            {c.name ?? '(sem nome)'}
                          </Link>
                        </td>
                        <td>
                          <Link to={`/contatos/${c.id}`} className="group block max-w-xs space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={clsx(
                                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                                  r.channelStrategy.primaryChannel === 'WHATSAPP'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-brand-100 text-brand-800',
                                )}
                              >
                                <Sparkles className="size-2.5" aria-hidden />
                                {r.channelStrategy.primaryChannelLabel}
                              </span>
                              <span className="text-[11px] font-medium text-slate-600">
                                {r.timing.suggestedWindow}
                              </span>
                            </div>
                            <div className="truncate text-[11px] text-slate-500 group-hover:text-brand-800">
                              {r.summary.slice(0, 75)}…
                            </div>
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
                  );
                })}
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

export function ContactsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Contatos & DNC"
        subtitle="Identidade persistente do cliente em todas as cargas e campanhas, com histórico acumulado e bloqueios"
      />
      <ContactsSection />
    </div>
  );
}

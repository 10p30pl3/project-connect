import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { get, qs } from '../lib/api';
import type { ListDetail, ListMember, ListSummary, MailingSummary, Paginated } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { useCursorPager } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, btnClass, Button, Card, Empty, ErrorState, Field, Loading, PageHeader, Pager, Select, TableWrap, useToast } from '../components/ui';
import { formatCell, ListEditor } from '../components/ListEditor';

const modeBadge = (m: 'SNAPSHOT' | 'DYNAMIC') => <Badge tone={m === 'DYNAMIC' ? 'blue' : 'gray'}>{m === 'DYNAMIC' ? 'Dinâmica' : 'Fotografia'}</Badge>;

export function ListsSection() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['lists'], queryFn: () => get<{ items: ListSummary[] }>('/lists') });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Listas de Segmentação</h2>
          <p className="text-xs text-slate-500">Views versionadas sobre um mailing: filtros, ordenação multi-coluna e modalidade (Fotografia ou Dinâmica).</p>
        </div>
        {can('lists.write') && (
          <Link to="/listas/nova" className={btnClass('primary', 'sm')}>
            <Plus className="size-4" aria-hidden /> Nova lista
          </Link>
        )}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty title="Nenhuma lista publicada">Crie uma lista a partir de um mailing.</Empty>
      ) : (
        <Card padded={false}>
          <TableWrap label="Listas">
            <table className="data">
              <thead>
                <tr>
                  <th>Lista</th>
                  <th>Mailing</th>
                  <th>Versão</th>
                  <th>Modalidade</th>
                  <th>Membros na publicação</th>
                  <th>Publicada</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to={`/listas/${l.id}`} className="font-medium text-brand-800 hover:underline">
                        {l.name}
                      </Link>
                    </td>
                    <td>{l.mailing.name}</td>
                    <td>{l.latestVersion ? `v${l.latestVersion.version}` : '—'}</td>
                    <td>{l.latestVersion && modeBadge(l.latestVersion.membershipMode)}</td>
                    <td className="tabular">{fmtNumber(l.latestVersion?.memberCount)}</td>
                    <td className="text-xs">{fmtDateTime(l.latestVersion?.publishedAt)}</td>
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

export function ListsPage() {
  const { can } = useAuth();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Listas de Segmentação"
        subtitle="Views versionadas sobre um mailing: filtros avançados, ordenação multi-coluna e modalidade"
        actions={
          can('lists.write') && (
            <Link to="/listas/nova" className={btnClass('primary')}>
              <Plus className="size-4" aria-hidden />
              Nova lista
            </Link>
          )
        }
      />
      <ListsSection />
    </div>
  );
}

export function NewListPage() {
  const [sp] = useSearchParams();
  const [mailingId, setMailingId] = useState(sp.get('mailing') ?? '');
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const mailings = useQuery({ queryKey: ['mailings'], queryFn: () => get<{ items: MailingSummary[] }>('/mailings') });
  return (
    <div>
      <PageHeader
        back={
          <Link to="/listas" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-3.5" aria-hidden /> Listas
          </Link>
        }
        title="Nova lista"
      />
      <Card>
        <Field label="Mailing de origem" required className="mb-4 max-w-md">
          {(p) => (
            <Select id={p.id} value={mailingId} onChange={(e) => setMailingId(e.target.value)}>
              <option value="">Selecione…</option>
              {mailings.data?.items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {fmtNumber(m.recordCount)} registros
                </option>
              ))}
            </Select>
          )}
        </Field>
        {mailingId && (
          <ListEditor
            key={mailingId}
            mailingId={mailingId}
            onPublished={(r) => {
              qc.invalidateQueries({ queryKey: ['lists'] });
              toast('success', `Lista publicada (v${r.version}, ${fmtNumber(r.memberCount)} membros).`);
              nav(`/listas/${r.listId}`);
            }}
          />
        )}
      </Card>
    </div>
  );
}

export function ListDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['list', id], queryFn: () => get<ListDetail>(`/lists/${id}`) });
  const [versionId, setVersionId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const pager = useCursorPager();
  const vid = versionId ?? q.data?.latestVersion?.id ?? null;
  const members = useQuery({
    queryKey: ['list-members', vid, pager.cursor],
    enabled: !!vid,
    queryFn: () => get<Paginated<ListMember>>(`/lists/versions/${vid}/members${qs({ cursor: pager.cursor })}`),
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const l = q.data!;
  const latest = l.versions.find((v) => v.id === l.latestVersion?.id) ?? l.versions[l.versions.length - 1];
  const cols = members.data?.items[0] ? Object.keys(members.data.items[0].fields).slice(0, 5) : [];
  return (
    <div>
      <PageHeader
        back={
          <Link to="/listas" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-3.5" aria-hidden /> Listas
          </Link>
        }
        title={l.name}
        subtitle={`Mailing ${l.mailing.name}`}
        actions={
          can('lists.write') &&
          !editing && (
            <Button onClick={() => setEditing(true)}>Editar e publicar nova versão</Button>
          )
        }
      />
      {editing && (
        <Card title="Nova versão" className="mb-4" actions={<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>}>
          <ListEditor
            mailingId={l.mailing.id}
            listId={l.id}
            initial={latest ? { name: l.name, filters: latest.filters, sort: latest.sort, membershipMode: latest.membershipMode } : { name: l.name }}
            publishLabel="Publicar nova versão"
            publishNote="Campanhas vinculadas a versões anteriores não são alteradas."
            onPublished={(r) => {
              toast('success', `Versão v${r.version} publicada.`);
              setEditing(false);
              setVersionId(null);
              qc.invalidateQueries({ queryKey: ['list', id] });
              qc.invalidateQueries({ queryKey: ['lists'] });
            }}
          />
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title="Versões" padded={false}>
          <ul className="divide-y divide-slate-100">
            {[...l.versions].reverse().map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={vid === v.id}
                  onClick={() => {
                    setVersionId(v.id);
                    pager.reset();
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm ${vid === v.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between">
                    <strong>v{v.version}</strong> {modeBadge(v.membershipMode)}
                  </div>
                  <div className="text-xs text-slate-600">
                    {fmtNumber(v.memberCount)} membros · {fmtDateTime(v.publishedAt)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {v.filters.length === 0 ? 'Sem filtros' : v.filters.map((f) => `${f.field} ${f.op} ${f.value ?? ''}`).join(' · ')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Membros" padded={false}>
          {members.isLoading ? (
            <div className="p-4">
              <Loading />
            </div>
          ) : members.error ? (
            <div className="p-4">
              <ErrorState error={members.error} />
            </div>
          ) : (
            <>
              <TableWrap label="Membros">
                <table className="data">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Nome</th>
                      {cols.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.data?.items.map((m) => (
                      <tr key={m.contactId}>
                        <td className="font-mono text-xs">
                          <Link to={`/contatos/${m.contactId}`} className="hover:underline">
                            {m.externalId}
                          </Link>
                        </td>
                        <td>{m.name ?? '—'}</td>
                        {cols.map((c) => (
                          <td key={c}>{formatCell(m.fields[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <Pager page={pager.page} hasNext={!!members.data?.nextCursor} onPrev={pager.prev} onNext={() => pager.next(members.data?.nextCursor ?? null)} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

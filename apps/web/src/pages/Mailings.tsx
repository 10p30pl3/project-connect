import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, Download, Plus } from 'lucide-react';
import { API_BASE, errorMessage, get, post, qs } from '../lib/api';
import type { MailingDetail, MailingRecord, MailingSummary, Paginated } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { useCursorPager, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useExperienceMode } from '../lib/experience-mode';
import { Badge, Button, btnClass, Card, ConfirmDialog, Empty, ErrorState, Field, InfoTooltip, Input, Loading, PageHeader, Pager, TableWrap, useToast } from '../components/ui';
import { ImportFlow } from '../components/ImportFlow';
import { formatCell } from '../components/ListEditor';

export function MailingsSection() {
  const { can } = useAuth();
  const { isAtLeast } = useExperienceMode();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can('mailings.write');
  const [filterArchived, setFilterArchived] = useState<'false' | 'true' | 'all'>('false');
  const [archivingMailing, setArchivingMailing] = useState<MailingSummary | null>(null);
  const q = useQuery({
    queryKey: ['mailings', filterArchived],
    queryFn: () => get<{ items: MailingSummary[] }>(`/mailings${qs({ archived: filterArchived })}`),
  });
  const archiveM = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'archive' | 'unarchive' }) =>
      post(`/mailings/${id}/${action}`, action === 'archive' ? { reason: 'Arquivado pelo painel' } : undefined),
    onSuccess: (_r, vars) => {
      toast('success', vars.action === 'archive' ? 'Mailing arquivado.' : 'Mailing desarquivado.');
      setArchivingMailing(null);
      qc.invalidateQueries({ queryKey: ['mailings'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-slate-800">Mailings (Cargas Originais)</h2>
          <InfoTooltip content="Arquivos CSV e cargas importadas com versionamento e conferência de linhas." />
        </div>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {(
            [
              ['false', 'Ativos'],
              ['true', 'Arquivados'],
              ['all', 'Todos'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilterArchived(val)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                filterArchived === val ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty title={filterArchived === 'true' ? 'Nenhum mailing arquivado' : 'Nenhum mailing'}>
          {filterArchived === 'true' ? 'Os mailings arquivados aparecerão aqui.' : 'Importe um CSV ou cole o conteúdo de uma planilha.'}
        </Empty>
      ) : (
        <Card padded={false}>
          <TableWrap label="Mailings">
            <table className="data">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Registros</th>
                  <th>Última carga</th>
                  <th>Criado</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Link to={`/mailings/${m.id}`} className="font-medium text-brand-800 hover:underline">
                          {m.name}
                        </Link>
                        {m.archivedAt && <Badge tone="gray">Arquivado</Badge>}
                      </div>
                    </td>
                    <td className="tabular">{fmtNumber(m.recordCount)}</td>
                    <td className="text-xs">
                      {m.lastVersion ? (
                        <>
                          v{m.lastVersion.version} · {fmtNumber(m.lastVersion.validRows)} válidos
                          {m.lastVersion.rejectedRows > 0 && (
                            <Badge tone="amber" className="ml-1">
                              {fmtNumber(m.lastVersion.rejectedRows)} rejeitados
                            </Badge>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-xs text-slate-600">{fmtDateTime(m.createdAt)}</td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-2">
                        {!m.archivedAt && (
                          <Link to={`/campanhas/nova?mailing=${m.id}`} className="text-xs font-semibold text-brand-700 hover:underline">
                            Nova campanha →
                          </Link>
                        )}
                        {!m.archivedAt && isAtLeast('advanced') && (
                          <Link to={`/listas/nova?mailing=${m.id}`} className="text-xs font-medium text-slate-600 hover:underline">
                            Criar lista →
                          </Link>
                        )}
                        {canWrite &&
                          (m.archivedAt ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={archiveM.isPending && archiveM.variables?.id === m.id}
                              icon={<ArchiveRestore className="size-3.5" aria-hidden />}
                              onClick={() => archiveM.mutate({ id: m.id, action: 'unarchive' })}
                            >
                              Desarquivar
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<Archive className="size-3.5" aria-hidden />}
                              onClick={() => setArchivingMailing(m)}
                            >
                              Arquivar
                            </Button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      <ConfirmDialog
        open={Boolean(archivingMailing)}
        onOpenChange={(o) => !o && setArchivingMailing(null)}
        title={`Arquivar mailing "${archivingMailing?.name}"?`}
        confirmLabel="Arquivar"
        loading={archiveM.isPending}
        onConfirm={() => archivingMailing && archiveM.mutate({ id: archivingMailing.id, action: 'archive' })}
      >
        <p className="text-sm text-slate-600">
          O mailing sai da listagem ativa mas permanece no filtro &quot;Arquivados&quot;, preservando seus contatos, listas e histórico de campanhas.
        </p>
      </ConfirmDialog>
    </div>
  );
}

export function MailingsPage() {
  const { can } = useAuth();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Mailings"
        tooltip="Importação de arquivos CSV, conferência de linhas e versionamento de bases de clientes."
        actions={
          <div className="flex items-center gap-2">
            <a
              href="/mailing_1000_contatos_cpc.csv"
              download="mailing_1000_contatos_cpc.csv"
              className={btnClass('secondary')}
              title="Baixar CSV piloto com 1.000 contatos para inteligência de CPC"
            >
              <Download className="size-4 text-brand-600" aria-hidden /> Baixar CSV Piloto
            </a>
            {can('mailings.write') && (
              <Link to="/mailings/importar" className={btnClass('primary')}>
                <Plus className="size-4" aria-hidden />
                Novo mailing
              </Link>
            )}
          </div>
        }
      />
      <MailingsSection />
    </div>
  );
}

export function MailingImportPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <div>
      <PageHeader
        back={
          <Link to="/mailings" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-3.5" aria-hidden /> Mailings
          </Link>
        }
        title="Importar mailing"
        tooltip="A importação não cria campanha. O mailing fica disponível para listas e campanhas."
      />
      <Card>
        <ImportFlow
          onImported={(r) => {
            qc.invalidateQueries({ queryKey: ['mailings'] });
            toast('success', `Mailing "${r.name}" importado: ${fmtNumber(r.validRows)} registros${r.rejectedRows ? `, ${fmtNumber(r.rejectedRows)} rejeitados` : ''}.`);
            nav(`/mailings/${r.mailingId}`);
          }}
        />
      </Card>
    </div>
  );
}

export function MailingDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { isAtLeast } = useExperienceMode();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can('mailings.write');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const q = useQuery({ queryKey: ['mailing', id], queryFn: () => get<MailingDetail>(`/mailings/${id}`) });
  const archiveM = useMutation({
    mutationFn: (action: 'archive' | 'unarchive') =>
      post(`/mailings/${id}/${action}`, action === 'archive' ? { reason: 'Arquivado pelo detalhe' } : undefined),
    onSuccess: (_r, action) => {
      toast('success', action === 'archive' ? 'Mailing arquivado.' : 'Mailing desarquivado.');
      setConfirmArchive(false);
      qc.invalidateQueries({ queryKey: ['mailing', id] });
      qc.invalidateQueries({ queryKey: ['mailings'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const [text, setText] = useState('');
  const search = useDebounced(text, 300);
  const pager = useCursorPager();
  const recs = useQuery({
    queryKey: ['mailing-records', id, search, pager.cursor],
    queryFn: () => get<Paginated<MailingRecord>>(`/mailings/${id}/records${qs({ q: search, cursor: pager.cursor, limit: 50 })}`),
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data!;
  const cols = m.columns.slice(0, 8);
  return (
    <div>
      <PageHeader
        back={
          <Link to="/mailings" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-3.5" aria-hidden /> Mailings
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            {m.name}
            {m.archivedAt && <Badge tone="gray">Arquivado</Badge>}
          </span>
        }
        subtitle={`${fmtNumber(m.recordCount)} registros · criado em ${fmtDateTime(m.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            {canWrite &&
              (m.archivedAt ? (
                <Button
                  variant="secondary"
                  loading={archiveM.isPending}
                  icon={<ArchiveRestore className="size-4" aria-hidden />}
                  onClick={() => archiveM.mutate('unarchive')}
                >
                  Desarquivar
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  icon={<Archive className="size-4" aria-hidden />}
                  onClick={() => setConfirmArchive(true)}
                >
                  Arquivar
                </Button>
              ))}
            {!m.archivedAt && (
              <Link to={`/campanhas/nova?mailing=${m.id}`} className={btnClass('primary')}>
                Criar campanha com esta base
              </Link>
            )}
            {!m.archivedAt && isAtLeast('advanced') && (
              <Link to={`/listas/nova?mailing=${m.id}`} className={btnClass('secondary')}>
                Preparar lista
              </Link>
            )}
          </div>
        }
      />
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Arquivar mailing "${m.name}"?`}
        confirmLabel="Arquivar"
        loading={archiveM.isPending}
        onConfirm={() => archiveM.mutate('archive')}
      >
        <p className="text-sm text-slate-600">
          O mailing sai da listagem ativa mas permanece no filtro &quot;Arquivados&quot;, preservando contatos, listas e histórico de campanhas.
        </p>
      </ConfirmDialog>
      <div className="space-y-4">
        <Card title="Cargas" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Versão</th>
                <th>Recebidos</th>
                <th>Válidos</th>
                <th>Rejeitados</th>
                <th>Data</th>
                <th>
                  <span className="sr-only">Relatório</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {m.versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.version}</td>
                  <td className="tabular">{fmtNumber(v.totalRows)}</td>
                  <td className="tabular">{fmtNumber(v.validRows)}</td>
                  <td className="tabular">{fmtNumber(v.rejectedRows)}</td>
                  <td className="text-xs">{fmtDateTime(v.createdAt)}</td>
                  <td className="text-right">
                    {v.rejectedRows > 0 && (
                      <a href={`${API_BASE}/mailings/${m.id}/versions/${v.id}/rejected.csv`} download className={btnClass('ghost', 'sm')}>
                        <Download className="size-4" aria-hidden /> Baixar rejeitados
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Registros" padded={false}>
          <div className="p-3">
            <Field label="Buscar" className="max-w-sm">
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
          </div>
          {recs.isLoading ? (
            <div className="p-4">
              <Loading />
            </div>
          ) : recs.error ? (
            <div className="p-4">
              <ErrorState error={recs.error} />
            </div>
          ) : (
            <>
              <TableWrap label="Registros do mailing">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>ID</th>
                      <th>Nome</th>
                      {cols.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                      <th>Bloqueio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.data!.items.map((r) => (
                      <tr key={r.id}>
                        <td className="tabular text-xs">{r.rowNumber}</td>
                        <td className="font-mono text-xs">
                          <Link to={`/contatos/${r.contactId}`} className="hover:underline">
                            {r.externalId}
                          </Link>
                        </td>
                        <td>{r.name ?? '—'}</td>
                        {cols.map((c) => (
                          <td key={c} className="max-w-40 truncate">
                            {formatCell(r.fields[c])}
                          </td>
                        ))}
                        <td>{r.blocked ? <Badge tone="red">DNC</Badge> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <Pager page={pager.page} hasNext={!!recs.data!.nextCursor} onPrev={pager.prev} onNext={() => pager.next(recs.data!.nextCursor)} total={recs.data!.total} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

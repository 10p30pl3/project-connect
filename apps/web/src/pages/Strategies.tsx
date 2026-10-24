import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Copy, Lock } from 'lucide-react';
import type { StrategyConfig } from '@voll/shared';
import { errorMessage, get, post, put } from '../lib/api';
import type { DraftEnvelope, Strategy, StrategyDetail, StrategyVersion, Tabulation } from '../lib/types';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, TableWrap, useToast } from '../components/ui';
import { StrategySummary, daysLabel } from '../components/Summaries';
import { StrategyForm } from '../components/StrategyForm';
import { WizardReturnBanner } from './NewCampaign';

export function StrategiesSection() {
  const q = useQuery({ queryKey: ['strategies'], queryFn: () => get<{ items: Strategy[] }>('/strategies') });
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Estratégias de Cobrança (Templates Versionados)</h2>
        <p className="text-xs text-slate-500">Calendário operacional, limites de esforço, cadência de retentativas, otimização consultiva e regras por tabulação.</p>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty title="Nenhuma estratégia" />
      ) : (
        <Card padded={false}>
          <TableWrap label="Estratégias">
            <table className="data">
              <thead>
                <tr>
                  <th>Estratégia</th>
                  <th>Versão</th>
                  <th>Limites (total/dia)</th>
                  <th>Calendário</th>
                  <th>Retentativa</th>
                  <th>Publicada</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((s) => {
                  const c = s.latestVersion?.config;
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link to={`/estrategias/${s.id}`} className="font-medium text-brand-800 hover:underline">
                          {s.name}
                        </Link>{' '}
                        {s.protected && (
                          <Badge icon={<Lock className="size-3" aria-hidden />} className="ml-1">
                            Predefinida
                          </Badge>
                        )}
                      </td>
                      <td>{s.latestVersion ? `v${s.latestVersion.version}` : '—'}</td>
                      <td className="tabular">{c ? `${c.limits.total} / ${c.limits.daily}` : '—'}</td>
                      <td className="text-xs">{c ? `${daysLabel(c.calendar.days)}, ${c.calendar.start}–${c.calendar.end}` : '—'}</td>
                      <td className="text-xs">{c ? `${c.retry.intervalMinutes} min · até ${c.retry.maxPerDestination}/destino` : '—'}</td>
                      <td className="text-xs">{fmtDateTime(s.latestVersion?.publishedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}

export function StrategiesPage() {
  return <StrategiesSection />;
}

export function StrategyDetailPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const fromWizard = sp.get('retorno') === 'assistente';
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['strategy', id], queryFn: () => get<StrategyDetail>(`/strategies/${id}`) });
  const tabs = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });
  const [editing, setEditing] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState<StrategyVersion | null>(null);

  const useInWizard = useMutation({
    mutationFn: async (versionId: string) => {
      const d = await get<DraftEnvelope>('/campaign-draft');
      if (!d) throw new Error('Rascunho do assistente não encontrado.');
      await put('/campaign-draft', { data: { ...d.data, strategyVersionId: versionId, step: 'ACTIVATION' }, revision: d.revision });
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['campaign-draft'] });
      nav('/campanhas/nova');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isLoading) return <Loading rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const versions = [...s.versions].sort((a, b) => b.version - a.version);
  const current = versions.find((v) => v.id === selected) ?? versions[0];
  const latest = versions[0];

  return (
    <div>
      {fromWizard && <WizardReturnBanner />}
      <PageHeader
        back={
          <Link to="/estrategias" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-3.5" aria-hidden /> Estratégias
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            {s.name}
            {s.protected && <Badge icon={<Lock className="size-3" aria-hidden />}>Predefinida</Badge>}
          </span>
        }
        actions={
          <>
            {fromWizard && (
              <Link to="/campanhas/nova" className="text-sm text-slate-700 underline">
                Voltar sem usar ajustes
              </Link>
            )}
            {fromWizard && !s.protected && latest && (
              <Button variant="primary" loading={useInWizard.isPending} onClick={() => useInWizard.mutate(latest.id)}>
                Usar estratégia publicada (v{latest.version})
              </Button>
            )}
            {can('strategies.write') && (
              <Button icon={<Copy className="size-4" aria-hidden />} onClick={() => setCopyOpen(true)}>
                Criar cópia
              </Button>
            )}
            {can('strategies.write') && !s.protected && !editing && (
              <Button variant={fromWizard ? 'secondary' : 'primary'} onClick={() => setEditing(true)}>
                Editar e publicar nova versão
              </Button>
            )}
          </>
        }
      />
      {s.protected && can('strategies.write') && (
        <Alert tone="info" className="mb-4">
          Templates predefinidos são protegidos. Para personalizar, crie uma cópia — o original e as campanhas que o usam permanecem inalterados.
        </Alert>
      )}
      {justPublished && (
        <Alert tone="success" className="mb-4" title={`Versão v${justPublished.version} publicada`}>
          Campanhas existentes continuam com as versões que já usavam; tentativas em andamento mantêm a versão da reserva.
        </Alert>
      )}

      {editing && latest ? (
        <Card title={`Nova versão (a partir de v${latest.version})`}>
          <StrategyForm
            initial={latest.config}
            submitLabel="Publicar nova versão"
            onCancel={() => setEditing(false)}
            onSubmit={async (config) => {
              const v = await post<StrategyVersion>(`/strategies/${id}/versions`, { config });
              setJustPublished(v);
              setEditing(false);
              setSelected(null);
              qc.invalidateQueries({ queryKey: ['strategy', id] });
              qc.invalidateQueries({ queryKey: ['strategies'] });
              toast('success', `Versão v${v.version ?? ''} publicada.`);
            }}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card title="Versões" padded={false}>
            <ul className="divide-y divide-slate-100">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-pressed={current?.id === v.id}
                    onClick={() => setSelected(v.id)}
                    className={`w-full px-4 py-2.5 text-left text-sm ${current?.id === v.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <strong>v{v.version}</strong> {v.id === latest?.id && <Badge tone="green">Atual</Badge>}
                    <div className="text-xs text-slate-500">{fmtDateTime(v.publishedAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={current ? `Configuração v${current.version}` : 'Configuração'}>
            {current ? <StrategySummary config={current.config} tabulations={tabs.data?.items} /> : <p>Sem versão publicada.</p>}
            {current && latest && current.id !== latest.id && <VersionDiff a={current.config} b={latest.config} aLabel={`v${current.version}`} bLabel={`v${latest.version}`} />}
          </Card>
        </div>
      )}
      {latest && (
        <CopyDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          source={s}
          config={latest.config}
          onCreated={(newId) => nav(`/estrategias/${newId}${fromWizard ? '?retorno=assistente' : ''}`)}
        />
      )}
    </div>
  );
}

function flatten(o: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  } else out[prefix] = Array.isArray(o) ? o.join(',') : String(o);
  return out;
}

function VersionDiff({ a, b, aLabel, bLabel }: { a: StrategyConfig; b: StrategyConfig; aLabel: string; bLabel: string }) {
  const fa = flatten(a);
  const fb = flatten(b);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => fa[k] !== fb[k]);
  return (
    <div className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">
        Diferenças {aLabel} → {bLabel}
      </h3>
      {keys.length === 0 ? (
        <p className="text-sm text-slate-500">Sem diferenças.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Parâmetro</th>
              <th>{aLabel}</th>
              <th>{bLabel}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td className="font-mono text-xs">{k}</td>
                <td>{fa[k] ?? '—'}</td>
                <td>{fb[k] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CopyDialog({
  open,
  onOpenChange,
  source,
  config,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: StrategyDetail;
  config: StrategyConfig;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(`${source.name} (cópia)`);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post<{ id: string }>('/strategies', { name, config, copyOf: source.id }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['strategies'] });
      onOpenChange(false);
      onCreated(r.id);
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Criar cópia da estratégia"
      description="A cópia é independente: o original e as campanhas em operação permanecem preservados."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => (name.trim() ? m.mutate() : setErr('Informe o nome'))}>
            Criar cópia
          </Button>
        </>
      }
    >
      <Field label="Nome da nova estratégia" required error={err ?? undefined}>
        {(p) => <Input id={p.id} autoFocus value={name} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setName(e.target.value)} />}
      </Field>
    </Modal>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { clsx } from 'clsx';
import { ArrowLeft, Check, Copy, Lock, Pencil, Plus, RotateCcw, Save } from 'lucide-react';
import {
  TABULATION_ACTIONS,
  TABULATION_ACTION_LABEL,
  type StrategyConfig,
  type TabulationAction,
} from '@voll/shared';
import { errorMessage, get, post, put } from '../lib/api';
import type { DraftEnvelope, Strategy, StrategyDetail, StrategyVersion, Tabulation } from '../lib/types';
import { fmtDateTime, WEEKDAYS } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Card, Empty, ErrorState, Field, InfoTooltip, Input, Loading, Modal, PageHeader, Select, TableWrap, useToast } from '../components/ui';
import { StrategySummary, daysLabel, fmtMinutes } from '../components/Summaries';
import { StrategyForm } from '../components/StrategyForm';
import { WizardReturnBanner } from './NewCampaign';

export function StrategiesSection() {
  const q = useQuery({ queryKey: ['strategies'], queryFn: () => get<{ items: Strategy[] }>('/strategies') });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-slate-800">Estratégias Avançadas (Templates Versionados)</h2>
        <InfoTooltip content="Calendário operacional, limites de esforço, cadência de retentativas, otimização consultiva e regras por tabulação." />
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

function NewStrategyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const strategiesQ = useQuery({
    queryKey: ['strategies'],
    queryFn: () => get<{ items: Strategy[] }>('/strategies'),
    enabled: open,
  });

  const m = useMutation({
    mutationFn: async () => {
      const src = strategiesQ.data?.items.find((s) => s.id === sourceId) ?? strategiesQ.data?.items[0];
      const config = src?.latestVersion?.config ?? {
        calendar: { days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00', timezone: 'America/Sao_Paulo' },
        limits: { total: 8, daily: 3, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
        retry: { intervalMinutes: 30, maxPerDestination: 3 },
        distribution: { batchSize: 20, maxPending: 50, leaseSeconds: 60 },
        tabulationRules: {},
      };
      return post<{ id: string }>('/strategies', {
        name,
        config,
        copyOf: src?.id,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['strategies'] });
      toast('success', `Estratégia "${name}" criada com sucesso.`);
      setName('');
      setSourceId('');
      setErr(null);
      onOpenChange(false);
      nav(`/estrategias/${res.id}`);
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nova Estratégia"
      description="Crie um novo template com limites de esforço, janelas de horário e regras de retentativa."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              if (!name.trim()) return setErr('Informe o nome da estratégia');
              m.mutate();
            }}
          >
            Criar estratégia
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">{err}</div>}
        <Field label="Nome da nova estratégia" required>
          {(p) => <Input id={p.id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Cobrança Preventiva Digital" />}
        </Field>
        <Field label="Basear parâmetros em template existente" tooltip="Herda os limites de esforço, regras de tabulação e janelas para você personalizar.">
          {(p) => (
            <Select id={p.id} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Selecione um template base...</option>
              {strategiesQ.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.protected ? '(Predefinida)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

export function StrategiesPage() {
  const { can } = useAuth();
  const [openNew, setOpenNew] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Estratégias Avançadas"
        tooltip="Calendário operacional, limites de esforço diário/total, cadência de retentativas e regras por tabulação."
        actions={
          can('strategies.write') && (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpenNew(true)}>
              Nova estratégia
            </Button>
          )
        }
      />
      <StrategiesSection />
      <NewStrategyDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  );
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
            {fromWizard && latest && (
              <Button variant="primary" loading={useInWizard.isPending} onClick={() => useInWizard.mutate(latest.id)}>
                Usar estratégia publicada (v{latest.version})
              </Button>
            )}
            {can('strategies.write') && (
              <Button icon={<Copy className="size-4" aria-hidden />} onClick={() => setCopyOpen(true)}>
                Criar cópia
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

        <div>
          {current ? (
            <StrategyInteractiveConfig
              strategyId={id}
              version={current}
              isLatest={current.id === latest?.id}
              tabulations={tabs.data?.items}
              onUpdated={(v) => {
                setJustPublished(v);
                setSelected(null);
                qc.invalidateQueries({ queryKey: ['strategy', id] });
                qc.invalidateQueries({ queryKey: ['strategies'] });
              }}
            />
          ) : (
            <Card title="Configuração">
              <p>Sem versão publicada.</p>
            </Card>
          )}

          {current && latest && current.id !== latest.id && (
            <div className="mt-4">
              <Card title="Comparação de Versões">
                <VersionDiff a={current.config} b={latest.config} aLabel={`v${current.version}`} bLabel={`v${latest.version}`} />
              </Card>
            </div>
          )}
        </div>
      </div>

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

// Painel de Configuração Avançada em 2 Colunas com Edição Direta dos Campos e Regras
function StrategyInteractiveConfig({
  strategyId,
  version,
  isLatest,
  tabulations,
  onUpdated,
}: {
  strategyId: string;
  version: StrategyVersion;
  isLatest: boolean;
  tabulations?: Tabulation[];
  onUpdated: (v: StrategyVersion) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftConfig, setDraftConfig] = useState<StrategyConfig>(() => JSON.parse(JSON.stringify(version.config)));

  // Sincroniza draft se mudar de versão
  const [lastVerId, setLastVerId] = useState(version.id);
  if (version.id !== lastVerId) {
    setLastVerId(version.id);
    setDraftConfig(JSON.parse(JSON.stringify(version.config)));
    setEditing(false);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const v = await post<StrategyVersion>(`/strategies/${strategyId}/versions`, { config: draftConfig });
      onUpdated(v);
      setEditing(false);
      toast('success', `Nova versão v${v.version} salva e publicada.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraftConfig(JSON.parse(JSON.stringify(version.config)));
    setEditing(false);
  };

  const tabName = (code: string) => tabulations?.find((t) => t.code === code)?.name ?? code;

  // Lista de todas as tabulações do workspace para mapeamento
  const allTabs = tabulations ?? [];
  const tabEntries = allTabs.map((t) => ({
    code: t.code,
    name: t.name,
    action: (draftConfig.tabulationRules[t.code] ?? (t.isConversion ? 'FINISH_SUCCESS' : 'RETRY')) as TabulationAction,
  }));

  return (
    <div className="space-y-4">
      {/* Barra de Ações Superior do Painel de Configuração */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900">
            Configuração v{version.version}
          </span>
          {isLatest && <Badge tone="green">Versão Ativa</Badge>}
          {editing && <Badge tone="brand">Editando</Badge>}
        </div>

        <div className="flex items-center gap-2">
          {!editing ? (
            <Button
              size="sm"
              variant="primary"
              icon={<Pencil className="size-3.5" />}
              onClick={() => setEditing(true)}
            >
              Editar parâmetros
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={handleCancel} disabled={saving}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Save className="size-3.5" />}
                loading={saving}
                onClick={handleSave}
              >
                Salvar e publicar v{version.version + 1}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Grade em 2 Colunas (§Requisito: Coluna 1 = Parâmetros, Coluna 2 = Regras de Tabulação) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* =================================================================== */}
        {/* COLUNA 1: PARÂMETROS OPERACIONAIS DA ESTRATÉGIA                     */}
        {/* =================================================================== */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200/90 bg-white p-4 space-y-4 shadow-2xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-100 pb-2">
            Parâmetros de Cadência &amp; Limites
          </div>

          <div className="space-y-3.5 text-xs">
            {/* Limite Total por Cliente */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600">Limite total por cliente</span>
              {!editing ? (
                <span className="font-bold text-slate-900">{draftConfig.limits.total} tentativas</span>
              ) : (
                <div className="flex items-center gap-1.5 w-36">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={draftConfig.limits.total}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        limits: { ...prev.limits, total: Math.max(1, parseInt(e.target.value) || 1) },
                      }))
                    }
                    className="text-xs py-1 h-7"
                  />
                  <span className="text-slate-400 text-[11px]">tent.</span>
                </div>
              )}
            </div>

            {/* Limite Diário por Cliente */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600">Limite diário por cliente</span>
              {!editing ? (
                <span className="font-bold text-slate-900">{draftConfig.limits.daily} tentativas</span>
              ) : (
                <div className="flex items-center gap-1.5 w-36">
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={draftConfig.limits.daily}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        limits: { ...prev.limits, daily: Math.max(1, parseInt(e.target.value) || 1) },
                      }))
                    }
                    className="text-xs py-1 h-7"
                  />
                  <span className="text-slate-400 text-[11px]">tent.</span>
                </div>
              )}
            </div>

            {/* Escopo dos Limites */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600">Escopo dos limites</span>
              {!editing ? (
                <span className="font-bold text-slate-900">
                  {draftConfig.limits.scope === 'WORKSPACE'
                    ? 'Cliente no workspace (compartilhado)'
                    : 'Cliente nesta campanha'}
                </span>
              ) : (
                <Select
                  value={draftConfig.limits.scope}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      limits: { ...prev.limits, scope: e.target.value as 'WORKSPACE' | 'CAMPAIGN' },
                    }))
                  }
                  className="text-xs py-1 h-7 w-48"
                >
                  <option value="WORKSPACE">Cliente no workspace</option>
                  <option value="CAMPAIGN">Cliente nesta campanha</option>
                </Select>
              )}
            </div>

            {/* Dias Permitidos */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600 pt-1">Dias permitidos</span>
              {!editing ? (
                <span className="font-bold text-slate-900">{daysLabel(draftConfig.calendar.days)}</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d, i) => {
                    const isSelected = draftConfig.calendar.days.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          const currentDays = draftConfig.calendar.days;
                          const nextDays = isSelected
                            ? currentDays.filter((x) => x !== i)
                            : [...currentDays, i].sort();
                          if (nextDays.length > 0) {
                            setDraftConfig((prev) => ({
                              ...prev,
                              calendar: { ...prev.calendar, days: nextDays },
                            }));
                          }
                        }}
                        className={clsx(
                          'rounded-md px-2 py-0.5 text-[11px] font-semibold transition cursor-pointer',
                          isSelected
                            ? 'bg-brand-600 text-white shadow-2xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Janela de Horário */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600">Janela de horário</span>
              {!editing ? (
                <span className="font-bold text-slate-900">
                  {draftConfig.calendar.start} às {draftConfig.calendar.end}
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="time"
                    value={draftConfig.calendar.start}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        calendar: { ...prev.calendar, start: e.target.value },
                      }))
                    }
                    className="text-xs py-1 h-7 w-24"
                  />
                  <span className="text-slate-400">às</span>
                  <Input
                    type="time"
                    value={draftConfig.calendar.end}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        calendar: { ...prev.calendar, end: e.target.value },
                      }))
                    }
                    className="text-xs py-1 h-7 w-24"
                  />
                </div>
              )}
            </div>

            {/* Fuso Horário */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600">Fuso horário</span>
              {!editing ? (
                <span className="font-bold text-slate-900">{draftConfig.calendar.timezone}</span>
              ) : (
                <Select
                  value={draftConfig.calendar.timezone}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      calendar: { ...prev.calendar, timezone: e.target.value },
                    }))
                  }
                  className="text-xs py-1 h-7 w-48"
                >
                  <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                  <option value="America/Manaus">America/Manaus</option>
                  <option value="America/Fortaleza">America/Fortaleza</option>
                  <option value="America/Cuiaba">America/Cuiaba</option>
                </Select>
              )}
            </div>

            {/* Retentativa & Intervalo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600">Retentativa</span>
              {!editing ? (
                <span className="font-bold text-slate-900">
                  a cada {fmtMinutes(draftConfig.retry.intervalMinutes)}, até {draftConfig.retry.maxPerDestination} por destino
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={720}
                      value={draftConfig.retry.intervalMinutes}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          retry: {
                            ...prev.retry,
                            intervalMinutes: Math.max(1, parseInt(e.target.value) || 1),
                          },
                        }))
                      }
                      className="text-xs py-1 h-7 w-16"
                    />
                    <span className="text-[11px] text-slate-500">min</span>
                  </div>
                  <span className="text-slate-300">|</span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={draftConfig.retry.maxPerDestination}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          retry: {
                            ...prev.retry,
                            maxPerDestination: Math.max(1, parseInt(e.target.value) || 1),
                          },
                        }))
                      }
                      className="text-xs py-1 h-7 w-14"
                    />
                    <span className="text-[11px] text-slate-500">máx/dest.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Histórico Incompleto */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100/80 pb-2.5">
              <span className="font-medium text-slate-600">Histórico incompleto</span>
              {!editing ? (
                <span className="font-bold text-slate-900">
                  {draftConfig.limits.incompleteHistory === 'BLOCK'
                    ? 'Aguardar revisão (bloquear)'
                    : 'Usar somente o histórico conhecido'}
                </span>
              ) : (
                <Select
                  value={draftConfig.limits.incompleteHistory}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      limits: {
                        ...prev.limits,
                        incompleteHistory: e.target.value as 'BLOCK' | 'USE_KNOWN',
                      },
                    }))
                  }
                  className="text-xs py-1 h-7 w-48"
                >
                  <option value="USE_KNOWN">Usar somente o conhecido</option>
                  <option value="BLOCK">Aguardar revisão (bloquear)</option>
                </Select>
              )}
            </div>

            {/* Distribuição em Lote */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="font-medium text-slate-600">Distribuição</span>
              {!editing ? (
                <span className="font-bold text-slate-900">
                  lote {draftConfig.distribution.batchSize}, máx. {draftConfig.distribution.maxPending} pendentes, reserva {draftConfig.distribution.leaseSeconds}s
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">lote:</span>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={draftConfig.distribution.batchSize}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          distribution: {
                            ...prev.distribution,
                            batchSize: Math.max(1, parseInt(e.target.value) || 1),
                          },
                        }))
                      }
                      className="text-xs py-1 h-7 w-14"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">pend:</span>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={draftConfig.distribution.maxPending}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          distribution: {
                            ...prev.distribution,
                            maxPending: Math.max(1, parseInt(e.target.value) || 1),
                          },
                        }))
                      }
                      className="text-xs py-1 h-7 w-14"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* COLUNA 2: REGRAS DE TABULAÇÃO (EDITÁVEIS)                           */}
        {/* =================================================================== */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200/90 bg-white p-4 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Regras por Tabulação
            </div>
            <span className="text-[11px] text-slate-400">
              Ação imediata do motor para cada retorno do canal
            </span>
          </div>

          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            {tabEntries.map((item) => (
              <div
                key={item.code}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 hover:bg-slate-50 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-xs text-slate-800 truncate">
                    {item.name}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {item.code}
                  </div>
                </div>

                {!editing ? (
                  <Badge tone={item.action === 'FINISH_SUCCESS' ? 'green' : item.action === 'NEXT_DESTINATION' ? 'blue' : 'gray'}>
                    {TABULATION_ACTION_LABEL[item.action] ?? item.action}
                  </Badge>
                ) : (
                  <Select
                    value={item.action}
                    onChange={(e) => {
                      const nextAct = e.target.value as TabulationAction;
                      setDraftConfig((prev) => ({
                        ...prev,
                        tabulationRules: {
                          ...prev.tabulationRules,
                          [item.code]: nextAct,
                        },
                      }));
                    }}
                    className="text-xs py-1 h-7 w-44"
                  >
                    {TABULATION_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {TABULATION_ACTION_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11px] text-slate-500 leading-snug">
            💡 <strong>Regra de Conformidade:</strong> Caso o cliente solicite não ser contatado (Opt-Out / DNC), o motor aplica o bloqueio permanente e encerra o fluxo imediatamente, prevalecendo sobre qualquer tabulação manual.
          </div>
        </div>
      </div>
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

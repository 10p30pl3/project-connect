import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Bookmark,
  CheckCircle2,
  Copy,
  Edit,
  ExternalLink,
  Layers,
  Megaphone,
  MoreVertical,
  Plus,
  Rocket,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  CHANNEL_LABEL,
  OPERATION_PURPOSES,
  type ChannelType,
  type OperationPurpose,
} from '@voll/shared';
import { del, get, post, put } from '../lib/api';
import type { CampaignTemplate, Journey, Strategy } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  InfoTooltip,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  Textarea,
  useToast,
} from '../components/ui';

const PURPOSE_INFO: Record<string, { label: string; tone: 'amber' | 'brand' | 'green' | 'blue' | 'gray' }> = {
  COBRANCA: { label: 'Cobrança', tone: 'amber' },
  VENDAS: { label: 'Vendas', tone: 'brand' },
  AGENDAMENTOS: { label: 'Agendamentos', tone: 'green' },
  CONFIRMACAO_SERVICO: { label: 'Serviços', tone: 'blue' },
  ATENDIMENTO_SUPORTE: { label: 'Suporte 24x7', tone: 'blue' },
  PESQUISA_RELACIONAMENTO: { label: 'Relacionamento (NPS)', tone: 'green' },
};

const CATEGORIES: { id: string; label: string; purposes?: OperationPurpose[] }[] = [
  { id: 'ALL', label: 'Todos os modelos' },
  { id: 'COBRANCA', label: 'Cobrança & Recuperação', purposes: ['COBRANCA'] },
  { id: 'VENDAS', label: 'Vendas & Expansão', purposes: ['VENDAS'] },
  { id: 'AGENDAMENTOS', label: 'Agendamentos & Serviços', purposes: ['AGENDAMENTOS', 'CONFIRMACAO_SERVICO'] },
  { id: 'RELACIONAMENTO', label: 'Suporte & Relacionamento', purposes: ['ATENDIMENTO_SUPORTE', 'PESQUISA_RELACIONAMENTO'] },
];

export function CampaignTemplatesPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [editTarget, setEditTarget] = useState<CampaignTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CampaignTemplate | null>(null);

  // Queries
  const q = useQuery({
    queryKey: ['campaign-templates'],
    queryFn: () => get<{ items: CampaignTemplate[] }>('/campaign-templates'),
  });

  const journeysQ = useQuery({
    queryKey: ['journeys'],
    queryFn: () => get<{ items: Journey[] }>('/journeys'),
  });

  const stratQ = useQuery({
    queryKey: ['strategies'],
    queryFn: () => get<{ items: Strategy[] }>('/strategies'),
  });

  // Mutação para deletar
  const deleteM = useMutation({
    mutationFn: (id: string) => del(`/campaign-templates/${id}`),
    onSuccess: () => {
      toast('success', 'Modelo excluído com sucesso.');
      qc.invalidateQueries({ queryKey: ['campaign-templates'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast('error', e?.message || 'Falha ao excluir o modelo.'),
  });

  // Mutação para duplicar
  const duplicateM = useMutation({
    mutationFn: (tmpl: CampaignTemplate) =>
      post<CampaignTemplate>('/campaign-templates', {
        name: `${tmpl.name} (Cópia)`,
        description: tmpl.description,
        journeyId: tmpl.journeyId,
        journeyVersionId: tmpl.journeyVersionId,
        strategyId: tmpl.strategyId,
        strategyVersionId: tmpl.strategyVersionId,
        purposeCode: tmpl.purposeCode,
        startMode: tmpl.startMode,
      }),
    onSuccess: (data) => {
      toast('success', `Cópia "${data.name}" criada com sucesso.`);
      qc.invalidateQueries({ queryKey: ['campaign-templates'] });
    },
    onError: (e: any) => toast('error', e?.message || 'Falha ao duplicar o modelo.'),
  });

  const items = q.data?.items ?? [];
  const journeys = journeysQ.data?.items ?? [];
  const strategies = stratQ.data?.items ?? [];

  const journeyMap = new Map<string, Journey>();
  for (const j of journeys) journeyMap.set(j.id, j);

  const stratMap = new Map<string, Strategy>();
  for (const s of strategies) stratMap.set(s.id, s);

  const categoryCounts = CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = items.filter((t) => {
      if (!cat.purposes) return true;
      return cat.purposes.includes(t.purposeCode as OperationPurpose);
    }).length;
    return acc;
  }, {} as Record<string, number>);

  const filtered = items.filter((t) => {
    const matchesSearch =
      !search.trim() ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(search.toLowerCase())) ||
      t.journeyName.toLowerCase().includes(search.toLowerCase()) ||
      t.strategyName.toLowerCase().includes(search.toLowerCase());

    const currentCat = CATEGORIES.find((c) => c.id === activeCategory);
    const matchesCategory =
      !currentCat ||
      !currentCat.purposes ||
      currentCat.purposes.includes(t.purposeCode as OperationPurpose);

    return matchesSearch && matchesCategory;
  });

  const totalTemplates = items.length;
  const mostUsed = items.slice().sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))[0];

  function getJourneyChannels(journeyName: string, j?: Journey): ChannelType[] {
    if (j?.latestVersion?.steps && j.latestVersion.steps.length > 0) {
      return Array.from(new Set(j.latestVersion.steps.map((s) => s.channelType)));
    }
    const name = journeyName.toLowerCase();
    const channels: ChannelType[] = [];
    if (name.includes('whatsapp') || name.includes('360')) channels.push('WHATSAPP');
    if (name.includes('voz') || name.includes('discador') || name.includes('360')) channels.push('VOICE');
    if (name.includes('sms') || name.includes('360')) channels.push('SMS');
    if (name.includes('e-mail') || name.includes('email') || name.includes('360')) channels.push('EMAIL');
    return channels.length > 0 ? channels : ['VOICE'];
  }

  function formatStrategySummary(stratName: string, s?: Strategy): { cadence: string; hours: string } {
    const cfg = s?.latestVersion?.config;
    if (cfg) {
      const limits = cfg.limits;
      const total = limits?.total ?? 1;
      const daily = limits?.daily;
      const cal = cfg.calendar;
      const is24x7 = cal?.days?.length === 7 && cal?.start === '00:00' && cal?.end === '23:59';
      const cadence = total === 1 ? 'Disparo único (1 tent.)' : `${total} tent.${daily ? ` (máx ${daily}/dia)` : ''}`;
      const hours = is24x7 ? '24h ininterrupto' : cal ? `${cal.start} às ${cal.end}` : 'Horário comercial';
      return { cadence, hours };
    }
    const name = stratName.toLowerCase();
    if (name.includes('único')) return { cadence: 'Disparo único (1 tent.)', hours: '08:00 às 18:00' };
    if (name.includes('24x7')) return { cadence: 'Até 6 tent. (máx 4/dia)', hours: '24h ininterrupto' };
    if (name.includes('comercial')) return { cadence: '3 tent. (máx 1/dia)', hours: '09:00 às 18:00' };
    if (name.includes('intensiva')) return { cadence: '15 tent. (máx 5/dia)', hours: '08:00 às 21:00 (Seg a Sáb)' };
    if (name.includes('agendamentos')) return { cadence: '4 tent. (máx 2/dia)', hours: '08:00 às 20:00 (Seg a Sáb)' };
    return { cadence: '10 tent. (máx 3/dia)', hours: '08:00 às 20:00 (Seg a Sex)' };
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Modelos de Campanhas"
        tooltip="Modelos reutilizáveis contendo configurações predefinidas de jornadas, estratégias e acionamento. Aplique a qualquer mailing com 1 clique."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setCreateOpen(true)}
              icon={<Plus className="size-3.5" />}
            >
              Novo modelo
            </Button>
            <Button
              variant="primary"
              onClick={() => nav('/campanhas/nova')}
              icon={<Rocket className="size-3.5" />}
            >
              Nova campanha
            </Button>
          </div>
        }
      />

      {/* Explicação de como funciona o modelo */}
      <div className="flex flex-col gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Bookmark className="size-4 text-brand-700" />
            <span className="text-xs font-semibold text-brand-900">Como funcionam os modelos de campanha?</span>
          </div>
          <p className="text-xs text-brand-800 leading-relaxed">
            Um modelo salva todas as regras de <strong>Jornada</strong>, <strong>Estratégia</strong> e <strong>Acionamento</strong>. O mailing e os filtros não são incluídos, permitindo que você aplique a mesma receita para qualquer base com rapidez e consistência.
          </p>
        </div>
        <Link
          to="/campanhas"
          className="shrink-0 text-xs font-medium text-brand-700 hover:text-brand-900 hover:underline"
        >
          Ver campanhas em andamento →
        </Link>
      </div>

      {/* Métricas Consolidadas */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Total de modelos" tooltip="Quantidade de modelos salvos e prontos para uso.">
          <Stat label="Modelos cadastrados" value={fmtNumber(totalTemplates)} tone="good" />
        </Card>
        <Card title="Modelo mais utilizado" tooltip="Modelo com maior número de campanhas criadas.">
          <Stat
            label={mostUsed ? mostUsed.name : 'Nenhum'}
            value={mostUsed ? `${fmtNumber(mostUsed.usageCount ?? 0)} campanhas` : '—'}
          />
        </Card>
        <Card title="Agilidade operacional" tooltip="Economia de tempo ao criar campanhas pré-configuradas.">
          <Stat label="Tempo médio de lançamento" value="< 1 min" tone="good" />
        </Card>
      </div>

      {/* Categorias e Busca */}
      <div className="space-y-3">
        {/* Pills de Categoria */}
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((cat) => {
            const isSelected = activeCategory === cat.id;
            const count = categoryCounts[cat.id] ?? 0;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer',
                  isSelected
                    ? 'bg-brand-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                <span>{cat.label}</span>
                <span
                  className={clsx(
                    'inline-flex items-center justify-center rounded-full text-[10px] font-semibold px-1.5 py-0.5',
                    isSelected ? 'bg-brand-800 text-white' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Barra de Busca e Indicador */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-64 max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, jornada ou estratégia..."
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="text-xs text-slate-500">
            Exibindo <span className="font-semibold text-slate-800">{filtered.length}</span> de{' '}
            <span className="font-semibold text-slate-800">{totalTemplates}</span> modelos
          </div>
        </div>
      </div>

      {/* Listagem de Modelos */}
      {q.isLoading ? (
        <Loading rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : filtered.length === 0 ? (
        <Empty
          title={search || activeCategory !== 'ALL' ? 'Nenhum modelo encontrado' : 'Nenhum modelo cadastrado'}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setActiveCategory('ALL');
              }}
            >
              Limpar filtros
            </Button>
          }
        >
          {search || activeCategory !== 'ALL'
            ? 'Ajuste os termos da busca ou selecione outra categoria para ver outros modelos.'
            : 'Crie um modelo manual ou salve qualquer campanha existente como modelo.'}
        </Empty>
      ) : (
        <Card padded={false}>
          <TableWrap label="Modelos de Campanhas">
            <table className="data">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Jornada & Canais</th>
                  <th>Estratégia & Cadência</th>
                  <th>Finalidade</th>
                  <th>Uso</th>
                  <th>Origem</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const j = journeyMap.get(t.journeyId);
                  const channels = getJourneyChannels(t.journeyName, j);
                  const s = stratMap.get(t.strategyId);
                  const stratInfo = formatStrategySummary(t.strategyName, s);
                  const purposeMeta = t.purposeCode && PURPOSE_INFO[t.purposeCode]
                    ? PURPOSE_INFO[t.purposeCode]
                    : { label: t.purposeCode ?? 'Geral', tone: 'gray' as const };

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="min-w-64">
                        <div className="flex items-start gap-2">
                          <Bookmark className="size-4 shrink-0 text-brand-700 mt-0.5" />
                          <div>
                            <span className="font-semibold text-slate-900 block text-xs">{t.name}</span>
                            {t.description && (
                              <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 leading-relaxed">
                                {t.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 font-medium text-slate-800 text-xs">
                            <Layers className="size-3 text-slate-400" />
                            <span>{t.journeyName}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {channels.map((ch) => {
                              const badgeCls =
                                ch === 'WHATSAPP'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : ch === 'VOICE'
                                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                                    : ch === 'SMS'
                                      ? 'bg-purple-50 text-purple-700 border-purple-200'
                                      : 'bg-amber-50 text-amber-700 border-amber-200';
                              return (
                                <span
                                  key={ch}
                                  className={clsx(
                                    'inline-flex items-center rounded border px-1.5 py-0.2 text-[10px] font-medium',
                                    badgeCls,
                                  )}
                                >
                                  {CHANNEL_LABEL[ch] ?? ch}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 font-medium text-slate-800 text-xs">
                            <SlidersHorizontal className="size-3 text-slate-400" />
                            <span>{t.strategyName}</span>
                            {t.strategyVersion && (
                              <span className="text-[10px] text-slate-400">v{t.strategyVersion}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 leading-tight">
                            <span>{stratInfo.cadence}</span>
                            <span className="mx-1 text-slate-300">•</span>
                            <span className="text-slate-400">{stratInfo.hours}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={purposeMeta.tone}>
                          {purposeMeta.label}
                        </Badge>
                      </td>
                      <td>
                        <div className="text-xs font-semibold text-slate-700">
                          {fmtNumber(t.usageCount ?? 0)}
                          <span className="ml-1 text-[11px] font-normal text-slate-400">campanhas</span>
                        </div>
                      </td>
                      <td>
                        <div className="text-xs text-slate-500">
                          {t.sourceCampaignName ? (
                            <span title={t.sourceCampaignName} className="truncate max-w-28 block">
                              {t.sourceCampaignName}
                            </span>
                          ) : (
                            <span className="text-slate-400">Catálogo Base</span>
                          )}
                        </div>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Botão Usar Modelo: Redireciona para /campanhas/nova?modeloId=... */}
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<Rocket className="size-3.5" />}
                            onClick={() => nav(`/campanhas/nova?modeloId=${t.id}`)}
                            title="Iniciar criação de campanha com este modelo pré-selecionado"
                          >
                            Usar modelo
                          </Button>

                          {/* Duplicar */}
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Copy className="size-3.5" />}
                            onClick={() => duplicateM.mutate(t)}
                            disabled={duplicateM.isPending}
                            title="Duplicar modelo"
                          >
                            Duplicar
                          </Button>

                          {/* Editar */}
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Edit className="size-3.5" />}
                            onClick={() => setEditTarget(t)}
                            title="Editar modelo"
                          >
                            Editar
                          </Button>

                          {/* Excluir */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-700 hover:bg-red-50"
                            icon={<Trash2 className="size-3.5" />}
                            onClick={() => setDeleteTarget(t)}
                            title="Excluir modelo"
                          >
                            Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {/* Modal Criar/Editar Modelo */}
      {(createOpen || editTarget) && (
        <TemplateFormModal
          open={createOpen || !!editTarget}
          target={editTarget}
          journeys={journeysQ.data?.items ?? []}
          strategies={stratQ.data?.items ?? []}
          onClose={() => {
            setCreateOpen(false);
            setEditTarget(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditTarget(null);
            qc.invalidateQueries({ queryKey: ['campaign-templates'] });
          }}
        />
      )}

      {/* Modal Confirmar Exclusão */}
      {deleteTarget && (
        <Modal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title="Excluir modelo de campanha"
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-600">
              Tem certeza que deseja excluir o modelo <strong>{deleteTarget.name}</strong>?
            </p>
            <p className="text-[11px] text-slate-500">
              As campanhas já criadas a partir deste modelo não serão afetadas.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => deleteM.mutate(deleteTarget.id)}
                disabled={deleteM.isPending}
              >
                {deleteM.isPending ? 'Excluindo...' : 'Sim, excluir'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Sub-componente do Modal de Criação / Edição de Modelo
function TemplateFormModal({
  open,
  target,
  journeys,
  strategies,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: CampaignTemplate | null;
  journeys: Journey[];
  strategies: Strategy[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [purposeCode, setPurposeCode] = useState<OperationPurpose>(target?.purposeCode ?? 'COBRANCA');
  const [journeyId, setJourneyId] = useState(target?.journeyId ?? (journeys[0]?.id || ''));
  const [strategyId, setStrategyId] = useState(target?.strategyId ?? (strategies[0]?.id || ''));
  const [error, setError] = useState<string | null>(null);

  const saveM = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Informe o nome do modelo.');
      const selJourney = journeys.find((j) => j.id === journeyId);
      const selStrat = strategies.find((s) => s.id === strategyId);

      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        purposeCode,
        journeyId,
        journeyVersionId: selJourney?.latestVersion?.id,
        strategyId,
        strategyVersionId: selStrat?.latestVersion?.id,
      };

      if (target) {
        return put(`/campaign-templates/${target.id}`, payload);
      }
      return post('/campaign-templates', payload);
    },
    onSuccess: () => {
      toast('success', target ? 'Modelo atualizado com sucesso!' : 'Modelo criado com sucesso!');
      onSaved();
    },
    onError: (e: any) => setError(e?.message || 'Falha ao salvar modelo.'),
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={target ? 'Editar modelo de campanha' : 'Novo modelo de campanha'}
    >
      <div className="space-y-4">
        <Alert tone="info" title="Configuração reutilizável">
          <span>
            Este modelo armazena a combinação de Jornada e Estratégia. Bases de contatos e filtros serão vinculados quando o modelo for utilizado.
          </span>
        </Alert>

        <Field label="Nome do modelo" required error={error ?? undefined}>
          {(f) => (
            <Input
              id={f.id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Cobrança Digital 30d (WhatsApp + Voz)"
              autoFocus
            />
          )}
        </Field>

        <Field label="Descrição (opcional)">
          {(f) => (
            <Textarea
              id={f.id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Objetivo operacional e boas práticas para utilização deste modelo..."
            />
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Jornada (Caminho dos canais)" required>
            {(f) => (
              <select
                id={f.id}
                value={journeyId}
                onChange={(e) => setJourneyId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 px-3 text-xs text-slate-800 focus:border-brand-500 focus:outline-hidden"
              >
                {journeys.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Estratégia (Cadência e regras)" required>
            {(f) => (
              <select
                id={f.id}
                value={strategyId}
                onChange={(e) => setStrategyId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 px-3 text-xs text-slate-800 focus:border-brand-500 focus:outline-hidden"
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field label="Finalidade da operação">
          {(f) => (
            <select
              id={f.id}
              value={purposeCode}
              onChange={(e) => setPurposeCode(e.target.value as OperationPurpose)}
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 px-3 text-xs text-slate-800 focus:border-brand-500 focus:outline-hidden"
            >
              {OPERATION_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <Button variant="secondary" onClick={onClose} disabled={saveM.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => saveM.mutate()}
            disabled={saveM.isPending || !name.trim()}
          >
            {saveM.isPending ? 'Salvando...' : target ? 'Atualizar modelo' : 'Salvar modelo'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

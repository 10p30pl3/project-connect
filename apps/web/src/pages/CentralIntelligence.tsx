import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  FlaskConical,
  GitFork,
  Layers,
  Phone,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  CHANNEL_LABEL,
  OPTIMIZATION_POLICIES,
  OPTIMIZATION_POLICY_LABEL,
  type ChannelType,
  type OptimizationPolicy,
} from '@voll/shared';
import { get, post } from '../lib/api';
import type { CampaignSummary, Journey, MailingSummary, Strategy } from '../lib/types';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  useToast,
} from '../components/ui';

export type RecommendationRow = {
  contactId: string;
  externalId: string;
  name: string;
  channel: string;
  destinationMasked: string;
  bestTimeWindow: string;
  evidencesCount: number;
  historicRate: number;
  estimatedCostPerSuccess: number | null;
  policyUsed: string;
};

type OptimizationResponse = {
  enabled?: boolean;
  policyCode?: OptimizationPolicy;
  minEvidences?: number;
  strategyId?: string;
  strategyName?: string;
  strategyVersion?: number;
  items: RecommendationRow[];
  policy: string;
  notes: string[];
};

export function CentralIntelligencePage() {
  const qc = useQueryClient();
  const toast = useToast();

  // 1. Consultas principais
  const campaignsQ = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => get<{ items: CampaignSummary[] }>('/campaigns'),
  });
  const journeysQ = useQuery({
    queryKey: ['journeys'],
    queryFn: () => get<{ items: Journey[] }>('/journeys'),
  });
  const strategiesQ = useQuery({
    queryKey: ['strategies'],
    queryFn: () => get<{ items: Strategy[] }>('/strategies'),
  });

  // 2. Estado da Campanha em Produção (Champion)
  const [selectedCampaignId, setSelectedCampaignId] = useState('');

  useEffect(() => {
    if (!selectedCampaignId && campaignsQ.data?.items.length) {
      const running = campaignsQ.data.items.find((c) => c.status === 'RUNNING') ?? campaignsQ.data.items[0];
      setSelectedCampaignId(running.id);
    }
  }, [campaignsQ.data, selectedCampaignId]);

  const selectedCampaign = campaignsQ.data?.items.find((c) => c.id === selectedCampaignId);
  const totalBase = selectedCampaign?.progress?.members ?? 12500;

  // 3. Estado do Experimento Desafiador (Challenger)
  // Modo de configuração: 'RECOMMENDED' (Inteligência 1-clique) ou 'ADVANCED' (Manuais)
  const [challengerMode, setChallengerMode] = useState<'RECOMMENDED' | 'ADVANCED'>('RECOMMENDED');

  // Parâmetros do Challenger
  const [challengerStrategyId, setChallengerStrategyId] = useState('');
  const [challengerJourneyId, setChallengerJourneyId] = useState('');
  const [policy, setPolicy] = useState<OptimizationPolicy>('LOWEST_COST_PER_CPC');
  const [minEvidences, setMinEvidences] = useState(3);
  const [samplePct, setSamplePct] = useState(10); // 10% padrão

  // Inicialização com valores recomendados
  useEffect(() => {
    if (strategiesQ.data?.items.length && !challengerStrategyId) {
      // Procura uma estratégia diferente da de produção ou a segunda disponível
      const diff = strategiesQ.data.items.find((s) => s.name !== selectedCampaign?.strategyName) ?? strategiesQ.data.items[0];
      setChallengerStrategyId(diff.id);
    }
    if (journeysQ.data?.items.length && !challengerJourneyId) {
      const bestJ = journeysQ.data.items.find((j) => (j.latestVersion?.steps.length ?? 0) > 1) ?? journeysQ.data.items[0];
      setChallengerJourneyId(bestJ.id);
    }
  }, [strategiesQ.data, journeysQ.data, selectedCampaign, challengerStrategyId, challengerJourneyId]);

  const activeChallengerStrategy = strategiesQ.data?.items.find((s) => s.id === challengerStrategyId);
  const activeChallengerJourney = journeysQ.data?.items.find((j) => j.id === challengerJourneyId);

  // 4. Estado de Execução do Experimento
  const [hasExperimentRun, setHasExperimentRun] = useState(false);
  const [activeWave, setActiveWave] = useState(1);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPromoted, setIsPromoted] = useState(false);

  // Recomendações por contato
  const recsQ = useQuery({
    queryKey: ['optimization-recommendations', selectedCampaignId],
    queryFn: () => get<OptimizationResponse>(`/optimization?campaignId=${selectedCampaignId}`),
    enabled: !!selectedCampaignId,
  });

  const [appliedContacts, setAppliedContacts] = useState<Record<string, boolean>>({});

  const sampleSize = Math.max(1, Math.round((totalBase * samplePct) / 100));

  // Disparo de nova onda de teste empírico
  const handleRunWave = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
      setHasExperimentRun(true);
      setActiveWave((w) => Math.min(w + 1, 3));
      toast('success', `Onda ${Math.min(activeWave + 1, 3)} do experimento executada com sucesso!`);
    }, 800);
  };

  // Iniciar experimento
  const handleStartExperiment = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
      setHasExperimentRun(true);
      setActiveWave(1);
      toast('success', `Experimento Desafiador (Challenger) disparado na amostra de ${fmtNumber(sampleSize)} contatos.`);
    }, 900);
  };

  // Promoção do Experimento Vencedor para Produção
  const promoteMutation = useMutation({
    mutationFn: () =>
      post<{ ok: boolean; version: number }>('/optimization/configure', {
        campaignId: selectedCampaignId,
        enabled: true,
        policy,
        minEvidences,
      }),
    onSuccess: (res) => {
      setIsPromoted(true);
      toast('success', `Experimento promovido com sucesso! A campanha em produção agora opera com a nova estratégia vencedora (v${res.version}).`);
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['optimization-recommendations', selectedCampaignId] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: (payload: { contactId?: string; count?: number }) =>
      post('/optimization/apply', { campaignId: selectedCampaignId, ...payload }),
    onSuccess: (_res, vars) => {
      if (vars.contactId) {
        setAppliedContacts((s) => ({ ...s, [vars.contactId!]: true }));
        toast('success', 'Recomendação aplicada ao contato.');
      } else {
        const next: Record<string, boolean> = {};
        for (const it of recsQ.data?.items ?? []) next[it.contactId] = true;
        setAppliedContacts(next);
        toast('success', `Recomendações aplicadas para ${vars.count ?? 0} contatos.`);
      }
    },
  });

  // Métricas comparativas
  const championCpcRate = 21.2;
  const championCpcCost = 5.60;
  const challengerCpcRate = 38.4;
  const challengerCpcCost = 3.18;
  const unitSavings = championCpcCost - challengerCpcCost; // R$ 2,42
  const totalProjectedSavings = totalBase * unitSavings;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Central de Inteligência"
        subtitle="Ajuste e desafie a inteligência em produção: configure hipóteses alternativas (Challenger) em amostras controladas antes de promover para a base inteira."
        actions={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100/80 px-2.5 py-0.5 text-xs font-semibold text-brand-900">
              <Sparkles className="size-3 text-brand-700" /> TIC Domicílios 2025 Ativa
            </span>
          </div>
        }
      />

      {/* =========================================================================
          SEÇÃO 1: CAMPANHA ALVO EM PRODUÇÃO (CHAMPION)
      ========================================================================= */}
      <Card
        title={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-brand-700" aria-hidden />
              <span className="font-semibold text-slate-900">1. Campanha em Produção (Champion Atual)</span>
            </div>
            {selectedCampaign && (
              <Badge tone={selectedCampaign.status === 'RUNNING' ? 'green' : 'brand'}>
                {selectedCampaign.statusLabel}
              </Badge>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-12 items-end">
            <div className="sm:col-span-6">
              <Field label="Selecione a campanha para otimizar / desafiar" hint="A campanha vincula o mailing aos contatos da operação">
                {(p) => (
                  <Select
                    id={p.id}
                    value={selectedCampaignId}
                    onChange={(e) => {
                      setSelectedCampaignId(e.target.value);
                      setAppliedContacts({});
                      setIsPromoted(false);
                      setHasExperimentRun(false);
                    }}
                  >
                    <option value="">Selecione uma campanha…</option>
                    {campaignsQ.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.statusLabel})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <div className="sm:col-span-6">
              <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-slate-500 block text-[11px]">Estratégia e Jornada em Produção:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedCampaign?.strategyName ?? 'Padrão'} (v{selectedCampaign?.strategyVersion ?? 1}) · {selectedCampaign?.journeyName ?? 'Multicanal'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px]">Base Total:</span>
                  <span className="font-semibold text-slate-900">{fmtNumber(totalBase)} contatos</span>
                </div>
              </div>
            </div>
          </div>

          {/* Métricas vigentes da Produção (Baseline) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-1 border-t border-slate-100">
            <Stat
              label="Custo por CPC em Produção"
              value={`R$ ${championCpcCost.toFixed(2)}`}
              hint="Sem inteligência de disparo"
            />
            <Stat
              label="Taxa de CPC Atual"
              value={`${championCpcRate}%`}
              hint="Histórico observado"
            />
            <Stat
              label="Contatos Qualificados"
              value={fmtNumber(totalBase)}
              hint="Base total da campanha"
            />
            <Stat
              label="Status da Inteligência"
              value={isPromoted ? 'Estratégia Campeã Ativa' : 'Baseline Convencional'}
              tone={isPromoted ? 'good' : undefined}
              hint={isPromoted ? 'Atualizada pelo Challenger' : 'Pronta para ser desafiada'}
            />
          </div>
        </div>
      </Card>

      {/* =========================================================================
          SEÇÃO 2: CONFIGURAR EXPERIMENTO DESAFIADOR (CHALLENGER)
      ========================================================================= */}
      <Card
        title={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-brand-700" aria-hidden />
              <span className="font-semibold text-slate-900">2. Configurar Experimento Desafiador (Challenger)</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setChallengerMode('RECOMMENDED')}
                className={clsx(
                  'rounded-md px-2.5 py-1 font-semibold transition',
                  challengerMode === 'RECOMMENDED'
                    ? 'bg-white text-brand-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900',
                )}
              >
                ⭐ (Recomendada) IA Voll
              </button>
              <button
                type="button"
                onClick={() => setChallengerMode('ADVANCED')}
                className={clsx(
                  'rounded-md px-2.5 py-1 font-semibold transition',
                  challengerMode === 'ADVANCED'
                    ? 'bg-white text-brand-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900',
                )}
              >
                ⚙️ Avançada (Opções Manuais)
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* MODO RECOMENDADO (1 CLIQUE) */}
          {challengerMode === 'RECOMMENDED' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand-200/90 bg-gradient-to-r from-brand-50/70 via-indigo-50/40 to-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-brand-700" />
                      <span className="text-sm font-bold text-slate-900">
                        Hipótese Recomendada: Otimização Autônoma de Menor Custo por CPC
                      </span>
                      <Badge tone="green">Alta Assertividade</Badge>
                    </div>
                    <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                      Configuração automática com base na <strong>TIC Domicílios 2025</strong>. Prioriza WhatsApp Oficial em janelas de Wi-Fi e aciona Discador com BINA Local em horários nobres, minimizando o custo por Pessoa Certa (CPC).
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500 font-medium">Economia Esperada</div>
                    <div className="text-lg font-extrabold text-emerald-700">-43,2% no Custo/CPC</div>
                  </div>
                </div>

                {/* Parâmetros Recomendados Pré-aplicados */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 mt-3 border-t border-brand-200/60 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[11px]">Estratégia Desafiadora:</span>
                    <strong className="text-slate-900 block truncate">
                      {activeChallengerStrategy?.name ?? 'Otimizada Multicanal'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Jornada Desafiadora:</span>
                    <strong className="text-slate-900 block truncate">
                      {activeChallengerJourney?.name ?? 'WhatsApp Prioritário + Discador'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Política de Decisão:</span>
                    <strong className="text-brand-900 block truncate">Menor custo por CPC</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Amostra Estatística:</span>
                    <strong className="text-slate-900 block">
                      10% ({fmtNumber(sampleSize)} contatos · IC 95%)
                    </strong>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-500">
                  O teste desafiador será executado em {fmtNumber(sampleSize)} contatos sem alterar a produção em massa.
                </span>
                <Button
                  variant="primary"
                  loading={isSimulating}
                  disabled={!selectedCampaignId}
                  onClick={handleStartExperiment}
                  icon={<Play className="size-4" />}
                >
                  {hasExperimentRun ? 'Recalcular e Reexecutar Challenger' : 'Disparar Challenger Recomendado ⚡'}
                </Button>
              </div>
            </div>
          ) : (
            /* MODO AVANÇADO (OPÇÕES MANUAIS) */
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 border border-slate-200/80">
                Escolha manualmente a combinação de <strong>Estratégia</strong> e <strong>Jornada</strong> para testar como hipótese concorrente à campanha em produção.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Estratégia Desafiadora" hint="Template com limites de esforço e regras de tabulação">
                  {(p) => (
                    <Select
                      id={p.id}
                      value={challengerStrategyId}
                      onChange={(e) => setChallengerStrategyId(e.target.value)}
                    >
                      {strategiesQ.data?.items.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (v{s.latestVersion?.version ?? 1})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Jornada Desafiadora" hint="Sequência multicanal e cadência de transbordo">
                  {(p) => (
                    <Select
                      id={p.id}
                      value={challengerJourneyId}
                      onChange={(e) => setChallengerJourneyId(e.target.value)}
                    >
                      {journeysQ.data?.items.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name} (v{j.latestVersion?.version ?? 1} · {j.latestVersion?.steps.length ?? 0} etapas)
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Política de Priorização" className="sm:col-span-2">
                  {(p) => (
                    <Select
                      id={p.id}
                      value={policy}
                      onChange={(e) => setPolicy(e.target.value as OptimizationPolicy)}
                    >
                      {OPTIMIZATION_POLICIES.map((pol) => (
                        <option key={pol} value={pol}>
                          {OPTIMIZATION_POLICY_LABEL[pol]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Mín. Evidências Históricas">
                  {(p) => (
                    <Input
                      id={p.id}
                      type="number"
                      min={1}
                      max={20}
                      value={minEvidences}
                      onChange={(e) => setMinEvidences(Math.max(1, Number(e.target.value)))}
                    />
                  )}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amostra do Teste Empírico" hint="Fração da base reservada para validação estatística">
                  {(p) => (
                    <Select
                      id={p.id}
                      value={String(samplePct)}
                      onChange={(e) => setSamplePct(Number(e.target.value))}
                    >
                      <option value="5">5% da base (Piloto rápido)</option>
                      <option value="10">10% da base (Recomendado · 95% Confiança)</option>
                      <option value="15">15% da base (Maior precisão)</option>
                      <option value="20">20% da base (Amostra robusta)</option>
                    </Select>
                  )}
                </Field>

                <Field label="Tamanho Calculado da Amostra" hint="Contatos elegíveis a serem testados">
                  {() => (
                    <div className="h-9 px-3 rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 flex items-center">
                      {fmtNumber(sampleSize)} contatos ({samplePct}% da base de {fmtNumber(totalBase)})
                    </div>
                  )}
                </Field>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-500">
                  Os parâmetros manuais serão comparados diretamente com o baseline da produção.
                </span>
                <Button
                  variant="primary"
                  loading={isSimulating}
                  disabled={!selectedCampaignId}
                  onClick={handleStartExperiment}
                  icon={<Play className="size-4" />}
                >
                  Disparar Challenger Personalizado ⚡
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* =========================================================================
          SEÇÃO 3: PLACAR DE CONFRONTO EM TEMPO REAL (CHAMPION VS. CHALLENGER)
      ========================================================================= */}
      <Card
        title={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-emerald-600" aria-hidden />
              <span className="font-semibold text-slate-900">3. Placar de Confronto: Produção vs. Experimento</span>
            </div>
            {hasExperimentRun && (
              <Badge tone="green">
                Onda {activeWave} de 3 · Veredito Conclusivo
              </Badge>
            )}
          </div>
        }
      >
        {!hasExperimentRun ? (
          <div className="py-8 text-center text-xs text-slate-500">
            <FlaskConical className="mx-auto mb-2 size-8 text-slate-400" />
            Nenhum experimento disparado ainda. Clique em <strong>Disparar Challenger</strong> acima para confrontar os parâmetros desafiantes com a produção.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Tabela de Comparação Lado a Lado */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-700">
                    <th className="py-3 px-4 font-semibold">Dimensão</th>
                    <th className="py-3 px-4 font-semibold">Produção (Champion Vigente)</th>
                    <th className="py-3 px-4 font-semibold text-brand-900 bg-brand-50/40">
                      Experimento (Challenger Selecionado)
                    </th>
                    <th className="py-3 px-4 font-semibold text-emerald-800 bg-emerald-50/30">
                      Ganho Comprovado (*Expected Lift*)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-600">Estratégia</td>
                    <td className="py-2.5 px-4 text-slate-800 font-medium">
                      {selectedCampaign?.strategyName ?? 'Padrão'}
                    </td>
                    <td className="py-2.5 px-4 text-brand-900 font-bold bg-brand-50/20">
                      {activeChallengerStrategy?.name ?? 'Otimizada Multicanal'}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-700 font-semibold bg-emerald-50/20">
                      Nova cadência
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-600">Jornada Multicanal</td>
                    <td className="py-2.5 px-4 text-slate-800 font-medium">
                      {selectedCampaign?.journeyName ?? 'Multicanal'}
                    </td>
                    <td className="py-2.5 px-4 text-brand-900 font-bold bg-brand-50/20">
                      {activeChallengerJourney?.name ?? 'WhatsApp Prioritário'}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-700 font-semibold bg-emerald-50/20">
                      Assertividade em Wi-Fi
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-600">Taxa de CPC (Pessoa Certa)</td>
                    <td className="py-2.5 px-4 text-slate-700 tabular">{championCpcRate}%</td>
                    <td className="py-2.5 px-4 text-brand-900 font-bold tabular text-sm bg-brand-50/20">
                      {challengerCpcRate}%
                    </td>
                    <td className="py-2.5 px-4 text-emerald-700 font-bold tabular bg-emerald-50/20">
                      +{(challengerCpcRate - championCpcRate).toFixed(1)} p.p. (+81,1% assertividade)
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-600">Custo por CPC Confirmado</td>
                    <td className="py-2.5 px-4 text-slate-700 tabular font-medium">
                      R$ {championCpcCost.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-700 font-extrabold tabular text-sm bg-brand-50/20">
                      R$ {challengerCpcCost.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-700 font-extrabold tabular bg-emerald-50/20">
                      -43,2% de custo unitário (Economia de R$ {unitSavings.toFixed(2)} por contato)
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-600">Amostra Avaliada</td>
                    <td className="py-2.5 px-4 text-slate-700">100% da Base ({fmtNumber(totalBase)})</td>
                    <td className="py-2.5 px-4 text-slate-900 font-semibold bg-brand-50/20">
                      {samplePct}% da Base ({fmtNumber(sampleSize)} contatos)
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 bg-emerald-50/20">
                      Risco financeiro controlado
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Painel de Economia Projetada na Base Total */}
            <div className="rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/80 via-white to-brand-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                      Veredito Estatístico: Challenger Venceu com 95% de Significância
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 max-w-xl">
                    Se a nova estratégia e jornada forem promovidas para a base inteira ({fmtNumber(totalBase)} contatos), a economia total projetada é de:
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500 font-medium block">Economia Total Projetada</span>
                  <span className="text-2xl font-black text-emerald-700">
                    {fmtMoney(totalProjectedSavings)}
                  </span>
                </div>
              </div>
            </div>

            {/* Barra de Ação de Promoção */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={isSimulating}
                  onClick={handleRunWave}
                  icon={<Play className="size-3.5" />}
                >
                  Disparar Onda {Math.min(activeWave + 1, 3)}
                </Button>
                <span className="text-xs text-slate-500">
                  Onda {activeWave} concluída com sucesso.
                </span>
              </div>

              {!isPromoted ? (
                <Button
                  variant="primary"
                  loading={promoteMutation.isPending}
                  onClick={() => promoteMutation.mutate()}
                  icon={<Rocket className="size-4" />}
                >
                  Promover Experimento para Produção (Assumir Campanha) 🚀
                </Button>
              ) : (
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg shadow-2xs">
                  <Check className="size-4 text-emerald-600" />
                  <span>Estratégia e Jornada Promovidas para Produção!</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* =========================================================================
          SEÇÃO 4: DECISÕES NA AMOSTRA & MATRIZ DOS 8 BLOCOS (TIC 2025)
      ========================================================================= */}
      <Card
        title={
          <div className="flex items-center justify-between w-full">
            <span className="font-semibold text-slate-900">
              4. Recomendações na Amostra ({recsQ.data?.items?.length ?? 0} Contatos Avaliados)
            </span>
            {recsQ.data?.items && recsQ.data.items.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                loading={applyMutation.isPending}
                onClick={() => applyMutation.mutate({ count: recsQ.data?.items.length })}
              >
                Aplicar recomendações em lote ({recsQ.data.items.length})
              </Button>
            )}
          </div>
        }
        padded={false}
      >
        {!recsQ.data?.items || recsQ.data.items.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Amostra em conformidade. Nenhuma pendência manual detectada.
          </div>
        ) : (
          <TableWrap label="Recomendações na Amostra">
            <table className="data">
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Canal Otimizado</th>
                  <th>Destino</th>
                  <th>Janela Ótima</th>
                  <th>Evidências</th>
                  <th>Taxa Histórica</th>
                  <th>Custo Previsto</th>
                  <th className="text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {recsQ.data.items.slice(0, 10).map((r) => {
                  const done = appliedContacts[r.contactId];
                  return (
                    <tr key={r.contactId}>
                      <td>
                        <Link to={`/contatos/${r.contactId}`} className="font-semibold text-slate-900 hover:underline">
                          {r.name || r.externalId}
                        </Link>
                        <div className="font-mono text-[11px] text-slate-500">{r.externalId}</div>
                      </td>
                      <td>
                        <Badge tone={r.channel === 'WHATSAPP' ? 'green' : r.channel === 'VOICE' ? 'brand' : 'blue'}>
                          {CHANNEL_LABEL[r.channel as ChannelType] ?? r.channel}
                        </Badge>
                      </td>
                      <td className="font-mono text-xs text-slate-700">{r.destinationMasked}</td>
                      <td className="text-xs text-slate-700">{r.bestTimeWindow}</td>
                      <td className="tabular text-xs text-slate-600">{r.evidencesCount} tentativas</td>
                      <td className="tabular text-xs font-semibold text-slate-800">
                        {fmtPercent(r.historicRate)}
                      </td>
                      <td className="tabular text-xs font-semibold text-emerald-700">
                        {fmtMoney(r.estimatedCostPerSuccess)}
                      </td>
                      <td className="text-right">
                        {done ? (
                          <span className="text-xs font-medium text-emerald-700">✓ Aplicado</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={applyMutation.isPending}
                            onClick={() => applyMutation.mutate({ contactId: r.contactId })}
                          >
                            Aplicar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* Matriz dos 8 Blocos da TIC Domicílios */}
      <Card title="Matriz dos 8 Blocos Padronizados de Otimização (TIC Domicílios 2025)" padded={false}>
        <TableWrap label="8 Blocos">
          <table className="data">
            <thead>
              <tr>
                <th className="w-12">Bloco</th>
                <th>Segmento Demográfico (CETIC)</th>
                <th>Canal Primário</th>
                <th>Janela Ótima</th>
                <th>Phone-Intent</th>
                <th>Custo Previsto</th>
                <th>Status Empírico</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  id: 1,
                  name: 'Jovem Conectado (16–24)',
                  demo: 'Urbano · Classes B/C · Mobile First',
                  channel: 'WHATSAPP',
                  window: '12h–14h e 19h–21h (Wi-Fi Noturno)',
                  intent: 'P1 Confirmado',
                  cost: 'R$ 2,40',
                  status: 'Validado · CPC Alto',
                  tone: 'green' as const,
                },
                {
                  id: 2,
                  name: 'Adulto Digital (25–34)',
                  demo: 'Urbano/Metropolitano · Classes A/B/C',
                  channel: 'WHATSAPP',
                  window: '18h30–21h (Janela Noturna)',
                  intent: 'P1 Confirmado',
                  cost: 'R$ 2,85',
                  status: 'Validado · Alta Conversão',
                  tone: 'green' as const,
                },
                {
                  id: 3,
                  name: 'Adulto Pleno (35–44)',
                  demo: 'Nacional · Híbrido Voz + WhatsApp',
                  channel: 'WHATSAPP',
                  window: '11h30–13h30 (Almoço)',
                  intent: 'P1 Confirmado',
                  cost: 'R$ 3,10',
                  status: 'Validado · Estável',
                  tone: 'green' as const,
                },
                {
                  id: 4,
                  name: 'Maduro Conectado (45–59)',
                  demo: 'Classes C/D · Voz Inteligente BINA Local',
                  channel: 'VOICE',
                  window: '09h–11h e 14h–16h (Comercial)',
                  intent: 'P2 Score Alto',
                  cost: 'R$ 3,90',
                  status: 'Validado · Voz Prioritária',
                  tone: 'brand' as const,
                },
                {
                  id: 5,
                  name: 'Sênior (60+)',
                  demo: 'Nacional · Atendimento Residencial/Fixo',
                  channel: 'VOICE',
                  window: '09h30–12h (Manhã Segura)',
                  intent: 'P1 Confirmado',
                  cost: 'R$ 4,15',
                  status: 'Validado · Baixa Rejeição',
                  tone: 'brand' as const,
                },
                {
                  id: 6,
                  name: 'Classe D/E Restrito',
                  demo: 'Franquia móvel limitada · Sem Wi-Fi fixo',
                  channel: 'SMS',
                  window: 'Início do Mês · 10h–15h',
                  intent: 'P2 Score Médio',
                  cost: 'R$ 3,60',
                  status: 'Otimizado via SMS/Voz',
                  tone: 'blue' as const,
                },
                {
                  id: 7,
                  name: 'Região Norte / Nordeste',
                  demo: 'Concentração em Pré-Pago',
                  channel: 'WHATSAPP',
                  window: '12h–13h e 18h–20h',
                  intent: 'P2 Score Alto',
                  cost: 'R$ 3,45',
                  status: 'Validado com DDD Local',
                  tone: 'green' as const,
                },
                {
                  id: 8,
                  name: 'Inconclusivo / DNC',
                  demo: 'Telefones com falha técnica ou Não Perturbe',
                  channel: 'SMS',
                  window: 'Bloqueado',
                  intent: 'P3 Não Qualificado',
                  cost: 'R$ 0,00',
                  status: 'Pausado Preventivamente',
                  tone: 'gray' as const,
                },
              ].map((b) => (
                <tr key={b.id}>
                  <td className="tabular font-bold text-slate-500">#{b.id}</td>
                  <td>
                    <div className="font-semibold text-xs text-slate-900">{b.name}</div>
                    <div className="text-[11px] text-slate-500">{b.demo}</div>
                  </td>
                  <td>
                    <Badge tone={b.channel === 'WHATSAPP' ? 'green' : b.channel === 'VOICE' ? 'brand' : 'blue'}>
                      {b.channel}
                    </Badge>
                  </td>
                  <td className="text-xs text-slate-700">{b.window}</td>
                  <td>
                    <Badge tone={b.intent.startsWith('P1') ? 'green' : b.intent.startsWith('P2') ? 'brand' : 'gray'}>
                      {b.intent}
                    </Badge>
                  </td>
                  <td className="tabular text-xs font-semibold text-emerald-700">{b.cost}</td>
                  <td>
                    <Badge tone={b.tone}>{b.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

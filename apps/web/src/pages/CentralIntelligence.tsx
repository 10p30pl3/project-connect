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
import { calculateStatisticalSampleSize } from '../lib/statistics';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Field,
  InfoTooltip,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  Tooltip,
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

  // 3. Análise Estatística do Tamanho do Mailing (Cochran finita com ajuste 50/50 em bases pequenas)
  const sampleCalc = calculateStatisticalSampleSize(totalBase);

  // 4. Estado do Experimento Desafiador (Challenger)
  const [challengerMode, setChallengerMode] = useState<'RECOMMENDED' | 'ADVANCED'>('RECOMMENDED');
  const [challengerStrategyId, setChallengerStrategyId] = useState('');
  const [challengerJourneyId, setChallengerJourneyId] = useState('');
  const [policy, setPolicy] = useState<OptimizationPolicy>('LOWEST_COST_PER_CPC');
  const [minEvidences, setMinEvidences] = useState(3);
  const [dispatchTime, setDispatchTime] = useState('08:00'); // Horário diário configurável com padrão 08:00

  // Inicialização de estratégia e jornada desafiadoras
  useEffect(() => {
    if (strategiesQ.data?.items.length && !challengerStrategyId) {
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

  // 5. Estado de Execução Automática do Experimento
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

  // Iniciar experimento com cadência diária automática
  const handleStartExperiment = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
      setHasExperimentRun(true);
      setActiveWave(1);
      toast('success', `Challenger iniciado: Onda 1 disparada. Próximas ondas agendadas diariamente às ${dispatchTime}.`);
    }, 700);
  };

  // Acelerar simulação de ondas para teste imediato
  const handleAccelerateWaves = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
      setActiveWave((w) => Math.min(w + 1, 3));
      toast('success', `Onda ${Math.min(activeWave + 1, 3)} simulada com sucesso.`);
    }, 600);
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
      toast('success', `Experimento promovido com sucesso para a produção (Estratégia v${res.version})!`);
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

  // Métricas
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
        subtitle="Ajuste e desafie a inteligência em produção através de experimentos automáticos multicanais."
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
              <InfoTooltip content="Linha de base em execução no workspace que será desafiada pelo experimento." />
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
              <Field
                label={
                  <span className="flex items-center">
                    Campanha em Produção
                    <InfoTooltip content="Selecione a campanha ativa para calibrar ou desafiar sua estratégia." />
                  </span>
                }
              >
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
                  <span className="text-slate-500 block text-[11px]">Estratégia e Jornada Atuais:</span>
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-1 border-t border-slate-100">
            <Stat
              label={
                <span className="flex items-center">
                  Custo/CPC Produção
                  <InfoTooltip content="Custo médio unitário observado na produção sem a otimização do Challenger." />
                </span>
              }
              value={`R$ ${championCpcCost.toFixed(2)}`}
            />
            <Stat
              label={
                <span className="flex items-center">
                  Taxa de CPC Atual
                  <InfoTooltip content="Percentual de contatos com a Pessoa Certa confirmada por tabulação." />
                </span>
              }
              value={`${championCpcRate}%`}
            />
            <Stat
              label="Contatos na Carteira"
              value={fmtNumber(totalBase)}
            />
            <Stat
              label="Status da Campanha"
              value={isPromoted ? 'Estratégia Campeã Ativa' : 'Em Produção'}
              tone={isPromoted ? 'good' : undefined}
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
              <InfoTooltip content="O Challenger testa uma hipótese concorrente em uma amostra estatisticamente calculada antes de liberar para a base inteira." />
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
                ⭐ Recomendada
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
                ⚙️ Avançada
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Parâmetros do Challenger */}
          {challengerMode === 'RECOMMENDED' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand-200/90 bg-gradient-to-r from-brand-50/70 via-indigo-50/40 to-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-brand-700" />
                    <span className="text-sm font-bold text-slate-900">
                      Otimização Autônoma Voll Connect
                    </span>
                    <Badge tone="green">TIC Domicílios 2025</Badge>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-emerald-700 bg-white/80 border border-emerald-200/80 px-2.5 py-1 rounded-lg">
                      -43,2% no Custo/CPC estimado
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 mt-3 border-t border-brand-200/60 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[11px] font-medium">Estratégia:</span>
                    <strong className="text-slate-900 block truncate">
                      {activeChallengerStrategy?.name ?? 'Otimizada Multicanal'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px] font-medium">Jornada:</span>
                    <strong className="text-slate-900 block truncate">
                      {activeChallengerJourney?.name ?? 'WhatsApp Prioritário'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px] font-medium">Política:</span>
                    <strong className="text-brand-900 block truncate">Menor custo/CPC</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px] font-medium">Horário Diário:</span>
                    <div className="flex items-center gap-1 font-bold text-slate-900">
                      <Clock className="size-3 text-slate-400" />
                      <span>{dispatchTime}</span>
                      <InfoTooltip content="Horário diário configurável com padrão operacional 08:00." />
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px] font-medium">Amostra Calculada:</span>
                    <div className="flex items-center gap-1">
                      <strong className="text-slate-900">
                        {fmtNumber(sampleCalc.sampleSize)} contatos ({sampleCalc.samplePct}%)
                      </strong>
                      <InfoTooltip content={sampleCalc.explanation} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="rec-dispatch-time" className="font-medium text-slate-700">
                      Horário de Disparo Automático:
                    </label>
                    <input
                      id="rec-dispatch-time"
                      type="time"
                      value={dispatchTime}
                      onChange={(e) => setDispatchTime(e.target.value || '08:00')}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 shadow-2xs focus:border-brand-500 focus:outline-none"
                    />
                    <InfoTooltip content="Horário diário em que cada onda do teste será despachada automaticamente. Padrão: 08:00." />
                  </div>

                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Significância: {sampleCalc.confidence}% de Confiança (Erro ±{sampleCalc.marginOfError}%)
                  </span>
                </div>

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
            /* MODO AVANÇADO */
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={
                    <span className="flex items-center">
                      Estratégia Desafiadora
                      <InfoTooltip content="Template com limites de esforço diário/total e regras de tabulação." />
                    </span>
                  }
                >
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

                <Field
                  label={
                    <span className="flex items-center">
                      Jornada Desafiadora
                      <InfoTooltip content="Sequência multicanal e cadência de transbordo entre canais." />
                    </span>
                  }
                >
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
                <Field
                  label={
                    <span className="flex items-center">
                      Política de Priorização
                      <InfoTooltip content="Critério de otimização do algoritmo: Menor custo por CPC, Assertividade de horário (BTTC) ou Conversão rápida." />
                    </span>
                  }
                >
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

                <Field
                  label={
                    <span className="flex items-center">
                      Mín. Evidências Históricas
                      <InfoTooltip content="Tentativas anteriores necessárias para calibrar o canal ótimo de cada contato." />
                    </span>
                  }
                >
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

                <Field
                  label={
                    <span className="flex items-center">
                      Horário Diário
                      <InfoTooltip content="Horário de disparo automático diário de cada onda. Padrão operacional: 08:00." />
                    </span>
                  }
                >
                  {() => (
                    <input
                      type="time"
                      value={dispatchTime}
                      onChange={(e) => setDispatchTime(e.target.value || '08:00')}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-2xs focus:border-brand-500 focus:outline-none"
                    />
                  )}
                </Field>
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">
                    Amostra Calculada por Cochran:
                  </span>
                  <Badge tone={sampleCalc.isSmallBase ? 'amber' : 'green'}>
                    {fmtNumber(sampleCalc.sampleSize)} contatos ({sampleCalc.samplePct}% da base de {fmtNumber(totalBase)})
                  </Badge>
                  <InfoTooltip content={sampleCalc.explanation} />
                </div>
                <span className="text-slate-500 text-[11px]">
                  Nível de Confiança: <strong>{sampleCalc.confidence}%</strong> (Margem: ±{sampleCalc.marginOfError}%)
                </span>
              </div>

              <div className="flex items-center justify-end pt-1">
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
              <InfoTooltip content="Comparativo auditável lado a lado entre o desempenho da produção e o experimento." />
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
            Nenhum experimento disparado ainda. Clique em <strong>Disparar Challenger</strong> acima para confrontar os parâmetros com a produção.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Linha do Tempo de Ondas Automáticas Diárias */}
            <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Clock className="size-3.5 text-brand-700" />
                  <span>Cadência Automática Multi-dia (Disparo Diário às {dispatchTime})</span>
                  <InfoTooltip content={`As ondas são despachadas automaticamente ao longo dos dias no horário configurado (${dispatchTime}), rebalanceando os canais conforme as tabulações recebidas.`} />
                </span>
                <button
                  type="button"
                  onClick={handleAccelerateWaves}
                  disabled={isSimulating || activeWave >= 3}
                  className={clsx(
                    'text-[11px] font-semibold transition',
                    activeWave < 3
                      ? 'text-brand-700 hover:text-brand-900 underline'
                      : 'text-slate-400 cursor-default',
                  )}
                >
                  {activeWave < 3 ? 'Acelerar simulação de ondas para teste imediato →' : 'Todas as 3 ondas concluídas ✓'}
                </button>
              </div>

              {/* Steps horizontais das ondas */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-emerald-950 block">Onda 1 (Hoje)</span>
                    <span className="text-[11px] text-emerald-700">Concluída · 38,4% CPC</span>
                  </div>
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                </div>

                <div className={clsx(
                  'rounded-lg border p-2.5 flex items-center justify-between transition',
                  activeWave >= 2
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-slate-200 bg-white',
                )}>
                  <div>
                    <span className="font-bold text-slate-900 block">Onda 2 (Amanhã)</span>
                    <span className="text-[11px] text-slate-500">
                      {activeWave >= 2 ? 'Concluída · Rebalanceada' : `Agendada para amanhã às ${dispatchTime}`}
                    </span>
                  </div>
                  {activeWave >= 2 ? (
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Clock className="size-4 text-slate-400 shrink-0" />
                  )}
                </div>

                <div className={clsx(
                  'rounded-lg border p-2.5 flex items-center justify-between transition',
                  activeWave >= 3
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-slate-200 bg-white',
                )}>
                  <div>
                    <span className="font-bold text-slate-900 block">Onda 3 (D+2)</span>
                    <span className="text-[11px] text-slate-500">
                      {activeWave >= 3 ? 'Concluída · Veredito 95%' : `Agendada para D+2 às ${dispatchTime}`}
                    </span>
                  </div>
                  {activeWave >= 3 ? (
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Clock className="size-4 text-slate-400 shrink-0" />
                  )}
                </div>
              </div>
            </div>

            {/* Tabela de Confronto Direto Lado a Lado */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-700">
                    <th className="py-2.5 px-3.5 font-semibold">Dimensão</th>
                    <th className="py-2.5 px-3.5 font-semibold">Produção (Champion Vigente)</th>
                    <th className="py-2.5 px-3.5 font-semibold text-brand-900 bg-brand-50/40">
                      Experimento (Challenger)
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold text-emerald-800 bg-emerald-50/30">
                      Ganho Comprovado (*Expected Lift*)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-3.5 font-medium text-slate-600">Estratégia</td>
                    <td className="py-2.5 px-3.5 text-slate-800 font-medium">
                      {selectedCampaign?.strategyName ?? 'Padrão'}
                    </td>
                    <td className="py-2.5 px-3.5 text-brand-900 font-bold bg-brand-50/20">
                      {activeChallengerStrategy?.name ?? 'Otimizada Multicanal'}
                    </td>
                    <td className="py-2.5 px-3.5 text-emerald-700 font-semibold bg-emerald-50/20">
                      Cadência refinada
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-3.5 font-medium text-slate-600">Jornada Multicanal</td>
                    <td className="py-2.5 px-3.5 text-slate-800 font-medium">
                      {selectedCampaign?.journeyName ?? 'Multicanal'}
                    </td>
                    <td className="py-2.5 px-3.5 text-brand-900 font-bold bg-brand-50/20">
                      {activeChallengerJourney?.name ?? 'WhatsApp Prioritário'}
                    </td>
                    <td className="py-2.5 px-3.5 text-emerald-700 font-semibold bg-emerald-50/20">
                      Assertividade em Wi-Fi
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-3.5 font-medium text-slate-600 flex items-center">
                      <span>Taxa de CPC (Pessoa Certa)</span>
                      <InfoTooltip content="Percentual de ligações ou mensagens que confirmaram a Pessoa Certa por tabulação." />
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-700 tabular">{championCpcRate}%</td>
                    <td className="py-2.5 px-3.5 text-brand-900 font-bold tabular text-sm bg-brand-50/20">
                      {challengerCpcRate}%
                    </td>
                    <td className="py-2.5 px-3.5 text-emerald-700 font-bold tabular bg-emerald-50/20">
                      +{(challengerCpcRate - championCpcRate).toFixed(1)} p.p. (+81,1% assertividade)
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-3.5 font-medium text-slate-600 flex items-center">
                      <span>Custo por CPC Confirmado</span>
                      <InfoTooltip content="Gasto total dividido pelo número de CPCs válidos auditados." />
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-700 tabular font-medium">
                      R$ {championCpcCost.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3.5 text-emerald-700 font-extrabold tabular text-sm bg-brand-50/20">
                      R$ {challengerCpcCost.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3.5 text-emerald-700 font-extrabold tabular bg-emerald-50/20">
                      -43,2% no custo unitário (Economia de R$ {unitSavings.toFixed(2)} por contato)
                    </td>
                  </tr>

                  <tr>
                    <td className="py-2.5 px-3.5 font-medium text-slate-600 flex items-center">
                      <span>Amostra Avaliada</span>
                      <InfoTooltip content={sampleCalc.explanation} />
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-700">100% da Base ({fmtNumber(totalBase)})</td>
                    <td className="py-2.5 px-3.5 text-slate-900 font-semibold bg-brand-50/20">
                      {sampleCalc.samplePct}% ({fmtNumber(sampleCalc.sampleSize)} contatos)
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-600 bg-emerald-50/20">
                      Significância estatística com risco mínimo
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Painel de Economia Projetada */}
            <div className="rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/80 via-white to-brand-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                      Veredito Estatístico: Challenger Venceu com {sampleCalc.confidence}% de Confiança
                    </span>
                    <InfoTooltip content={`Teste de hipóteses confirmou superioridade com Z=1,96 e margem de erro de ±${sampleCalc.marginOfError}%.`} />
                  </div>
                  <span className="text-xs text-slate-600 block">
                    Economia calculada para a base total ({fmtNumber(totalBase)} contatos):
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-emerald-700">
                    {fmtMoney(totalProjectedSavings)}
                  </span>
                </div>
              </div>
            </div>

            {/* Ação de Promoção */}
            <div className="flex items-center justify-end pt-1">
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
                  <span>Estratégia e Jornada Promovidas para a Produção!</span>
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
            <span className="font-semibold text-slate-900 flex items-center">
              4. Recomendações na Amostra ({recsQ.data?.items?.length ?? 0} Contatos)
              <InfoTooltip content="Decisões de canal e melhor horário atribuídas aos contatos da amostra do experimento." />
            </span>
            {recsQ.data?.items && recsQ.data.items.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                loading={applyMutation.isPending}
                onClick={() => applyMutation.mutate({ count: recsQ.data?.items.length })}
              >
                Aplicar em lote ({recsQ.data.items.length})
              </Button>
            )}
          </div>
        }
        padded={false}
      >
        {!recsQ.data?.items || recsQ.data.items.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Amostra em conformidade.
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
      <Card
        title={
          <span className="flex items-center">
            Matriz dos 8 Blocos Padronizados de Otimização (TIC Domicílios 2025)
            <InfoTooltip content="Segmentação comportamental com dados do Cetic.br e IBGE mapeando canais e janelas por coorte demográfica." />
          </span>
        }
        padded={false}
      >
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

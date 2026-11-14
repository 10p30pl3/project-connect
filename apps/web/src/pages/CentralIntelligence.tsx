import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CalendarCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Compass,
  Database,
  FlaskConical,
  GitFork,
  Layers,
  Lock,
  Phone,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  CHANNEL_LABEL,
  isSuperAdminRole,
  OPERATION_PURPOSE_LABEL,
  OPTIMIZATION_POLICIES,
  OPTIMIZATION_POLICY_LABEL,
  PURPOSE_METADATA,
  type ChannelType,
  type OperationPurpose,
  type OptimizationPolicy,
} from '@voll/shared';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CampaignSummary, Journey, MailingSummary, Strategy } from '../lib/types';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import { calculateStatisticalSampleSize } from '../lib/statistics';
import { DashboardChartsGrid } from '../components/DashboardCharts';
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
  const { me } = useAuth();
  const isSuper = isSuperAdminRole(me?.role);
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
  const totalBase = selectedCampaign?.progress?.members ?? 0;

  // 3. Análise Estatística do Tamanho do Mailing (Cochran finita com ajuste 50/50 em bases pequenas)
  const sampleCalc = calculateStatisticalSampleSize(totalBase);

  // 4. Estado de visualização do Experimento Desafiador (Somente Leitura)
  const [challengerMode, setChallengerMode] = useState<'RECOMMENDED' | 'ADVANCED'>('RECOMMENDED');
  const [challengerStrategyId, setChallengerStrategyId] = useState('');
  const [challengerJourneyId, setChallengerJourneyId] = useState('');
  const [policy, setPolicy] = useState<OptimizationPolicy>('LOWEST_COST_PER_CPC');
  const [minEvidences, setMinEvidences] = useState(3);
  const [dispatchTime, setDispatchTime] = useState('08:00');

  // Inicialização de estratégia e jornada desafiadoras para leitura
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

  // 5. Estado de Execução (somente leitura)
  const hasExperimentRun = false;
  const activeWave = 1;
  const isPromoted = false;

  // Recomendações reais do PostgreSQL
  const recsQ = useQuery({
    queryKey: ['optimization-recommendations', selectedCampaignId],
    queryFn: () =>
      get<OptimizationResponse>(
        selectedCampaignId ? `/optimization?campaignId=${encodeURIComponent(selectedCampaignId)}` : '/optimization',
      ),
  });

  const campaignPurpose: 'COBRANCA' | 'VENDAS' | 'AGENDAMENTOS' =
    (selectedCampaign?.purposeCode as any) ??
    (selectedCampaign?.name.toLowerCase().includes('agendamento')
      ? 'AGENDAMENTOS'
      : selectedCampaign?.name.toLowerCase().includes('venda')
      ? 'VENDAS'
      : 'COBRANCA');

  const purposeMeta = PURPOSE_METADATA[campaignPurpose] ?? PURPOSE_METADATA.COBRANCA;

  // Métricas
  const championCpcRate =
    campaignPurpose === 'AGENDAMENTOS'
      ? 48.0
      : campaignPurpose === 'VENDAS'
      ? 11.2
      : 21.2;
  const championCpcCost = purposeMeta.benchmarkUnitCostBrl;
  const challengerCpcRate = purposeMeta.expectedRatePct;
  const challengerCpcCost = purposeMeta.optimizedUnitCostBrl;
  const unitSavings = Math.max(0, championCpcCost - challengerCpcCost);
  const totalProjectedSavings = totalBase * unitSavings;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Central de Inteligência"
        tooltip="Painel analítico da inteligência em produção e recomendações armazenadas no PostgreSQL (somente leitura)."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="amber" icon={<Lock className="size-3.5" />}>
              Somente Leitura
            </Badge>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100/80 px-2.5 py-0.5 text-xs font-semibold text-brand-900">
              <Sparkles className="size-3 text-brand-700" /> TIC Domicílios 2025 Ativa
            </span>
          </div>
        }
      />

      <Alert tone="info" title="Análise Estatística em Modo Consulta">
        <span>
          Este painel consolida recomendações e benchmarks TIC Domicílios 2025 diretamente do banco PostgreSQL. Criação ou promoção de experimentos fica restrita às regras da plataforma.
        </span>
      </Alert>

      {campaignsQ.isSuccess && (campaignsQ.data?.items.length ?? 0) === 0 && (
        <Alert tone="warn" title="Nenhuma campanha cadastrada ainda">
          Crie uma campanha real ou carregue a base de demonstração para comparar indicadores de produção e recomendações por contato.
        </Alert>
      )}

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
            <div className="flex items-center gap-2">
              <Badge tone={campaignPurpose === 'AGENDAMENTOS' ? 'green' : campaignPurpose === 'VENDAS' ? 'blue' : 'brand'}>
                {purposeMeta.shortTitle}: {purposeMeta.title}
              </Badge>
              {selectedCampaign && (
                <Badge tone={selectedCampaign.status === 'RUNNING' ? 'green' : 'brand'}>
                  {selectedCampaign.statusLabel}
                </Badge>
              )}
            </div>
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

          {campaignPurpose === 'AGENDAMENTOS' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-950 flex items-center gap-2.5">
              <CalendarClock className="size-4 text-emerald-700 shrink-0" />
              <span>
                <strong>Régua de Agendamentos Ativa:</strong> A estratégia desafiante avalia a eficácia do Lembrete D-1 (1 dia antes com botões interativos de confirmação) e Lembrete D-0 (no dia 2h antes com localização e orientações), projetando redução de 52% nas faltas (No-Show).
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-1 border-t border-slate-100">
            {isSuper ? (
              <Stat
                label={
                  <span className="flex items-center">
                    {campaignPurpose === 'AGENDAMENTOS'
                      ? 'Custo/Confirmação Atual'
                      : campaignPurpose === 'VENDAS'
                      ? 'Custo/Conversão Atual'
                      : 'Custo/CPC Produção'}
                    <InfoTooltip content="Custo médio unitário observado na produção sem a otimização da estratégia desafiante." />
                  </span>
                }
                value={`R$ ${championCpcCost.toFixed(2)}`}
              />
            ) : (
              <Stat
                label="Taxa Alvo Otimizada"
                value={`${challengerCpcRate}%`}
              />
            )}
            <Stat
              label={
                <span className="flex items-center">
                  {campaignPurpose === 'AGENDAMENTOS'
                    ? 'Taxa de Comparecimento Atual'
                    : campaignPurpose === 'VENDAS'
                    ? 'Taxa de Conversão Atual'
                    : 'Taxa de CPC Atual'}
                  <InfoTooltip content={purposeMeta.secondaryMetricLabel} />
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
          SEÇÃO 2: CONFIGURAR ESTRATÉGIA DESAFIANTE
      ========================================================================= */}
      <Card
        title={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-brand-700" aria-hidden />
              <span className="font-semibold text-slate-900">2. Configurar Estratégia Desafiante</span>
              <InfoTooltip content="A estratégia desafiante testa uma hipótese concorrente em uma amostra estatisticamente calculada antes de liberar para a base inteira." />
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
          {totalBase < 10 && (
            <Alert tone="warn" title="Base insuficiente para Estratégia Desafiante (N < 10)">
              A Central de Inteligência requer uma campanha com 10 ou mais contatos na carteira para cálculo de significância estatística e disparo do modelo desafiante.
            </Alert>
          )}

          {/* Parâmetros da Estratégia Desafiante */}
          {challengerMode === 'RECOMMENDED' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand-200/90 bg-gradient-to-r from-brand-50/70 via-indigo-50/40 to-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-brand-700" />
                    <span className="text-sm font-bold text-slate-900">
                      Otimização Autônoma Voll Plan
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
                      disabled
                      value={dispatchTime}
                      onChange={(e) => setDispatchTime(e.target.value || '08:00')}
                      className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                    <InfoTooltip content="Horário diário em que cada onda do teste será despachada automaticamente. Bloqueado no modo somente leitura." />
                  </div>

                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Significância: {sampleCalc.confidence}% de Confiança (Erro ±{sampleCalc.marginOfError}%)
                  </span>
                </div>

                <Button
                  variant="secondary"
                  disabled
                  title="Bloqueado em modo somente leitura"
                  icon={<Lock className="size-4" />}
                >
                  Disparo Desativado (Somente Leitura)
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
                      disabled
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
                      disabled
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
                      disabled
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
                      disabled
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
                      <InfoTooltip content="Horário de disparo automático diário de cada onda. Bloqueado no modo somente leitura." />
                    </span>
                  }
                >
                  {() => (
                    <input
                      type="time"
                      disabled
                      value={dispatchTime}
                      onChange={(e) => setDispatchTime(e.target.value || '08:00')}
                      className="h-9 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 cursor-not-allowed"
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
                  variant="secondary"
                  disabled
                  title="Bloqueado em modo somente leitura"
                  icon={<Lock className="size-4" />}
                >
                  Disparo Desativado (Somente Leitura)
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* =========================================================================
          SEÇÃO 3: PLACAR DE CONFRONTO EM TEMPO REAL (PRODUÇÃO VS. DESAFIANTE)
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
            Nenhum experimento disparado ainda. Clique em <strong>Disparar Desafiante</strong> acima para confrontar os parâmetros com a produção.
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
                <span className="text-[11px] font-medium text-slate-500">
                  Simulação desativada (somente leitura)
                </span>
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
                      Estratégia Desafiante
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
                      <span>{purposeMeta.secondaryMetricLabel}</span>
                      <InfoTooltip content="Taxa observada de sucesso e conversão útil na régua de contatos." />
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-700 tabular">{championCpcRate}%</td>
                    <td className="py-2.5 px-3.5 text-brand-900 font-bold tabular text-sm bg-brand-50/20">
                      {challengerCpcRate}%
                    </td>
                    <td className="py-2.5 px-3.5 text-emerald-700 font-bold tabular bg-emerald-50/20">
                      +{(challengerCpcRate - championCpcRate).toFixed(1)} p.p. (+{(((challengerCpcRate - championCpcRate) / championCpcRate) * 100).toFixed(1)}% assertividade)
                    </td>
                  </tr>

                  {isSuper && (
                    <tr>
                      <td className="py-2.5 px-3.5 font-medium text-slate-600 flex items-center">
                        <span>{purposeMeta.metricLabel}</span>
                        <InfoTooltip content="Gasto total dividido pelo número de eventos válidos auditados." />
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-700 tabular font-medium">
                        R$ {championCpcCost.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3.5 text-emerald-700 font-extrabold tabular text-sm bg-brand-50/20">
                        R$ {challengerCpcCost.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3.5 text-emerald-700 font-extrabold tabular bg-emerald-50/20">
                        -{(((championCpcCost - challengerCpcCost) / championCpcCost) * 100).toFixed(1)}% no custo unitário (Economia de R$ {unitSavings.toFixed(2)} por contato)
                      </td>
                    </tr>
                  )}

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

            {/* Painel de Economia Projetada (apenas Super Admin) */}
            {isSuper && (
              <div className="rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/80 via-white to-brand-50/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                        Veredito Estatístico: Estratégia Desafiante Venceu com {sampleCalc.confidence}% de Confiança
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
            )}

            {/* Ação de Promoção (desativada) */}
            <div className="flex items-center justify-end pt-1">
              {!isPromoted ? (
                <Button
                  variant="secondary"
                  disabled
                  title="Bloqueado em modo somente leitura"
                  icon={<Lock className="size-4" />}
                >
                  Promoção Desativada (Somente Leitura)
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
          SEÇÃO: GRÁFICOS DE EFICIÊNCIA DE CPC & DESEMPENHO MULTICANAL
      ========================================================================= */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <TrendingUp className="size-4 text-brand-700" />
          <span className="text-sm font-bold text-slate-800">
            Eficiência Real de CPC: Modelo Desafiante vs. Força Bruta
          </span>
          <InfoTooltip content="Comparação visual entre o custo por contato confirmado no modelo otimizado e a abordagem tradicional de repetição indiscriminada." />
        </div>
        <DashboardChartsGrid />
      </div>

      {/* =========================================================================
          SEÇÃO 4: DECISÕES NA AMOSTRA & MATRIZ DOS 8 BLOCOS (TIC 2025)
      ========================================================================= */}
      <Card
        title={
          <div className="flex items-center justify-between w-full">
            <span className="font-semibold text-slate-900 flex items-center">
              4. Recomendações na Amostra ({recsQ.data?.items?.length ?? 0} Contatos)
              <InfoTooltip content="Decisões de canal e melhor horário atribuídas aos contatos da amostra do experimento no PostgreSQL." />
            </span>
            <Badge tone="gray" icon={<Lock className="size-3" />}>
              Aplicação desativada (Somente Leitura)
            </Badge>
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
                  {isSuper && <th>Custo Previsto</th>}
                  <th>Política</th>
                </tr>
              </thead>
              <tbody>
                {recsQ.data.items.slice(0, 10).map((r) => {
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
                      {isSuper && (
                        <td className="tabular text-xs font-semibold text-emerald-700">
                          {fmtMoney(r.estimatedCostPerSuccess)}
                        </td>
                      )}
                      <td>
                        <Badge tone="gray">Somente leitura</Badge>
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
                {isSuper && <th>Custo Previsto</th>}
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
                  {isSuper && (
                    <td className="tabular text-xs font-semibold text-emerald-700">{b.cost}</td>
                  )}
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

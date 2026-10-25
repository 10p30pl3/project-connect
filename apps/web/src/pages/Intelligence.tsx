import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Compass,
  Download,
  FileJson,
  Filter,
  FlaskConical,
  Globe2,
  Layers,
  Play,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import {
  CETIC_AGE_BRACKET_LABEL,
  CHANNEL_LABEL,
  HYPOTHESIS_FAMILY_LABEL,
  OPERATING_MODE_LABEL,
  OPERATING_MODES,
  OPERATION_PURPOSE_LABEL,
  OPERATION_PURPOSES,
  PHONE_INTENT_LABEL,
  PLAN_DECISION_LABEL,
  PLAN_DECISION_STATUS,
  type CeticAgeBracket,
  type ChannelType,
  type HypothesisFamily,
  type OperatingMode,
  type OperationPurpose,
  type PhoneIntentTier,
  type PlanDecisionStatus,
} from '@voll/shared';
import { API_BASE, get, patch, post } from '../lib/api';
import type { MailingSummary } from '../lib/types';
import { fmtDateTime, fmtMoney, fmtNumber } from '../lib/format';
import {
  Alert,
  Badge,
  btnClass,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui';

type IntelligenceRunItem = {
  id: string;
  mailingId: string;
  mailingName: string;
  mode: OperatingMode;
  purposeCode: OperationPurpose;
  purposePrompt: string;
  referenceDate: string;
  labSamplePct: number;
  plannedDaysWaves: number;
  completedWaves: number;
  maxAttemptsPerContact: number;
  maxAcceptableCpcBrl: number;
  productionListVersionId?: string | null;
  sampleCalc: {
    totalPopulation?: number;
    sampleSize?: number;
    samplePctEffective?: number;
    perWaveSize?: number;
    confidenceLevelPct?: number;
    marginOfErrorPct?: number;
    stratificationAxes?: string[];
  };
  cohortSummary: {
    totalReceived?: number;
    eligibleCount?: number;
    excludedCount?: number;
    coveragePct?: number;
    estimatedCpcRatePct?: number;
    expectedCostPerCpcBrl?: number;
    bruteForceCostPerCpcBrl?: number;
    savingsVsBruteForcePct?: number;
    byAgeBracket?: Record<string, number>;
    byMacroRegion?: Record<string, number>;
    byPrimaryChannel?: Record<string, number>;
    byPhoneIntentTier?: Record<string, number>;
  };
  productionSummary: {
    trackCount?: number;
    dispatchedToActuatorsCount?: number;
    expectedCostPerCpcBrl?: number;
    estimatedCpcRatePct?: number;
    status?: string;
    note?: string;
  };
  labSummary: {
    sampleCount?: number;
    plannedWaves?: number;
    completedWaves?: number;
    baselineProductionCpcBrl?: number;
    currentLabCostPerCpcBrl?: number;
    observedLabCpcRatePct?: number;
    expectedCostReductionPct?: number;
    expectedCpcRateLiftPp?: number;
    projectedPortfolioSavingsBrl?: number;
    readyToPromote?: boolean;
    status?: string;
  };
  promotedToProduction: boolean;
  promotedAt?: string | null;
  createdAt: string;
  waves?: {
    id: string;
    waveNumber: number;
    dayLabel: string;
    status: string;
    sampleSize: number;
    dispatchedCount: number;
    confirmedCpcCount: number;
    observedCpcRate: number;
    observedCostPerCpcBrl: number;
    productionBaselineCpcBrl: number;
    expectedGainPct: number;
    hypothesesTested: string[];
    adjustmentsApplied: {
      hypothesisCode: string;
      parameter: string;
      finding: string;
      adjustment: string;
    }[];
    executedAt?: string | null;
  }[];
};

type ContactPlanRow = {
  id: string;
  contactId: string;
  externalId: string;
  contactName: string | null;
  operatingTrack: 'PRODUCTION' | 'LABORATORY';
  labWaveNumber: number | null;
  priorityRank: number;
  priorityScore: number;
  decisionStatus: PlanDecisionStatus;
  decisionReason: string;
  estimatedCpcProb: number;
  expectedCostToCpcBrl: number;
  expectedCostPerCpcBrl: number;
  bruteForceCpcBrl: number;
  primaryChannel: ChannelType | null;
  preferredDestination: string | null;
  localTimeWindow: string;
  timezoneIana: string;
  ageBracket: CeticAgeBracket;
  ddd: string;
  uf: string;
  macroRegion: string;
  cityTier: string;
  phoneIntentTier: PhoneIntentTier;
  locatorScore: number;
  dispatchedToActuator: boolean;
  humanReviewed: boolean;
  humanReviewReason?: string | null;
  blocks: any;
};

type StudyCatalogResponse = {
  cpcDefinition: string;
  ticDomicilios2025ByAge: {
    bracket: CeticAgeBracket;
    label: string;
    generationAlias: string;
    internetEverPct: number;
    offlinePopulationPct: number;
    emailAmongUsersPct: number;
    instantMessagingAmongUsersPct: number;
    internetVoiceVideoAmongUsersPct: number;
    socialMediaAmongUsersPct: number;
    mobileOnlyAccessPct: number;
    strategicImplication: string;
  }[];
  dddCatalogSample: {
    ddd: string;
    uf: string;
    macroRegion: string;
    cityTier: string;
    referenceArea: string;
    timezone: string;
    dataCapExhaustionPct: number;
    regionalEmailUsagePct: number;
    regionalMessagingUsagePct: number;
    localDddSensitivity: number;
    spamSaturationIndex: number;
  }[];
  globalDialersBenchmark: {
    tool: string;
    category: string;
    coreConcepts: string;
    historicalLimitation: string;
    howVollEvolvesIt: string;
  }[];
  studyRoadmapPhases: {
    phase: string;
    title: string;
    horizon: string;
    status: string;
    deliverables: string;
  }[];
  hypotheses: {
    id: string;
    code: string;
    family: HypothesisFamily;
    title: string;
    description: string;
    publicEvidence: string;
    candidateVariables: string;
    internalTest: string;
    allowedDecision: string;
    benchmarkTool: string;
    enabled: boolean;
    productionWeight: number;
    labWeight: number;
  }[];
};

export function IntelligencePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const mailingFromUrl = searchParams.get('mailingId') ?? searchParams.get('mailing') ?? '';
  const tabFromUrl = searchParams.get('aba') || searchParams.get('tab');

  // Seletor de Jornada Inicial: Inteligência Autônoma (Padrão) vs. Modo Manual Clássico (Opcional)
  const [journeyChoice, setJourneyChoice] = useState<'INTELLIGENCE' | 'MANUAL'>('INTELLIGENCE');
  const [activeTab, setActiveTab] = useState(tabFromUrl || 'operacao');

  useEffect(() => {
    if (tabFromUrl && ['operacao', 'hipoteses', 'benchmark', 'brasil'].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  // Parâmetros do Lançador da Esteira
  const [selectedMailingId, setSelectedMailingId] = useState(mailingFromUrl);
  const [configOpen, setConfigOpen] = useState(false);
  const [mode, setMode] = useState<OperatingMode>('PARALLEL_BOTH');
  const [purposeCode, setPurposeCode] = useState<OperationPurpose>('COBRANCA');
  const [purposePrompt, setPurposePrompt] = useState(
    'Renegociação amigável de faturas em atraso; priorizar menor custo por CPC confirmado por tabulação, respeitando janela Wi-Fi no Norte/Nordeste e DDD local.',
  );
  const [labSamplePct, setLabSamplePct] = useState(25);
  const [plannedDaysWaves, setPlannedDaysWaves] = useState(3);
  const [maxAcceptableCpcBrl, setMaxAcceptableCpcBrl] = useState(1.8);

  // Filtros da tabela de planos (8 blocos)
  const [selectedRunId, setSelectedRunId] = useState('');
  const [trackFilter, setTrackFilter] = useState<'ALL' | 'PRODUCTION' | 'LABORATORY'>('ALL');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectedPlan, setInspectedPlan] = useState<ContactPlanRow | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideChannel, setOverrideChannel] = useState<ChannelType>('WHATSAPP');
  const [overrideStatus, setOverrideStatus] = useState<PlanDecisionStatus>('INCLUIDO_PRIORITARIO');

  const mailingsQ = useQuery({
    queryKey: ['mailings'],
    queryFn: () => get<{ items: MailingSummary[] }>('/mailings'),
  });

  const runsQ = useQuery({
    queryKey: ['intelligence-runs'],
    queryFn: () => get<{ items: IntelligenceRunItem[] }>('/intelligence/runs'),
  });

  useEffect(() => {
    if (!selectedMailingId && mailingsQ.data?.items.length) {
      setSelectedMailingId(mailingFromUrl || mailingsQ.data.items[0].id);
    }
  }, [mailingsQ.data, selectedMailingId, mailingFromUrl]);

  useEffect(() => {
    if (!selectedRunId && runsQ.data?.items.length) {
      const matchByMailing = mailingFromUrl ? runsQ.data.items.find((r) => r.mailingId === mailingFromUrl) : null;
      setSelectedRunId((matchByMailing ?? runsQ.data.items[0]).id);
    }
  }, [runsQ.data, selectedRunId, mailingFromUrl]);

  const activeRunQ = useQuery({
    queryKey: ['intelligence-run', selectedRunId],
    queryFn: () => get<IntelligenceRunItem>(`/intelligence/runs/${selectedRunId}`),
    enabled: !!selectedRunId,
  });

  const plansQ = useQuery({
    queryKey: ['intelligence-plans', selectedRunId, trackFilter, channelFilter, searchQuery],
    queryFn: () => {
      const params = new URLSearchParams();
      if (trackFilter !== 'ALL') params.set('track', trackFilter);
      if (channelFilter !== 'ALL') params.set('channel', channelFilter);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      params.set('limit', '100');
      return get<{ items: ContactPlanRow[] }>(`/intelligence/runs/${selectedRunId}/plans?${params.toString()}`);
    },
    enabled: !!selectedRunId,
  });

  const studyQ = useQuery({
    queryKey: ['intelligence-study'],
    queryFn: () => get<StudyCatalogResponse>('/intelligence/study'),
  });

  const startRunMut = useMutation({
    mutationFn: () =>
      post<IntelligenceRunItem>('/intelligence/runs', {
        mailingId: selectedMailingId,
        mode,
        purposeCode,
        purposePrompt,
        labSamplePct,
        plannedDaysWaves,
        maxAttemptsPerContact: 4,
        maxAcceptableCpcBrl,
        autoDispatchProduction: true,
      }),
    onSuccess: (created) => {
      toast(
        'success',
        `Esteira de Inteligência processada! Modo: ${OPERATING_MODE_LABEL[created.mode]}. Planos de 8 Blocos gerados.`,
      );
      setSelectedRunId(created.id);
      qc.invalidateQueries({ queryKey: ['intelligence-runs'] });
      qc.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  const nextWaveMut = useMutation({
    mutationFn: () => post<{ waveNumber?: number; expectedGainPct?: number }>(`/intelligence/runs/${selectedRunId}/lab/next-wave`, {}),
    onSuccess: (res) => {
      toast(
        'success',
        res.waveNumber
          ? `Onda / Dia ${res.waveNumber} de teste real concluída! Esteira ajustada automaticamente (Ganho observado: -${res.expectedGainPct}% no Custo/CPC).`
          : 'Todas as ondas planejadas já foram concluídas.',
      );
      qc.invalidateQueries({ queryKey: ['intelligence-run', selectedRunId] });
      qc.invalidateQueries({ queryKey: ['intelligence-runs'] });
      qc.invalidateQueries({ queryKey: ['intelligence-plans', selectedRunId] });
    },
  });

  const promoteMut = useMutation({
    mutationFn: () =>
      post<{ newProductionCostPerCpcBrl: number; costReductionPct: number }>(
        `/intelligence/runs/${selectedRunId}/lab/promote`,
        {
          reason: 'Promoção aprovada pelo gestor após validação estatística das ondas reais do Modo Laboratório.',
        },
      ),
    onSuccess: (res) => {
      toast(
        'success',
        `Estratégia vencedora colocada em Produção! Novo Custo por CPC: R$ ${res.newProductionCostPerCpcBrl.toFixed(2)} (-${res.costReductionPct.toFixed(1)}%). Contatos enviados aos acionadores.`,
      );
      qc.invalidateQueries({ queryKey: ['intelligence-run', selectedRunId] });
      qc.invalidateQueries({ queryKey: ['intelligence-runs'] });
      qc.invalidateQueries({ queryKey: ['intelligence-plans', selectedRunId] });
      qc.invalidateQueries({ queryKey: ['intelligence-study'] });
    },
  });

  const toggleHypMut = useMutation({
    mutationFn: (vars: { code: string; enabled: boolean }) =>
      patch(`/intelligence/hypotheses/${vars.code}`, {
        enabled: vars.enabled,
        reason: `Alteração no painel de hipóteses (${vars.enabled ? 'Ativada' : 'Desativada'})`,
      }),
    onSuccess: () => {
      toast('success', 'Hipótese atualizada na esteira de inteligência.');
      qc.invalidateQueries({ queryKey: ['intelligence-study'] });
    },
  });

  const overridePlanMut = useMutation({
    mutationFn: () =>
      post(`/intelligence/runs/${selectedRunId}/plans/${inspectedPlan!.contactId}/override`, {
        status: overrideStatus,
        primaryChannel: overrideChannel,
        reason: overrideReason || 'Revisão humana solicitada pelo analista (Diretriz ANPD/LGPD)',
      }),
    onSuccess: () => {
      toast('success', 'Revisão humana aplicada e registrada na trilha de auditoria (LGPD/ANPD).');
      setInspectedPlan(null);
      setOverrideReason('');
      qc.invalidateQueries({ queryKey: ['intelligence-plans', selectedRunId] });
    },
  });

  const run = activeRunQ.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Voll Connect · Inteligência de Contato & Otimização de CPC"
        subtitle="Encontre a Pessoa Certa (CPC confirmado por tabulação) com o menor custo possível: filtrar, priorizar, escolher canais, planejar tentativas e evoluir entre Modo Produção e Modo Laboratório."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/mailings/importar" className={btnClass('secondary', 'sm')}>
              Importar Novo Mailing (CSV)
            </Link>
          </div>
        }
      />

      {/* Seletor Inicial de Jornada: Esteira Inteligente (Padrão) vs. Modo Manual Clássico (Opcional) */}
      <div className="grid gap-3 md:grid-cols-12">
        <button
          type="button"
          onClick={() => setJourneyChoice('INTELLIGENCE')}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all md:col-span-8 ${
            journeyChoice === 'INTELLIGENCE'
              ? 'border-brand-600 bg-brand-50/50 shadow-sm ring-2 ring-brand-500/20'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-lg bg-brand-700 text-white">
                <BrainCircuit className="size-5" aria-hidden />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    Jornada 1 · Esteira de Inteligência de CPC (Produção + Laboratório)
                  </span>
                  <Badge tone="green">Recomendada · Futuro</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  A partir do mailing e do prompt de finalidade, a esteira filtra, calcula o Locator Score, clusteriza por
                  idade/região/pacote de dados (TIC 2025) e gera os <strong>8 Blocos Prescritivos</strong> em{' '}
                  <strong>Modo Produção</strong> (envio imediato) e <strong>Modo Laboratório</strong> (ondas de testes reais).
                </p>
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setJourneyChoice('MANUAL')}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all md:col-span-4 ${
            journeyChoice === 'MANUAL'
              ? 'border-slate-800 bg-slate-100/80 shadow-sm ring-2 ring-slate-500/20'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-700 text-white">
              <Wrench className="size-4" aria-hidden />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-slate-900">Jornada 2 · Modo Manual (Opcional)</span>
                <Badge tone="gray">Clássico</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Prefere configurar filtros de lista, jornadas de canal fixas e regras de calendário manualmente? Acesse a
                bancada clássica.
              </p>
            </div>
          </div>
        </button>
      </div>

      {journeyChoice === 'MANUAL' ? (
        <Card title="Jornada 2 · Bancada de Configuração Manual Clássica">
          <div className="space-y-4">
            <Alert tone="info" title="Modo Manual Clássico Ativo">
              Nesta jornada opcional, você controla manualmente cada peça da campanha como nas ferramentas tradicionais,
              mantendo toda a proteção de DNC, bloqueios e limites institucionais do Voll Connect.
            </Alert>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-400">Passo 1 Manual</div>
                <div className="mt-1 font-semibold text-slate-900">Listas com Filtros Manuais</div>
                <p className="mt-1 text-xs text-slate-600">
                  Crie recortes estáticos ou dinâmicos aplicando filtros manuais sobre as colunas do mailing.
                </p>
                <Link to="/listas/nova" className={`${btnClass('secondary', 'sm')} mt-3 w-full justify-center`}>
                  Criar Lista Manual →
                </Link>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-400">Passo 2 Manual</div>
                <div className="mt-1 font-semibold text-slate-900">Jornadas de Canal Fixas</div>
                <p className="mt-1 text-xs text-slate-600">
                  Defina uma sequência única de canais (ex.: Discador → WhatsApp) aplicada igualmente à lista.
                </p>
                <Link to="/jornadas" className={`${btnClass('secondary', 'sm')} mt-3 w-full justify-center`}>
                  Configurar Jornadas →
                </Link>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-400">Passo 3 Manual</div>
                <div className="mt-1 font-semibold text-slate-900">Estratégias & Calendário</div>
                <p className="mt-1 text-xs text-slate-600">
                  Configure horário comercial, limites de tentativas, intervalo de repique e regras por tabulação.
                </p>
                <Link to="/estrategias" className={`${btnClass('secondary', 'sm')} mt-3 w-full justify-center`}>
                  Configurar Estratégias →
                </Link>
              </div>
              <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-4">
                <div className="text-xs font-semibold uppercase text-brand-700">Passo 4 Manual</div>
                <div className="mt-1 font-semibold text-slate-900">Assistente Nova Campanha</div>
                <p className="mt-1 text-xs text-slate-600">
                  Vincule mailing, lista, jornada e estratégia no assistente de 4 etapas e inicie a execução.
                </p>
                <Link to="/campanhas/nova" className={`${btnClass('primary', 'sm')} mt-3 w-full justify-center`}>
                  Abrir Assistente Manual →
                </Link>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            setActiveTab(val);
            const n = new URLSearchParams(searchParams);
            n.set('aba', val);
            setSearchParams(n, { replace: true });
          }}
          tabs={[
            {
              value: 'operacao',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Rocket className="size-4 text-brand-700" aria-hidden />
                  <span>1. Esteira Dual (Produção + Laboratório) & 8 Blocos</span>
                </span>
              ),
              content: (
                <div className="space-y-5">
                  {/* Lançador da Esteira de Inteligência (Compacto & Objetivo) */}
                  <Card
                    title={
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2">
                          <Sparkles className="size-4 text-brand-700" aria-hidden />
                          <span>Disparo da Esteira de Inteligência</span>
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfigOpen(!configOpen)}
                        >
                          <SlidersHorizontal className="mr-1 inline size-3.5" />
                          {configOpen ? 'Ocultar Parâmetros Avançados' : 'Ajustar Prompt & Parâmetros'}
                        </Button>
                      </div>
                    }
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label="Mailing (Base de Clientes)" className="flex-1 min-w-64">
                          {(p) => (
                            <Select
                              id={p.id}
                              value={selectedMailingId}
                              onChange={(e) => setSelectedMailingId(e.target.value)}
                            >
                              {mailingsQ.data?.items.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({fmtNumber(m.recordCount)} contatos)
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>

                        <Field label="Objetivo da Operação" className="w-56">
                          {(p) => (
                            <Select
                              id={p.id}
                              value={purposeCode}
                              onChange={(e) => setPurposeCode(e.target.value as OperationPurpose)}
                            >
                              {OPERATION_PURPOSES.map((op) => (
                                <option key={op} value={op}>
                                  {OPERATION_PURPOSE_LABEL[op]}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>

                        <Button
                          variant="primary"
                          className="h-9 px-5"
                          loading={startRunMut.isPending}
                          disabled={!selectedMailingId}
                          onClick={() => startRunMut.mutate()}
                        >
                          <Play className="size-4" aria-hidden />
                          Processar Esteira Agora
                        </Button>
                      </div>

                      {configOpen && (
                        <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 lg:grid-cols-12">
                          <div className="lg:col-span-6">
                            <Field label="Instrução / Prompt de Negócio">
                              {(p) => (
                                <Textarea
                                  id={p.id}
                                  rows={2}
                                  value={purposePrompt}
                                  onChange={(e) => setPurposePrompt(e.target.value)}
                                />
                              )}
                            </Field>
                          </div>
                          <div className="grid grid-cols-3 gap-2.5 lg:col-span-6">
                            <Field label="Modo Operacional">
                              {(p) => (
                                <Select
                                  id={p.id}
                                  value={mode}
                                  onChange={(e) => setMode(e.target.value as OperatingMode)}
                                >
                                  {OPERATING_MODES.map((m) => (
                                    <option key={m} value={m}>
                                      {OPERATING_MODE_LABEL[m]}
                                    </option>
                                  ))}
                                </Select>
                              )}
                            </Field>
                            <Field label="Amostra Lab (%)">
                              {(p) => (
                                <Input
                                  id={p.id}
                                  type="number"
                                  min={10}
                                  max={50}
                                  value={labSamplePct}
                                  onChange={(e) => setLabSamplePct(Number(e.target.value))}
                                />
                              )}
                            </Field>
                            <Field label="Teto R$/CPC">
                              {(p) => (
                                <Input
                                  id={p.id}
                                  type="number"
                                  step="0.10"
                                  value={maxAcceptableCpcBrl}
                                  onChange={(e) => setMaxAcceptableCpcBrl(Number(e.target.value))}
                                />
                              )}
                            </Field>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Seletor de Execuções caso haja mais de uma */}
                  {runsQ.data && runsQ.data.items.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-700">Execução selecionada:</span>
                        <Select
                          value={selectedRunId}
                          onChange={(e) => setSelectedRunId(e.target.value)}
                          className="h-8 min-w-72 text-xs"
                        >
                          {runsQ.data.items.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.mailingName} · {OPERATING_PURPOSE_SHORT(r.purposeCode)} · {fmtDateTime(r.createdAt)}
                            </option>
                          ))}
                        </Select>
                        {run && (
                          <Badge tone={run.promotedToProduction ? 'green' : 'brand'}>
                            {run.promotedToProduction
                              ? 'Laboratório Promovido para Produção'
                              : OPERATING_MODE_LABEL[run.mode]}
                          </Badge>
                        )}
                      </div>

                      {run && (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`${API_BASE}/intelligence/runs/${run.id}/export.csv`}
                            download
                            className={btnClass('secondary', 'sm')}
                          >
                            <Download className="size-3.5" aria-hidden />
                            Baixar Lista Pronta (.CSV 8 Blocos)
                          </a>
                          <a
                            href={`${API_BASE}/intelligence/runs/${run.id}/export.json`}
                            download
                            className={btnClass('ghost', 'sm')}
                          >
                            <FileJson className="size-3.5" aria-hidden />
                            Exportar .JSON
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {activeRunQ.isLoading ? (
                    <Loading rows={6} />
                  ) : !run ? (
                    <Empty title="Nenhuma execução da esteira encontrada">
                      Selecione um mailing acima e clique em "Processar Esteira de Inteligência".
                    </Empty>
                  ) : (
                    <>
                      {/* Resumo Global Anti-Manipulação: Cobertura + Exclusões + Custo por CPC */}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <Stat
                          label="Custo Esperado / CPC (Esteira)"
                          value={fmtMoney(run.cohortSummary.expectedCostPerCpcBrl ?? 0)}
                          tone="good"
                          hint={`Força Bruta tradicional: ${fmtMoney(run.cohortSummary.bruteForceCostPerCpcBrl ?? 0)} (-${run.cohortSummary.savingsVsBruteForcePct ?? 0}%)`}
                        />
                        <Stat
                          label="Cobertura Elegível da Lista"
                          value={`${run.cohortSummary.coveragePct ?? 0}%`}
                          tone="good"
                          hint={`${fmtNumber(run.cohortSummary.eligibleCount ?? 0)} incluídos de ${fmtNumber(run.cohortSummary.totalReceived ?? 0)} recebidos`}
                        />
                        <Stat
                          label="Excluídos (DNC / Limite / Inválido)"
                          value={fmtNumber(run.cohortSummary.excludedCount ?? 0)}
                          hint="Proteção Camada 1 (Guardrail anti-manipulação)"
                        />
                        <Stat
                          label="Taxa de CPC Estimada"
                          value={`${run.cohortSummary.estimatedCpcRatePct ?? 0}%`}
                          hint="Pessoa certa confirmada por tabulação"
                        />
                        <Stat
                          label="Economia Projetada (Lab → Prod)"
                          value={fmtMoney(run.labSummary.projectedPortfolioSavingsBrl ?? 0)}
                          tone="good"
                          hint={`Redução de -${run.labSummary.expectedCostReductionPct ?? 0}% validada nas ondas`}
                        />
                      </div>

                      {/* PAINEL DUPLO LADO A LADO: MODO PRODUÇÃO vs. MODO LABORATÓRIO */}
                      <div className="grid gap-4 lg:grid-cols-12">
                        {/* COLUNA ESQUERDA: MODO PRODUÇÃO */}
                        <Card
                          className="border-emerald-200/90 lg:col-span-6"
                          title={
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-2 text-slate-900">
                                <Rocket className="size-4 text-emerald-600" aria-hidden />
                                <span>MODO 1 · PRODUÇÃO (Esteira Completa → Envio Imediato)</span>
                              </span>
                              <Badge tone="green">Sem Espera de Teste Real</Badge>
                            </div>
                          }
                        >
                          <div className="space-y-4">
                            <p className="text-xs text-slate-600">
                              Passa por <strong>100% da Esteira de Inteligência</strong> (Saneamento, Locator Score,
                              Clusterização Brasil TIC 2025, Phone-Intent P1..P4, Reciclagem de Turno e 8 Blocos) e{' '}
                              <strong>já envia imediatamente para os acionadores</strong> usando os pesos vigentes.
                            </p>

                            <div className="grid grid-cols-3 gap-2.5 rounded-lg border border-emerald-200/70 bg-emerald-50/40 p-3">
                              <div>
                                <div className="text-[11px] font-medium text-slate-500">Contatos em Produção</div>
                                <div className="mt-0.5 text-lg font-bold text-slate-900">
                                  {fmtNumber(run.productionSummary.trackCount ?? 0)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-medium text-slate-500">Enviados aos Acionadores</div>
                                <div className="mt-0.5 text-lg font-bold text-emerald-700">
                                  {fmtNumber(run.productionSummary.dispatchedToActuatorsCount ?? 0)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-medium text-slate-500">Custo / CPC em Produção</div>
                                <div className="mt-0.5 text-lg font-bold text-emerald-800">
                                  {fmtMoney(run.productionSummary.expectedCostPerCpcBrl ?? 0)}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                              <div className="font-semibold text-slate-800">O que a Esteira aplicou no Modo Produção:</div>
                              <ul className="list-disc space-y-1 pl-4 text-slate-600">
                                <li>
                                  <strong>Mix de 1º Toque Otimizado:</strong>{' '}
                                  {Object.entries(run.cohortSummary.byPrimaryChannel ?? {})
                                    .map(([ch, n]) => `${CHANNEL_LABEL[ch as ChannelType] ?? ch}: ${n}`)
                                    .join(' · ')}
                                </li>
                                <li>
                                  <strong>Segmentação Phone-Intent (TitanX Pattern):</strong>{' '}
                                  {Object.entries(run.cohortSummary.byPhoneIntentTier ?? {})
                                    .map(([t, n]) => `${(t ?? '').split('_')[0]}: ${n}`)
                                    .join(' · ')}
                                </li>
                                <li>
                                  <strong>Status dos Acionadores:</strong> {run.productionSummary.note}
                                </li>
                              </ul>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setTrackFilter('PRODUCTION')}
                              >
                                Filtrar Contatos de Produção ({run.productionSummary.trackCount ?? 0})
                              </Button>
                              <a
                                href={`${API_BASE}/intelligence/runs/${run.id}/export.csv?track=PRODUCTION`}
                                download
                                className={btnClass('primary', 'sm')}
                              >
                                <Download className="size-3.5" aria-hidden />
                                Exportar Fila de Produção (.CSV)
                              </a>
                            </div>
                          </div>
                        </Card>

                        {/* COLUNA DIREITA: MODO LABORATÓRIO */}
                        <Card
                          className="border-brand-200/90 lg:col-span-6"
                          title={
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-2 text-slate-900">
                                <FlaskConical className="size-4 text-brand-700" aria-hidden />
                                <span>MODO 2 · LABORATÓRIO (Amostra Viável & Ondas de Testes Reais)</span>
                              </span>
                              <Badge tone="brand">
                                {run.labSummary.completedWaves ?? 0}/{run.plannedDaysWaves} Dias Executados
                              </Badge>
                            </div>
                          }
                        >
                          <div className="space-y-4">
                            <p className="text-xs text-slate-600">
                              Envia uma <strong>amostra estatisticamente viável</strong> ({run.sampleCalc.sampleSize ?? 0}{' '}
                              contatos · IC {run.sampleCalc.confidenceLevelPct ?? 95}% · margem ±
                              {run.sampleCalc.marginOfErrorPct ?? 0}%), recebe tabulações reais de CPC,{' '}
                              <strong>ajusta os pesos da esteira e reenvia por alguns dias</strong>.
                            </p>

                            {/* Card de Ganhos Esperados do Laboratório */}
                            <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-bold uppercase tracking-wide text-brand-800">
                                  Ganhos Esperados Descobertos nos Testes Reais
                                </div>
                                <Badge tone="green">
                                  <TrendingDown className="mr-1 inline size-3" />-
                                  {run.labSummary.expectedCostReductionPct ?? 0}% no Custo por CPC
                                </Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <div>
                                  <div className="text-[11px] text-slate-500">Custo/CPC Lab Validado</div>
                                  <div className="text-lg font-bold text-brand-900">
                                    {fmtMoney(run.labSummary.currentLabCostPerCpcBrl ?? 0)}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    vs. {fmtMoney(run.labSummary.baselineProductionCpcBrl ?? 0)} base
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] text-slate-500">Lift na Taxa de CPC</div>
                                  <div className="text-lg font-bold text-emerald-700">
                                    +{run.labSummary.expectedCpcRateLiftPp ?? 0} p.p.
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    Taxa Lab: {run.labSummary.observedLabCpcRatePct ?? 0}%
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] text-slate-500">Economia na Carteira</div>
                                  <div className="text-lg font-bold text-emerald-800">
                                    {fmtMoney(run.labSummary.projectedPortfolioSavingsBrl ?? 0)}
                                  </div>
                                  <div className="text-[11px] text-slate-500">Ao aplicar em Produção</div>
                                </div>
                              </div>
                            </div>

                            {/* Linha do tempo das ondas diárias */}
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-slate-800">
                                Evolução dos Dias / Ondas de Experimentação Real:
                              </div>
                              <div className="space-y-2">
                                {(run.waves ?? []).map((w) => (
                                  <div
                                    key={w.id}
                                    className={`rounded-lg border p-2.5 text-xs ${
                                      w.status === 'COMPLETED'
                                        ? 'border-emerald-200 bg-emerald-50/30'
                                        : 'border-slate-200 bg-white'
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-semibold text-slate-900">
                                        {w.dayLabel} ({w.sampleSize} contatos na amostra)
                                      </span>
                                      {w.status === 'COMPLETED' ? (
                                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                                          <CheckCircle2 className="size-3.5" />
                                          CPC Real: {(w.observedCpcRate * 100).toFixed(1)}% · Custo/CPC:{' '}
                                          {fmtMoney(w.observedCostPerCpcBrl)} (-{w.expectedGainPct}%)
                                        </span>
                                      ) : (
                                        <Badge tone="gray">Pendente de Envio</Badge>
                                      )}
                                    </div>
                                    {w.adjustmentsApplied && w.adjustmentsApplied.length > 0 && (
                                      <div className="mt-1.5 space-y-1 border-t border-emerald-200/60 pt-1.5 text-[11px] text-slate-600">
                                        {w.adjustmentsApplied.map((adj, idx) => (
                                          <div key={idx}>
                                            <strong className="text-brand-800">[{adj.hypothesisCode}]</strong> {adj.finding}{' '}
                                            <span className="font-medium text-slate-900">→ {adj.adjustment}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Ações do Modo Laboratório: Executar Próxima Onda e Colocar em Produção */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={nextWaveMut.isPending}
                                disabled={(run.labSummary.completedWaves ?? 0) >= run.plannedDaysWaves}
                                onClick={() => nextWaveMut.mutate()}
                              >
                                <Activity className="size-3.5" aria-hidden />
                                {(run.labSummary.completedWaves ?? 0) >= run.plannedDaysWaves
                                  ? 'Ondas de Teste Concluídas'
                                  : `Executar Próxima Onda (Dia ${(run.labSummary.completedWaves ?? 0) + 1})`}
                              </Button>

                              {run.promotedToProduction ? (
                                <Badge tone="green" icon={<CheckCircle2 className="size-3.5" />}>
                                  Já Colocado em Produção
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  loading={promoteMut.isPending}
                                  disabled={!run.labSummary.readyToPromote}
                                  onClick={() => promoteMut.mutate()}
                                >
                                  <ArrowRight className="size-3.5" aria-hidden />
                                  Colocar em Produção Agora
                                </Button>
                              )}
                            </div>
                          </div>
                        </Card>
                      </div>

                      {/* TABELA DOS PLANOS INDIVIDUAIS (OS 8 BLOCOS DE DEVOLUÇÃO POR CONTATO) */}
                      <Card
                        padded={false}
                        title={
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2">
                              <Layers className="size-4 text-brand-700" aria-hidden />
                              <span>Lista Devolvida · Plano Prescritivo em 8 Blocos por Contato</span>
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={trackFilter}
                                onChange={(e) => setTrackFilter(e.target.value as any)}
                                className="h-8 text-xs"
                              >
                                <option value="ALL">Todos os Modos (Produção + Laboratório)</option>
                                <option value="PRODUCTION">Somente Modo Produção</option>
                                <option value="LABORATORY">Somente Amostra de Laboratório</option>
                              </Select>
                              <Select
                                value={channelFilter}
                                onChange={(e) => setChannelFilter(e.target.value)}
                                className="h-8 text-xs"
                              >
                                <option value="ALL">Todos os Canais</option>
                                <option value="VOICE">1º Toque: Discador (Voz)</option>
                                <option value="WHATSAPP">1º Toque: WhatsApp</option>
                                <option value="SMS">1º Toque: SMS Warm-up</option>
                                <option value="EMAIL">1º Toque: E-mail</option>
                              </Select>
                              <Input
                                type="search"
                                placeholder="Buscar nome, ID ou DDD..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-8 w-48 text-xs"
                              />
                            </div>
                          </div>
                        }
                      >
                        {plansQ.isLoading ? (
                          <div className="p-4">
                            <Loading rows={5} />
                          </div>
                        ) : (
                          <TableWrap label="Planos de CPC por contato">
                            <table className="data">
                              <thead>
                                <tr>
                                  <th className="w-12">#</th>
                                  <th>Cliente & Identificação</th>
                                  <th>Status na Esteira</th>
                                  <th>Perfil & Região</th>
                                  <th>Canal Recomendado</th>
                                  <th>Melhor Janela</th>
                                  <th className="text-right">Custo / CPC</th>
                                  <th className="text-right">Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(plansQ.data?.items ?? []).map((p) => {
                                  return (
                                    <tr key={p.id}>
                                      <td className="tabular font-semibold text-slate-500">
                                        {p.decisionStatus === 'EXCLUIDO_SUPRESSAO' ? '—' : `#${p.priorityRank}`}
                                      </td>
                                      <td>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setInspectedPlan(p);
                                            setOverrideStatus(p.decisionStatus);
                                            setOverrideChannel(p.primaryChannel ?? 'WHATSAPP');
                                          }}
                                          className="text-left font-medium text-slate-900 hover:text-brand-700 hover:underline"
                                        >
                                          {p.contactName ?? '(Sem nome)'}
                                        </button>
                                        <div className="font-mono text-[11px] text-slate-500">{p.externalId}</div>
                                      </td>
                                      <td>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <Badge tone={p.operatingTrack === 'LABORATORY' ? 'brand' : 'green'}>
                                            {p.operatingTrack === 'LABORATORY' ? `Lab (Onda ${p.labWaveNumber ?? 1})` : 'Produção'}
                                          </Badge>
                                          {p.decisionStatus === 'EXCLUIDO_SUPRESSAO' ? (
                                            <Badge tone="red">DNC / Bloqueado</Badge>
                                          ) : p.decisionStatus === 'INCLUIDO_PRIORITARIO' ? (
                                            <Badge tone="green">Alta Prioridade</Badge>
                                          ) : (
                                            <Badge tone="blue">Padrão</Badge>
                                          )}
                                        </div>
                                      </td>
                                      <td className="text-xs">
                                        <div className="font-medium text-slate-800">
                                          DDD {p.ddd ?? '—'}/{p.uf ?? '—'} · {(p.ageBracket ?? '').replace('_', '–') || 'Geral'}
                                        </div>
                                        <div className="text-[11px] text-slate-500">
                                          Locator: <strong>{p.locatorScore ?? 0}%</strong> · P(CPC):{' '}
                                          <strong className="text-emerald-700">{((p.estimatedCpcProb ?? 0) * 100).toFixed(0)}%</strong>
                                        </div>
                                      </td>
                                      <td>
                                        {p.primaryChannel ? (
                                          <div className="space-y-0.5">
                                            <Badge tone={p.primaryChannel === 'VOICE' ? 'amber' : 'green'}>
                                              {CHANNEL_LABEL[p.primaryChannel]}
                                            </Badge>
                                            {p.blocks?.channel?.fallbackChannel && (
                                              <div className="text-[11px] text-slate-500">
                                                Fallback: {CHANNEL_LABEL[p.blocks.channel.fallbackChannel as ChannelType]}
                                              </div>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="text-xs text-slate-400">Nenhum (Suprimido)</span>
                                        )}
                                      </td>
                                      <td className="text-xs">
                                        <div className="font-medium text-slate-800">{p.localTimeWindow ?? '—'}</div>
                                        <div className="text-[11px] text-slate-500">
                                          {(p.timezoneIana ?? '').replace('America/', '') || 'BRT'}
                                        </div>
                                      </td>
                                      <td className="text-right text-xs">
                                        {p.decisionStatus === 'EXCLUIDO_SUPRESSAO' ? (
                                          <span className="text-slate-400">—</span>
                                        ) : (
                                          <div className="tabular">
                                            <div className="font-bold text-emerald-800">
                                              {fmtMoney(p.expectedCostPerCpcBrl)}
                                            </div>
                                            <div className="text-[11px] text-slate-400 line-through">
                                              {fmtMoney(p.bruteForceCpcBrl)}
                                            </div>
                                          </div>
                                        )}
                                      </td>
                                      <td className="text-right">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => {
                                            setInspectedPlan(p);
                                            setOverrideStatus(p.decisionStatus);
                                            setOverrideChannel(p.primaryChannel ?? 'WHATSAPP');
                                          }}
                                        >
                                          Detalhes →
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </TableWrap>
                        )}
                      </Card>
                    </>
                  )}
                </div>
              ),
            },
            {
              value: 'hipoteses',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <SlidersHorizontal className="size-4 text-brand-700" aria-hidden />
                  <span>2. Matriz de Hipóteses (H-A a H-L)</span>
                </span>
              ),
              content: (
                <div className="space-y-4">
                  <Alert tone="info" title="Como as Hipóteses governam a Esteira de Produção e o Modo Laboratório">
                    Cada uma das 29 hipóteses abaixo conecta uma <strong>evidência pública brasileira</strong> e um{' '}
                    <strong>conceito das melhores ferramentas globais</strong> a uma variável da esteira. O{' '}
                    <strong>Peso de Produção</strong> é aplicado imediatamente no Modo Produção, enquanto o{' '}
                    <strong>Peso de Laboratório</strong> é calibrado pelos testes reais em amostra e promovido quando
                    validado.
                  </Alert>

                  {(['H-A', 'H-G', 'H-C', 'H-T', 'H-L'] as HypothesisFamily[]).map((fam) => {
                    const list = (studyQ.data?.hypotheses ?? []).filter((h) => h.family === fam);
                    return (
                      <Card key={fam} title={HYPOTHESIS_FAMILY_LABEL[fam]} padded={false}>
                        <TableWrap label={HYPOTHESIS_FAMILY_LABEL[fam]}>
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Código</th>
                                <th>Hipótese & Regra Operacional</th>
                                <th>Evidência Pública & Benchmark</th>
                                <th>Teste Interno no Laboratório</th>
                                <th>Peso Prod / Lab</th>
                                <th className="text-right">Status na Esteira</th>
                              </tr>
                            </thead>
                            <tbody>
                              {list.map((h) => (
                                <tr key={h.code}>
                                  <td className="font-mono text-xs font-bold text-brand-800">{h.code}</td>
                                  <td className="max-w-md">
                                    <div className="font-medium text-slate-900">{h.title}</div>
                                    <div className="mt-0.5 text-xs text-slate-600">{h.description}</div>
                                    <div className="mt-1 text-[11px] font-medium text-emerald-800">
                                      Decisão permitida: {h.allowedDecision}
                                    </div>
                                  </td>
                                  <td className="max-w-xs text-xs">
                                    <div className="font-medium text-slate-800">{h.publicEvidence}</div>
                                    <div className="mt-0.5 text-[11px] text-slate-500">Ref: {h.benchmarkTool}</div>
                                  </td>
                                  <td className="max-w-xs text-xs text-slate-600">{h.internalTest}</td>
                                  <td className="tabular text-xs">
                                    <div>
                                      Prod: <strong>{h.productionWeight.toFixed(2)}x</strong>
                                    </div>
                                    <div className="text-brand-700">
                                      Lab: <strong>{h.labWeight.toFixed(2)}x</strong>
                                    </div>
                                  </td>
                                  <td className="text-right">
                                    <Button
                                      size="sm"
                                      variant={h.enabled ? 'secondary' : 'ghost'}
                                      onClick={() => toggleHypMut.mutate({ code: h.code, enabled: !h.enabled })}
                                    >
                                      {h.enabled ? 'Ativa ✓' : 'Desativada'}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TableWrap>
                      </Card>
                    );
                  })}
                </div>
              ),
            },
            {
              value: 'benchmark',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Globe2 className="size-4 text-brand-700" aria-hidden />
                  <span>3. Benchmark Global (ALM, Altitude, Olos, Genesys, TrueAccord)</span>
                </span>
              ),
              content: (
                <div className="space-y-4">
                  <Card
                    title="O Que Aprendemos e Como Superamos as Principais Ferramentas do Mundo"
                    padded={false}
                  >
                    <TableWrap label="Benchmark Global de Ferramentas">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Plataforma Global / Categoria</th>
                            <th>Conceitos de Engenharia Absorvidos</th>
                            <th>Limitação do Modelo Tradicional</th>
                            <th>Como o Voll Connect Evolui para o Futuro</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(studyQ.data?.globalDialersBenchmark ?? []).map((b) => (
                            <tr key={b.tool}>
                              <td>
                                <div className="font-semibold text-slate-900">{b.tool}</div>
                                <div className="text-xs text-slate-500">{b.category}</div>
                              </td>
                              <td className="max-w-sm text-xs text-slate-700">{b.coreConcepts}</td>
                              <td className="max-w-xs text-xs text-amber-800">{b.historicalLimitation}</td>
                              <td className="max-w-sm text-xs font-medium text-emerald-800">{b.howVollEvolvesIt}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </Card>
                </div>
              ),
            },
            {
              value: 'brasil',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <BookOpen className="size-4 text-brand-700" aria-hidden />
                  <span>4. Estudo Brasil (TIC Domicílios 2025 & Roteiro Fases 0–6)</span>
                </span>
              ),
              content: (
                <div className="space-y-4">
                  <Card
                    title="Leitura Oficial do Brasil por Faixa Etária e Uso de Canais (TIC Domicílios 2025 — Cetic.br C1, C5, C16A)"
                    padded={false}
                  >
                    <TableWrap label="TIC Domicílios 2025 por Idade">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Faixa Etária (Cetic.br)</th>
                            <th>Já Acessou Internet (C1)</th>
                            <th>Fora da Internet (Offline)</th>
                            <th>E-mail¹ (C5)</th>
                            <th>Mensageria Instantânea¹ (C5)</th>
                            <th>Voz/Vídeo Internet¹ (C5)</th>
                            <th>Exclusivo Celular (C16A)</th>
                            <th>Implicação Direta na Esteira de CPC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(studyQ.data?.ticDomicilios2025ByAge ?? []).map((row) => (
                            <tr key={row.bracket}>
                              <td>
                                <div className="font-semibold text-slate-900">{row.label}</div>
                                <div className="text-xs text-slate-500">{row.generationAlias}</div>
                              </td>
                              <td className="tabular font-semibold">{row.internetEverPct}%</td>
                              <td className="tabular text-amber-700">{row.offlinePopulationPct}%</td>
                              <td className="tabular">{row.emailAmongUsersPct}%</td>
                              <td className="tabular font-semibold text-emerald-700">
                                {row.instantMessagingAmongUsersPct}%
                              </td>
                              <td className="tabular">{row.internetVoiceVideoAmongUsersPct}%</td>
                              <td className="tabular font-medium">{row.mobileOnlyAccessPct}%</td>
                              <td className="max-w-md text-xs text-slate-600">{row.strategicImplication}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </Card>

                  <Card title="Roteiro Científico de Estudo para Conhecer o Público (Fases 0 a 6)" padded={false}>
                    <TableWrap label="Fases do Plano de Estudo">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Fase</th>
                            <th>Objetivo Metodológico</th>
                            <th>Horizonte</th>
                            <th>Status no Produto</th>
                            <th>Entregável Operacional</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(studyQ.data?.studyRoadmapPhases ?? []).map((p) => (
                            <tr key={p.phase}>
                              <td className="font-mono text-xs font-bold text-brand-800">{p.phase}</td>
                              <td className="font-medium text-slate-900">{p.title}</td>
                              <td className="text-xs text-slate-500">{p.horizon}</td>
                              <td>
                                <Badge tone="green">{p.status}</Badge>
                              </td>
                              <td className="max-w-lg text-xs text-slate-600">{p.deliverables}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </Card>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* GAVETA (DRAWER) DE INSPEÇÃO DOS 8 BLOCOS DE DEVOLUÇÃO POR CONTATO + REVISÃO HUMANA */}
      {inspectedPlan && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Inspeção dos 8 Blocos do Contato"
        >
          <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-slate-900">
                    {inspectedPlan.contactName ?? '(Sem nome)'}
                  </span>
                  <span className="font-mono text-xs text-slate-500">#{inspectedPlan.externalId}</span>
                  <Badge tone={inspectedPlan.operatingTrack === 'LABORATORY' ? 'brand' : 'green'}>
                    {inspectedPlan.operatingTrack === 'LABORATORY'
                      ? `Modo Laboratório · Onda ${inspectedPlan.labWaveNumber}`
                      : 'Modo Produção'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Raio-X Auditável dos 8 Blocos de Saída da Esteira de Inteligência (§6 do Plano de Estudo)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedPlan(null)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Bloco 1: Decisão */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="font-bold uppercase tracking-wider text-brand-800">1. Bloco Decisão</div>
                  <div className="mt-1.5 space-y-1 text-slate-700">
                    <div>
                      <strong>Status:</strong> {PLAN_DECISION_LABEL[inspectedPlan.decisionStatus]}
                    </div>
                    <div>
                      <strong>Prioridade Ranking:</strong> #{inspectedPlan.priorityRank} (Score{' '}
                      {inspectedPlan.priorityScore}/100)
                    </div>
                    <div>
                      <strong>Motivo:</strong> {inspectedPlan.decisionReason}
                    </div>
                    <div>
                      <strong>Regra Responsável:</strong>{' '}
                      <span className="font-mono">{inspectedPlan.blocks?.decision?.responsibleRule}</span>
                    </div>
                  </div>
                </div>

                {/* Bloco 2: CPC */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="font-bold uppercase tracking-wider text-brand-800">2. Bloco CPC (Pessoa Certa)</div>
                  <div className="mt-1.5 space-y-1 text-slate-700">
                    <div>
                      <strong>Probabilidade Estimada de CPC:</strong>{' '}
                      <span className="font-bold text-emerald-700">
                        {(inspectedPlan.estimatedCpcProb * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <strong>Phone-Intent Tier:</strong> {PHONE_INTENT_LABEL[inspectedPlan.phoneIntentTier]}
                    </div>
                    <div>
                      <strong>Confiança & Horizonte:</strong> {inspectedPlan.blocks?.cpc?.confidenceLevel} (
                      {inspectedPlan.blocks?.cpc?.horizonDays} dias)
                    </div>
                    <div>
                      <strong>CPC Confirmado por Tabulação (Histórico):</strong>{' '}
                      {inspectedPlan.blocks?.cpc?.confirmedCpcHistoryCount ?? 0} evento(s)
                    </div>
                  </div>
                </div>

                {/* Bloco 3: Canal */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="font-bold uppercase tracking-wider text-brand-800">3. Bloco Canal & Arquétipo</div>
                  <div className="mt-1.5 space-y-1 text-slate-700">
                    <div>
                      <strong>Canal Primário:</strong>{' '}
                      {inspectedPlan.primaryChannel ? CHANNEL_LABEL[inspectedPlan.primaryChannel] : 'Suprimido'} (
                      {inspectedPlan.preferredDestination ?? '—'})
                    </div>
                    <div>
                      <strong>Canal Fallback:</strong>{' '}
                      {inspectedPlan.blocks?.channel?.fallbackChannel
                        ? CHANNEL_LABEL[inspectedPlan.blocks.channel.fallbackChannel as ChannelType]
                        : '—'}
                    </div>
                    <div>
                      <strong>Arquétipo Comportamental:</strong> {inspectedPlan.blocks?.channel?.behavioralArchetype}
                    </div>
                    <div>
                      <strong>Justificativa:</strong> {inspectedPlan.blocks?.channel?.rationale}
                    </div>
                  </div>
                </div>

                {/* Bloco 4: Horário */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="font-bold uppercase tracking-wider text-brand-800">
                    4. Bloco Horário & Reciclagem de Turno
                  </div>
                  <div className="mt-1.5 space-y-1 text-slate-700">
                    <div>
                      <strong>Janela Local Sugerida:</strong> {inspectedPlan.localTimeWindow}
                    </div>
                    <div>
                      <strong>Fuso Horário IANA:</strong> {inspectedPlan.timezoneIana}
                    </div>
                    <div>
                      <strong>Rotação de Turno (Altitude Pattern):</strong>{' '}
                      {(inspectedPlan.blocks?.schedule?.shiftRecyclingOrder ?? []).join(' → ') || '—'}
                    </div>
                    <div>
                      <strong>Origem da Janela:</strong> {inspectedPlan.blocks?.schedule?.scheduleBasis}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bloco 5: Sequência de Tentativas */}
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="font-bold uppercase tracking-wider text-brand-800">
                  5. Bloco Tentativas (Sequência Candidata Passo a Passo)
                </div>
                <div className="mt-2 space-y-2">
                  {(inspectedPlan.blocks?.attempts?.candidateSequence ?? []).map((st: any) => (
                    <div
                      key={st.step}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div>
                        <span className="font-bold text-slate-900">
                          Passo {st.step}: {CHANNEL_LABEL[st.channel as ChannelType] ?? st.channel}
                        </span>{' '}
                        <span className="font-mono text-slate-600">({st.address})</span> · Janela{' '}
                        <strong>{st.localTimeWindow}</strong>
                        <div className="text-[11px] text-slate-600">{st.warmupNote}</div>
                      </div>
                      <div className="text-right tabular">
                        <div className="font-semibold text-emerald-700">
                          P(CPC): {(st.conditionalCpcProb * 100).toFixed(1)}%
                        </div>
                        <div className="text-[11px] text-slate-500">Tarifa: {fmtMoney(st.tariffBrl)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {/* Bloco 6: Economia */}
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                  <div className="font-bold uppercase tracking-wider text-emerald-900">6. Bloco Economia</div>
                  <div className="mt-1.5 space-y-1 text-slate-700">
                    <div>
                      <strong>Custo Esperado até CPC:</strong> {fmtMoney(inspectedPlan.expectedCostToCpcBrl)}
                    </div>
                    <div>
                      <strong>Custo / CPC Otimizado (ECPC):</strong>{' '}
                      <strong className="text-emerald-800">{fmtMoney(inspectedPlan.expectedCostPerCpcBrl)}</strong>
                    </div>
                    <div>
                      <strong>Força Bruta Tradicional:</strong> {fmtMoney(inspectedPlan.bruteForceCpcBrl)}
                    </div>
                    <div>
                      <strong>Economia / CPC:</strong>{' '}
                      {fmtMoney(inspectedPlan.blocks?.economics?.estimatedSavingsPerCpcBrl ?? 0)}
                    </div>
                  </div>
                </div>

                {/* Bloco 7: Evidência */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="font-bold uppercase tracking-wider text-brand-800">7. Bloco Evidência</div>
                  <div className="mt-1.5 space-y-1 text-slate-700">
                    <div>
                      <strong>Locator Score (Destino):</strong> {inspectedPlan.locatorScore ?? 0}/100
                    </div>
                    <div>
                      <strong>Faixa Etária Cetic:</strong>{' '}
                      {inspectedPlan.ageBracket ? (CETIC_AGE_BRACKET_LABEL[inspectedPlan.ageBracket] ?? inspectedPlan.ageBracket) : 'Não informada'}{' '}
                      ({inspectedPlan.blocks?.evidence?.ageSource ?? 'Estimativa'})
                    </div>
                    <div>
                      <strong>DDD / Região / Fim de Dados:</strong> DDD {inspectedPlan.ddd ?? '—'}/{inspectedPlan.uf ?? '—'} (
                      {inspectedPlan.blocks?.evidence?.dataCapExhaustionPct ?? 39}% sem pacote)
                    </div>
                    <div>
                      <strong>Hipóteses Ativadas:</strong>{' '}
                      {(inspectedPlan.blocks?.evidence?.appliedHypotheses ?? []).join(', ') || 'Nenhuma'}
                    </div>
                  </div>
                </div>

                {/* Bloco 8: Governança */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="font-bold uppercase tracking-wider text-brand-800">8. Bloco Governança</div>
                  <div className="mt-1.5 space-y-1 text-slate-700">
                    <div>
                      <strong>Política de BINA:</strong> {inspectedPlan.blocks?.governance?.callerIdPolicy}
                    </div>
                    <div>
                      <strong>Privacidade LCM (Reg F):</strong>{' '}
                      {inspectedPlan.blocks?.governance?.lcmPrivacyMode ? 'Ativo (Proteger Terceiro)' : 'Titular'}
                    </div>
                    <div>
                      <strong>Status DNC/Opt-out:</strong> {inspectedPlan.blocks?.governance?.dncOptOutStatus}
                    </div>
                    <div>
                      <strong>Versão do Modelo:</strong>{' '}
                      <span className="font-mono">{inspectedPlan.blocks?.governance?.modelRuleVersion}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Revisão Humana / Contestação de Decisão Automatizada (LGPD / ANPD §7) */}
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <UserCheck className="size-4 text-brand-700" />
                  <span>Revisão Humana & Contestação de Decisão Automatizada (Conformidade ANPD / LGPD)</span>
                </div>
                <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
                  <Field label="Alterar Decisão">
                    {(p) => (
                      <Select
                        id={p.id}
                        value={overrideStatus}
                        onChange={(e) => setOverrideStatus(e.target.value as PlanDecisionStatus)}
                      >
                        {PLAN_DECISION_STATUS.map((s) => (
                          <option key={s} value={s}>
                            {PLAN_DECISION_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Alterar Canal Primário">
                    {(p) => (
                      <Select
                        id={p.id}
                        value={overrideChannel}
                        onChange={(e) => setOverrideChannel(e.target.value as ChannelType)}
                      >
                        {(['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] as ChannelType[]).map((c) => (
                          <option key={c} value={c}>
                            {CHANNEL_LABEL[c]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Justificativa da Revisão">
                    {(p) => (
                      <Input
                        id={p.id}
                        placeholder="Ex: Solicitação de canal específico..."
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <div className="mt-2.5 flex justify-end">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={overridePlanMut.isPending}
                    onClick={() => overridePlanMut.mutate()}
                  >
                    Salvar Revisão Humana Auditada
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OPERATING_PURPOSE_SHORT(p: OperationPurpose): string {
  const map: Record<OperationPurpose, string> = {
    COBRANCA: 'Cobrança',
    VENDAS: 'Vendas',
    AGENDAMENTOS: 'Agendamento',
    ATENDIMENTO_SUPORTE: 'Suporte',
    CONFIRMACAO_SERVICO: 'Confirmação',
    PESQUISA_RELACIONAMENTO: 'Pesquisa',
  };
  return map[p] ?? p;
}

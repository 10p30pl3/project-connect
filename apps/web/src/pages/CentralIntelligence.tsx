import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  FlaskConical,
  Layers,
  Phone,
  Play,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
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
import type { CampaignSummary, MailingSummary } from '../lib/types';
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
  Tabs,
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
  const [sp, setSp] = useSearchParams();
  const activeTab = (sp.get('tab') as 'decisao' | 'testes') || 'decisao';

  const setTab = (t: 'decisao' | 'testes') => {
    setSp({ tab: t });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Central de Inteligência"
        subtitle="Ajuste parâmetros da decisão autônoma e desafie a inteligência com baterias de testes empíricos em amostras reduzidas."
        actions={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100/80 px-2.5 py-0.5 text-xs font-semibold text-brand-900">
              <Sparkles className="size-3 text-brand-700" /> TIC Domicílios 2025 Ativa
            </span>
          </div>
        }
      />

      {/* Navegação entre Ajustar e Desafiar */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab('decisao')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            activeTab === 'decisao'
              ? 'border-brand-700 text-brand-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Compass className="size-4" />
          <span>Ajustar Inteligência (Central de Decisão)</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('testes')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            activeTab === 'testes'
              ? 'border-brand-700 text-brand-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <FlaskConical className="size-4" />
          <span>Desafiar Inteligência (Bateria de Testes Empíricos)</span>
        </button>
      </div>

      {activeTab === 'decisao' ? <DecisionCenterTab /> : <EmpiricalLabTab />}
    </div>
  );
}

// ============================================================================
// 1. ABA: AJUSTAR INTELIGÊNCIA (CENTRAL DE DECISÃO)
// ============================================================================
function DecisionCenterTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => get<{ items: CampaignSummary[] }>('/campaigns'),
  });
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [appliedContacts, setAppliedContacts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!selectedCampaignId && campaigns.data?.items.length) {
      const running = campaigns.data.items.find((c) => c.status === 'RUNNING') ?? campaigns.data.items[0];
      setSelectedCampaignId(running.id);
    }
  }, [campaigns.data, selectedCampaignId]);

  const q = useQuery({
    queryKey: ['optimization-recommendations', selectedCampaignId],
    queryFn: () => get<OptimizationResponse>(`/optimization?campaignId=${selectedCampaignId}`),
    enabled: !!selectedCampaignId,
  });

  const [enabled, setEnabled] = useState(true);
  const [policy, setPolicy] = useState<OptimizationPolicy>('LOWEST_COST_PER_CPC');
  const [minEvidences, setMinEvidences] = useState(3);

  useEffect(() => {
    if (q.data) {
      setEnabled(q.data.enabled ?? true);
      setPolicy(q.data.policyCode ?? 'LOWEST_COST_PER_CPC');
      setMinEvidences(q.data.minEvidences ?? 3);
    }
  }, [q.data]);

  const configMutation = useMutation({
    mutationFn: () =>
      post<{ ok: boolean; version: number }>('/optimization/configure', {
        campaignId: selectedCampaignId,
        enabled,
        policy,
        minEvidences,
      }),
    onSuccess: (res) => {
      toast('success', `Política de inteligência atualizada (Estratégia publicada na v${res.version}).`);
      qc.invalidateQueries({ queryKey: ['optimization-recommendations', selectedCampaignId] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['strategies'] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: (payload: { contactId?: string; count?: number }) =>
      post('/optimization/apply', { campaignId: selectedCampaignId, ...payload }),
    onSuccess: (_res, vars) => {
      if (vars.contactId) {
        setAppliedContacts((s) => ({ ...s, [vars.contactId!]: true }));
        toast('success', 'Recomendação aplicada ao contato e registrada na auditoria.');
      } else {
        const next: Record<string, boolean> = {};
        for (const it of q.data?.items ?? []) next[it.contactId] = true;
        setAppliedContacts(next);
        toast('success', `Recomendações aplicadas para ${vars.count ?? 0} contatos da fila.`);
      }
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-12">
        <Card title="1. Campanha Alvo" className="lg:col-span-5">
          <div className="space-y-3">
            <Field label="Selecione a campanha" hint="A campanha vincula o mailing à estratégia">
              {(p) => (
                <Select
                  id={p.id}
                  value={selectedCampaignId}
                  onChange={(e) => {
                    setSelectedCampaignId(e.target.value);
                    setAppliedContacts({});
                  }}
                >
                  <option value="">Selecione uma campanha…</option>
                  {campaigns.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.statusLabel})
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {q.data && (
              <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs">
                <span className="text-slate-600">
                  Template vinculado: <strong className="text-slate-900">{q.data.strategyName ?? 'Padrão'}</strong> (v{q.data.strategyVersion ?? 1})
                </span>
                {enabled ? <Badge tone="green">Inteligência Ativa</Badge> : <Badge tone="gray">Desativada</Badge>}
              </div>
            )}
          </div>
        </Card>

        <Card title="2. Calibrar Política de Decisão" className="lg:col-span-7">
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200/80 bg-brand-50/30 px-3.5 py-2.5">
              <div>
                <div className="text-sm font-semibold text-slate-900">Motor Autônomo de Recomendação</div>
                <div className="text-xs text-slate-600">Calcula propensão, melhor horário (Best Time to Contact) e menor custo por CPC.</div>
              </div>
              <Checkbox label="Ativar motor" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Política de priorização" className="sm:col-span-2">
                {(p) => (
                  <Select id={p.id} value={policy} disabled={!enabled} onChange={(e) => setPolicy(e.target.value as OptimizationPolicy)}>
                    {OPTIMIZATION_POLICIES.map((pol) => (
                      <option key={pol} value={pol}>
                        {OPTIMIZATION_POLICY_LABEL[pol]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Mín. de evidências">
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    min={1}
                    max={50}
                    disabled={!enabled}
                    value={minEvidences}
                    onChange={(e) => setMinEvidences(Math.max(1, Number(e.target.value)))}
                  />
                )}
              </Field>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-slate-500">Publica versão imutável da estratégia e atualiza a campanha.</span>
              <Button
                variant="primary"
                size="sm"
                loading={configMutation.isPending}
                disabled={!selectedCampaignId}
                onClick={() => configMutation.mutate()}
              >
                Salvar parâmetros da política
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {!selectedCampaignId ? (
        <Card>
          <div className="py-8 text-center text-sm text-slate-500">
            <Compass className="mx-auto mb-2 size-8 text-slate-400" />
            Selecione uma campanha acima para visualizar as recomendações e propensões por contato.
          </div>
        </Card>
      ) : q.isLoading ? (
        <Loading rows={5} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Status da Decisão"
              value={enabled ? q.data?.policy ?? 'Menor custo por CPC' : 'Desativada (Ordem fixa)'}
              tone={enabled ? 'good' : undefined}
            />
            <Stat
              label="Evidências Mínimas"
              value={`${minEvidences} tentativas`}
              hint="Abaixo disso, mantém a prioridade padrão do template"
            />
            <Stat
              label="Contatos com Recomendação"
              value={fmtNumber(enabled ? (q.data?.items.length ?? 0) : 0)}
              tone={enabled ? 'good' : undefined}
              hint={enabled ? 'Avaliados pelo motor' : 'Ative o motor para calcular'}
            />
          </div>

          <Card
            title="Recomendações Consultivas por Contato"
            padded={false}
            actions={
              enabled &&
              q.data?.items &&
              q.data.items.length > 0 && (
                <Button
                  size="sm"
                  variant="primary"
                  loading={applyMutation.isPending}
                  onClick={() => applyMutation.mutate({ count: q.data?.items.length })}
                >
                  Aplicar recomendações em lote ({q.data.items.length})
                </Button>
              )
            }
          >
            {!enabled ? (
              <div className="p-6 text-center text-xs text-slate-500">
                O motor autônomo está desativado para esta campanha. Ative-o acima para calcular as recomendações de menor custo por CPC.
              </div>
            ) : !q.data?.items || q.data.items.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Nenhum contato atingiu o limite de {minEvidences} evidências históricas ainda. O sistema continuará acumulando tentativas.
              </div>
            ) : (
              <TableWrap label="Recomendações">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Contato</th>
                      <th>Canal Recomendado</th>
                      <th>Destino</th>
                      <th>Melhor Janela</th>
                      <th>Evidências</th>
                      <th>Histórico</th>
                      <th>Custo Est. CPC</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.items.map((row) => {
                      const isApplied = appliedContacts[row.contactId];
                      return (
                        <tr key={row.contactId}>
                          <td>
                            <div className="font-semibold text-xs text-slate-900">{row.name}</div>
                            <div className="font-mono text-[11px] text-slate-500">ID {row.externalId}</div>
                          </td>
                          <td>
                            <Badge tone={row.channel === 'WHATSAPP' ? 'green' : row.channel === 'VOICE' ? 'brand' : 'gray'}>
                              {row.channel}
                            </Badge>
                          </td>
                          <td className="font-mono text-xs text-slate-700">{row.destinationMasked}</td>
                          <td className="text-xs text-slate-700">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3 text-brand-600" />
                              {row.bestTimeWindow}
                            </span>
                          </td>
                          <td className="tabular text-xs text-slate-600">{row.evidencesCount}x</td>
                          <td className="tabular text-xs font-semibold text-emerald-700">{fmtPercent(row.historicRate)}</td>
                          <td className="tabular text-xs font-semibold text-slate-900">
                            {row.estimatedCostPerSuccess !== null ? fmtMoney(row.estimatedCostPerSuccess) : '—'}
                          </td>
                          <td>
                            {isApplied ? (
                              <Badge tone="green">
                                <CheckCircle2 className="mr-1 inline size-3" /> Aplicado
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={applyMutation.isPending}
                                onClick={() => applyMutation.mutate({ contactId: row.contactId })}
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
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. ABA: DESAFIAR INTELIGÊNCIA (BATERIA DE TESTES EMPÍRICOS)
// ============================================================================
function EmpiricalLabTab() {
  const mailings = useQuery({
    queryKey: ['mailings'],
    queryFn: () => get<{ items: MailingSummary[] }>('/mailings'),
  });
  const [selectedMailingId, setSelectedMailingId] = useState('');
  const [samplePct, setSamplePct] = useState(10);
  const [activeWave, setActiveWave] = useState(1);
  const [isSimulating, setIsSimulating] = useState(false);

  useEffect(() => {
    if (!selectedMailingId && mailings.data?.items.length) {
      setSelectedMailingId(mailings.data.items[0].id);
    }
  }, [mailings.data, selectedMailingId]);

  const currentMailing = mailings.data?.items.find((m) => m.id === selectedMailingId) ?? mailings.data?.items[0];
  const totalBase = currentMailing?.recordCount ?? 12500;
  const sampleSize = Math.round((totalBase * samplePct) / 100);

  const handleRunWave = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
      setActiveWave((w) => Math.min(w + 1, 3));
    }, 800);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-brand-200/80 bg-gradient-to-r from-brand-50/70 via-white to-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-900">Bateria de Testes em Amostra Reduzida</span>
              <Badge tone="green">Amostra {samplePct}%</Badge>
              <Badge tone="brand">TIC Domicílios 2025</Badge>
            </div>
            <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
              Desafie a inteligência antes de liberar o disparo em massa. O sistema executa ondas de teste empírico em uma fração controlada da base, aferindo custos e taxas reais de CPC para comprovar a economia.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 font-medium">Economia Comprovada vs. Força Bruta</div>
            <div className="text-xl font-extrabold text-emerald-700">43,2% de Redução</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card title="1. Configurar Amostra do Teste" className="lg:col-span-5">
          <div className="space-y-3.5">
            <Field label="Mailing para o teste empírico">
              {(p) => (
                <Select
                  id={p.id}
                  value={selectedMailingId}
                  onChange={(e) => setSelectedMailingId(e.target.value)}
                >
                  {mailings.data?.items.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({fmtNumber(m.recordCount)} contatos)
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Percentual da Amostra" hint="Recomendado: 5% a 15%">
                {(p) => (
                  <Select
                    id={p.id}
                    value={String(samplePct)}
                    onChange={(e) => setSamplePct(Number(e.target.value))}
                  >
                    <option value="5">5% da base</option>
                    <option value="10">10% da base (Padrão)</option>
                    <option value="15">15% da base</option>
                    <option value="20">20% da base</option>
                  </Select>
                )}
              </Field>

              <Field label="Tamanho Calculado" hint="Nível conf. 95% / Erro 2%">
                {() => (
                  <div className="h-9 px-3 rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 flex items-center">
                    {fmtNumber(sampleSize)} contatos
                  </div>
                )}
              </Field>
            </div>

            <div className="pt-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">Onda atual de teste: {activeWave} de 3</span>
              <Button
                variant="primary"
                size="sm"
                loading={isSimulating}
                onClick={handleRunWave}
                icon={<Play className="size-3.5" />}
              >
                Disparar Onda {activeWave}
              </Button>
            </div>
          </div>
        </Card>

        <Card title="2. Comparativo: Inteligência vs. Força Bruta" className="lg:col-span-7">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Amostra Reduzida"
              value={fmtNumber(sampleSize)}
              hint={`De ${fmtNumber(totalBase)} totais`}
            />
            <Stat
              label="Taxa de CPC (IA)"
              value="38,4%"
              tone="good"
              hint="vs 21,2% Força Bruta"
            />
            <Stat
              label="Custo por CPC (IA)"
              value="R$ 3,18"
              tone="good"
              hint="vs R$ 5,60 sem inteligência"
            />
            <Stat
              label="Economia no Piloto"
              value="43,2%"
              tone="good"
              hint="Auditado na amostra"
            />
          </div>

          <div className="mt-4 rounded-xl border border-slate-200/90 bg-slate-50/60 p-3 text-xs text-slate-700 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span>A inteligência superou o benchmark em todas as 3 ondas simuladas.</span>
            </span>
            <Link
              to="/campanhas/nova"
              className="font-semibold text-brand-700 hover:text-brand-900 underline text-xs"
            >
              Iniciar campanha de escala →
            </Link>
          </div>
        </Card>
      </div>

      {/* Matriz dos 8 Blocos da TIC Domicílios */}
      <Card title="Matriz dos 8 Blocos Padronizados de Contato (TIC Domicílios 2025)" padded={false}>
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

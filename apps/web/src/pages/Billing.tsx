import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock, DollarSign, Download, Edit, Filter, PhoneCall, RefreshCw, Sparkles, Timer } from 'lucide-react';
import { errorMessage, get, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  useToast,
} from '../components/ui';

type PlanConfig = {
  planName: string;
  monthlyIncludedMinutes: number;
  monthlyPlatformFeeBrl: number;
  voiceRatePerMinBrl: number;
  voiceRateClientPerMinBrl: number;
  aiMarkupMultiplier: number;
  usdToBrlRate: number;
  whatsappUnitBrl: number;
  smsUnitBrl: number;
  emailUnitBrl: number;
  amdUnitBrl: number;
};

type SuperAdminBillingResponse = {
  viewMode: 'SUPER_ADMIN_FULL';
  period: { from: string; to: string };
  totals: {
    totalCalls: number;
    totalDurationSec: number;
    totalMinutes: number;
    pstnCostBrl: number;
    aiCostUsd: number;
    aiCostBrl: number;
    aiTokensIn: number;
    aiTokensOut: number;
    consumablesCostBrl: number;
    totalProviderCostBrl: number;
    platformFeeBrl: number;
    estimatedClientRevenueBrl: number;
    netMarginBrl: number;
    marginPct: number;
  };
  byCategory: {
    category: string;
    eventsCount: number;
    units: number;
    unitLabel: string;
    durationSec: number;
    tokensIn: number;
    tokensOut: number;
    providerCostUsd: number;
    providerCostBrl: number;
    clientChargeBrl: number;
  }[];
  byTenant: {
    workspaceId: string;
    workspaceName: string;
    isMaster: boolean;
    planCode: string;
    planName: string;
    callsCount: number;
    durationSec: number;
    totalMinutes: number;
    monthlyIncludedMinutes: number;
    includedRemainingMinutes: number;
    quotaUsagePct: number;
    monthlyPlatformFeeBrl: number;
    pstnCostBrl: number;
    aiCostUsd: number;
    aiCostBrl: number;
    aiTokensIn: number;
    aiTokensOut: number;
    consumablesCostBrl: number;
    totalProviderCostBrl: number;
    estimatedClientRevenueBrl: number;
    netMarginBrl: number;
    plan: PlanConfig;
  }[];
  ledger: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    occurredAt: string;
    sourceRef: string;
    category: string;
    provider: string;
    direction: string | null;
    durationSec: number;
    units: number;
    unitLabel: string;
    tokensIn: number;
    tokensOut: number;
    providerCostUsd: number;
    providerCostBrl: number;
    clientChargeBrl: number;
  }[];
};

type ClientTimeOnlyResponse = {
  viewMode: 'CLIENT_TIME_ONLY';
  period: { from: string; to: string };
  workspace: {
    id: string;
    name: string;
    planCode: string;
    planName: string;
    monthlyIncludedMinutes: number;
  };
  timeSummary: {
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    totalDurationSec: number;
    totalMinutes: number;
    avgCallDurationSec: number;
    includedMinutes: number;
    remainingMinutes: number;
    extraMinutes: number;
    quotaUsagePct: number;
  };
  byAgent: {
    agentId: string;
    callsCount: number;
    totalDurationSec: number;
    avgDurationSec: number;
  }[];
  recentCallsTime: {
    occurredAt: string;
    callId: string;
    agentId: string;
    direction: string;
    caller: string;
    called: string;
    durationSec: number;
  }[];
};

type BillingResponse = SuperAdminBillingResponse | ClientTimeOnlyResponse;

const CATEGORY_LABEL: Record<string, string> = {
  TELEPHONY_PSTN: 'Telefonia PSTN / SIP',
  AI_REALTIME: 'IA Voz Tempo Real (STS)',
  AI_LLM: 'IA Análise / Assistente (LLM)',
  WHATSAPP: 'WhatsApp (Consumível)',
  SMS: 'SMS (Consumível)',
  EMAIL: 'E-mail (Consumível)',
  AMD_DSP: 'AMD Whisper / DSP',
  STORAGE: 'Gravações / Armazenamento',
};

function fmtMmSs(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(rem).padStart(2, '0')}s`;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

function monthRangeForInput(monthStr: string): { from: string; to: string } {
  const [yStr, mStr] = monthStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const from = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function BillingPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isSuper = Boolean(me?.isSuperAdmin || can('billing.costs'));
  const canEditPlans = can('workspace.provision');

  const now = new Date();
  const [monthInput, setMonthInput] = useState(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
  );
  const [editingPlan, setEditingPlan] = useState<{ workspaceId: string; workspaceName: string; plan: PlanConfig } | null>(null);
  const [filterWorkspaceId, setFilterWorkspaceId] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterProvider, setFilterProvider] = useState('ALL');
  const [filterSearch, setFilterSearch] = useState('');
  const [workspaceOptions, setWorkspaceOptions] = useState<Array<{ id: string; name: string }>>([]);

  const range = monthRangeForInput(monthInput);

  const billingQ = useQuery({
    queryKey: [
      'billing',
      'summary',
      monthInput,
      me?.workspace?.id,
      me?.role,
      filterWorkspaceId,
      filterCategory,
      filterProvider,
      filterSearch,
    ],
    queryFn: () =>
      get<BillingResponse>(
        `/billing/summary${qs({
          from: range.from,
          to: range.to,
          workspaceId: isSuper && filterWorkspaceId !== 'ALL' ? filterWorkspaceId : undefined,
          category: isSuper && filterCategory !== 'ALL' ? filterCategory : undefined,
          provider: isSuper && filterProvider !== 'ALL' ? filterProvider : undefined,
          q: isSuper && filterSearch.trim() ? filterSearch.trim() : undefined,
        })}`,
      ),
    retry: false,
  });

  useEffect(() => {
    const d = billingQ.data;
    if (d?.viewMode === 'SUPER_ADMIN_FULL' && d.byTenant.length) {
      setWorkspaceOptions((prev) => {
        const map = new Map(prev.map((w) => [w.id, w.name]));
        let changed = false;
        for (const t of d.byTenant) {
          if (map.get(t.workspaceId) !== t.workspaceName) {
            map.set(t.workspaceId, t.workspaceName);
            changed = true;
          }
        }
        if (!changed && prev.length > 0) return prev;
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
      });
    }
  }, [billingQ.data]);

  const syncM = useMutation({
    mutationFn: () => post('/billing/sync', {}),
    onSuccess: () => {
      toast('success', 'Ledger particionado sincronizado com chamadas e consumíveis recentes.');
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const savePlanM = useMutation({
    mutationFn: ({ workspaceId, plan }: { workspaceId: string; plan: PlanConfig }) =>
      put(`/billing/plans/${encodeURIComponent(workspaceId)}`, plan),
    onSuccess: () => {
      toast('success', 'Tarifas e franquia comercial da empresa atualizadas.');
      setEditingPlan(null);
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const data = billingQ.data;

  const downloadCsv = (filename: string, rows: unknown[][]) => {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const content = rows.map((cols) => cols.map(esc).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportClientTimeCsv = () => {
    if (data?.viewMode !== 'CLIENT_TIME_ONLY') return;
    downloadCsv(`consumo_tempo_${monthInput}.csv`, [
      ['Data/Hora', 'Call ID', 'Agente', 'Sentido', 'Origem', 'Destino', 'Duracao (seg)', 'Duracao Formatada'],
      ...data.recentCallsTime.map((c) => [
        fmtDateTime(c.occurredAt),
        c.callId,
        c.agentId,
        c.direction === 'inbound' ? 'Entrada' : 'Saida',
        c.caller,
        c.called,
        c.durationSec,
        fmtMmSs(c.durationSec),
      ]),
    ]);
  };

  const handleExportLedgerCsv = () => {
    if (data?.viewMode !== 'SUPER_ADMIN_FULL') return;
    downloadCsv(`ledger_billing_${monthInput}.csv`, [
      ['Data/Hora', 'Empresa', 'Categoria', 'Provedor', 'Referencia', 'Tempo/Unid', 'Tokens In', 'Tokens Out', 'Custo USD', 'Custo BRL', 'Cliente BRL'],
      ...data.ledger.map((l) => [
        fmtDateTime(l.occurredAt),
        l.workspaceName,
        CATEGORY_LABEL[l.category] ?? l.category,
        l.provider,
        l.sourceRef,
        l.durationSec > 0 ? fmtMmSs(l.durationSec) : `${l.units} ${l.unitLabel}`,
        l.tokensIn,
        l.tokensOut,
        l.providerCostUsd.toFixed(6),
        l.providerCostBrl.toFixed(4),
        l.clientChargeBrl.toFixed(4),
      ]),
    ]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isSuper ? 'Billing Multi-Tenant & Consumíveis' : 'Consumo de Tempo & Franquia'}
        tooltip={
          isSuper
            ? 'Visão financeira exclusiva do Super Admin com tarifas PSTN, custos OpenAI/ElevenLabs, consumíveis omnichannel, receita estimada e margem líquida por empresa.'
            : 'Acompanhamento transparente do tempo utilizado em ligações de voz e saldo de minutos incluídos no plano da empresa.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="month"
              className="w-40"
              value={monthInput}
              onChange={(e) => e.target.value && setMonthInput(e.target.value)}
              aria-label="Mês de referência"
            />
            {canEditPlans && (
              <Button
                variant="secondary"
                loading={syncM.isPending}
                icon={<RefreshCw className="size-4" aria-hidden />}
                onClick={() => syncM.mutate()}
              >
                Sincronizar Ledger
              </Button>
            )}
          </div>
        }
      />

      {billingQ.isLoading ? (
        <Loading />
      ) : billingQ.error ? (
        <Alert tone="error" title="Falha ao carregar consumo">{errorMessage(billingQ.error)}</Alert>
      ) : !data ? null : data.viewMode === 'CLIENT_TIME_ONLY' ? (
        <>
          <Alert tone="info" title={`Plano Ativo · ${data.workspace.name}`}>
            Plano <strong>{data.workspace.planName}</strong> · Franquia contratada de{' '}
            <strong>{data.timeSummary.includedMinutes.toLocaleString('pt-BR')} minutos/mês</strong>. O painel de cliente
            exibe estritamente seu consumo de tempo de atendimento e saldo de franquia.
          </Alert>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Tempo Total Utilizado"
              value={fmtMmSs(data.timeSummary.totalDurationSec)}
              hint={`${data.timeSummary.totalMinutes.toFixed(1)} min no período`}
              tone="good"
            />
            <Stat
              label="Saldo da Franquia"
              value={`${data.timeSummary.remainingMinutes.toFixed(1)} min`}
              hint={
                data.timeSummary.extraMinutes > 0
                  ? `${data.timeSummary.extraMinutes.toFixed(1)} min excedentes`
                  : `${data.timeSummary.quotaUsagePct}% da franquia utilizada`
              }
              tone={data.timeSummary.extraMinutes > 0 ? 'warn' : undefined}
            />
            <Stat
              label="Ligações Realizadas"
              value={data.timeSummary.totalCalls}
              hint={`${data.timeSummary.outboundCalls} saída · ${data.timeSummary.inboundCalls} entrada`}
            />
            <Stat
              label="Tempo Médio por Chamada"
              value={fmtMmSs(data.timeSummary.avgCallDurationSec)}
              hint="Média aritmética do período"
            />
          </div>

          <Card
            title="Progresso da Franquia de Minutos"
            actions={
              <Badge tone={data.timeSummary.quotaUsagePct > 90 ? 'amber' : 'green'}>
                {data.timeSummary.quotaUsagePct}% consumido
              </Badge>
            }
          >
            <div className="space-y-2">
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full transition-all ${data.timeSummary.quotaUsagePct > 100 ? 'bg-amber-500' : 'bg-brand-600'}`}
                  style={{ width: `${Math.min(100, Math.max(2, data.timeSummary.quotaUsagePct))}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>Consumido: {data.timeSummary.totalMinutes.toFixed(2)} min</span>
                <span>Franquia: {data.timeSummary.includedMinutes} min</span>
              </div>
            </div>
          </Card>

          <Card title="Tempo Utilizado por Agente de Voz" padded={false}>
            {!data.byAgent.length ? (
              <div className="p-6"><Empty title="Nenhuma chamada registrada neste mês para esta empresa" /></div>
            ) : (
              <TableWrap label="Consumo de tempo por agente">
                <table className="data w-full">
                  <thead>
                    <tr>
                      <th>Agente IA</th>
                      <th className="text-right">Chamadas</th>
                      <th className="text-right">Tempo Total</th>
                      <th className="text-right">Duração Média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byAgent.map((ag) => (
                      <tr key={ag.agentId}>
                        <td className="font-mono text-xs font-semibold text-slate-900">{ag.agentId}</td>
                        <td className="text-right tabular-nums text-xs">{ag.callsCount}</td>
                        <td className="text-right tabular-nums text-xs font-semibold">{fmtMmSs(ag.totalDurationSec)}</td>
                        <td className="text-right tabular-nums text-xs">{fmtMmSs(ag.avgDurationSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card
            title="Registro Cronológico de Tempo das Chamadas"
            actions={
              data.recentCallsTime.length > 0 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Download className="size-3.5" aria-hidden />}
                  onClick={handleExportClientTimeCsv}
                >
                  Exportar CSV
                </Button>
              ) : undefined
            }
            padded={false}
          >
            {!data.recentCallsTime.length ? (
              <div className="p-6"><Empty title="Sem registros de tempo no período selecionado" /></div>
            ) : (
              <TableWrap label="Registro de tempo das chamadas">
                <table className="data w-full">
                  <thead>
                    <tr>
                      <th>Data/Hora</th>
                      <th>Agente</th>
                      <th>Sentido</th>
                      <th>Origem → Destino</th>
                      <th className="text-right">Tempo de Conversação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentCallsTime.map((c) => (
                      <tr key={c.callId + c.occurredAt}>
                        <td className="text-xs whitespace-nowrap">{fmtDateTime(c.occurredAt)}</td>
                        <td><Badge tone="gray">{c.agentId}</Badge></td>
                        <td className="text-xs">
                          <Badge tone={c.direction === 'inbound' ? 'green' : 'blue'}>
                            {c.direction === 'inbound' ? 'Entrada' : 'Saída'}
                          </Badge>
                        </td>
                        <td className="font-mono text-xs">{c.caller} → {c.called}</td>
                        <td className="text-right tabular-nums text-xs font-semibold">{fmtMmSs(c.durationSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="Tráfego & Tempo PSTN"
              value={fmtMmSs(data.totals.totalDurationSec)}
              hint={`${data.totals.totalCalls} chamadas (${data.totals.totalMinutes.toFixed(1)} min) · R$ ${data.totals.pstnCostBrl.toFixed(2)}`}
            />
            <Stat
              label="Custo IA (OpenAI / 11Labs)"
              value={`US$ ${data.totals.aiCostUsd.toFixed(4)}`}
              hint={`≈ R$ ${data.totals.aiCostBrl.toFixed(2)} · ${(data.totals.aiTokensIn + data.totals.aiTokensOut).toLocaleString('pt-BR')} tokens`}
            />
            <Stat
              label="Consumíveis (WA / SMS / AMD)"
              value={`R$ ${data.totals.consumablesCostBrl.toFixed(2)}`}
              hint="Disparos omnichannel e detecção AMD"
            />
            <Stat
              label="Receita Faturável (Clientes)"
              value={`R$ ${data.totals.estimatedClientRevenueBrl.toFixed(2)}`}
              hint={`Inclui R$ ${data.totals.platformFeeBrl.toFixed(2)} mensalidade`}
              tone="good"
            />
            <Stat
              label="Margem Líquida SaaS"
              value={`R$ ${data.totals.netMarginBrl.toFixed(2)}`}
              hint={`Custo Provedor R$ ${data.totals.totalProviderCostBrl.toFixed(2)} · ${data.totals.marginPct}% margem`}
              tone={data.totals.netMarginBrl >= 0 ? 'good' : 'bad'}
            />
          </div>

          <Card title="Detalhamento por Categoria de Custo e Consumível" padded={false}>
            {!data.byCategory.length ? (
              <div className="p-6"><Empty title="Sem lançamentos no ledger mensal para este período" /></div>
            ) : (
              <TableWrap label="Custos por categoria">
                <table className="data w-full">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th className="text-right">Eventos</th>
                      <th className="text-right">Volume / Tempo</th>
                      <th className="text-right">Tokens In/Out</th>
                      <th className="text-right">Custo USD</th>
                      <th className="text-right">Custo Provedor (BRL)</th>
                      <th className="text-right">Cobrança Cliente (BRL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCategory.map((c) => (
                      <tr key={c.category}>
                        <td className="text-xs font-semibold text-slate-900">
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </td>
                        <td className="text-right tabular-nums text-xs">{c.eventsCount}</td>
                        <td className="text-right tabular-nums text-xs">
                          {c.durationSec > 0 ? fmtMmSs(c.durationSec) : `${c.units} ${c.unitLabel}`}
                        </td>
                        <td className="text-right tabular-nums text-xs">
                          {c.tokensIn + c.tokensOut > 0 ? `${c.tokensIn} / ${c.tokensOut}` : '—'}
                        </td>
                        <td className="text-right tabular-nums text-xs">
                          {c.providerCostUsd > 0 ? `US$ ${c.providerCostUsd.toFixed(4)}` : '—'}
                        </td>
                        <td className="text-right tabular-nums text-xs">R$ {c.providerCostBrl.toFixed(2)}</td>
                        <td className="text-right tabular-nums text-xs font-semibold text-emerald-700">
                          R$ {c.clientChargeBrl.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Billing & Tarifação por Empresa (Tenant)" padded={false}>
            <TableWrap label="Billing por tenant">
              <table className="data w-full">
                <thead>
                  <tr>
                    <th>Empresa / Plano</th>
                    <th className="text-right">Tempo / Franquia</th>
                    <th className="text-right">PSTN (BRL)</th>
                    <th className="text-right">IA (USD / BRL)</th>
                    <th className="text-right">Consumíveis</th>
                    <th className="text-right">Custo Total</th>
                    <th className="text-right">Faturável</th>
                    <th className="text-right">Margem</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byTenant.map((t) => (
                    <tr key={t.workspaceId}>
                      <td>
                        <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900">
                          <span>{t.workspaceName}</span>
                          {t.isMaster && <Badge tone="brand">Master</Badge>}
                        </div>
                        <div className="text-[11px] text-slate-500">{t.planName}</div>
                      </td>
                      <td className="text-right tabular-nums text-xs">
                        <div className="font-medium">{t.totalMinutes.toFixed(1)} / {t.monthlyIncludedMinutes} min</div>
                        <div className="text-[11px] text-slate-500">{t.callsCount} chamadas ({t.quotaUsagePct}%)</div>
                      </td>
                      <td className="text-right tabular-nums text-xs">R$ {t.pstnCostBrl.toFixed(2)}</td>
                      <td className="text-right tabular-nums text-xs">
                        <div>US$ {t.aiCostUsd.toFixed(4)}</div>
                        <div className="text-[11px] text-slate-500">R$ {t.aiCostBrl.toFixed(2)}</div>
                      </td>
                      <td className="text-right tabular-nums text-xs">R$ {t.consumablesCostBrl.toFixed(2)}</td>
                      <td className="text-right tabular-nums text-xs font-medium">R$ {t.totalProviderCostBrl.toFixed(2)}</td>
                      <td className="text-right tabular-nums text-xs font-semibold text-emerald-700">
                        R$ {t.estimatedClientRevenueBrl.toFixed(2)}
                      </td>
                      <td className="text-right tabular-nums text-xs font-semibold">
                        R$ {t.netMarginBrl.toFixed(2)}
                      </td>
                      <td className="text-right">
                        {canEditPlans && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Edit className="size-3.5" aria-hidden />}
                            onClick={() =>
                              setEditingPlan({
                                workspaceId: t.workspaceId,
                                workspaceName: t.workspaceName,
                                plan: { ...t.plan },
                              })
                            }
                          >
                            Tarifas
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <Card
            title="Extrato Unificado de Consumo (Ledger Particionado)"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Últimos {data.ledger.length} lançamentos</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!data.ledger.length}
                  icon={<Download className="size-3.5" aria-hidden />}
                  onClick={handleExportLedgerCsv}
                >
                  Exportar CSV
                </Button>
              </div>
            }
            padded={false}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-slate-50/70 px-4 py-3">
              <Filter className="size-3.5 text-slate-500 shrink-0" />
              <Select
                className="h-8 w-44 text-xs"
                value={filterWorkspaceId}
                onChange={(e) => setFilterWorkspaceId(e.target.value)}
                aria-label="Filtrar por empresa"
              >
                <option value="ALL">Todas as empresas</option>
                {workspaceOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <Select
                className="h-8 w-44 text-xs"
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                aria-label="Filtrar por categoria"
              >
                <option value="ALL">Todas as categorias</option>
                {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                className="h-8 w-40 text-xs"
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value)}
                aria-label="Filtrar por provedor"
              >
                <option value="ALL">Todos provedores</option>
                <option value="voice-app">voice-app</option>
                <option value="openai">openai</option>
                <option value="elevenlabs">elevenlabs</option>
                <option value="meta">meta</option>
                <option value="sms">sms</option>
                <option value="email">email</option>
                <option value="whisper">whisper</option>
              </Select>
              <Input
                className="h-8 w-52 text-xs"
                placeholder="Buscar Call ID ou sourceRef..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                aria-label="Buscar referência"
              />
            </div>
            {!data.ledger.length ? (
              <div className="p-6"><Empty title="Sem lançamentos no extrato mensal" /></div>
            ) : (
              <TableWrap label="Ledger particionado">
                <table className="data w-full">
                  <thead>
                    <tr>
                      <th>Data/Hora</th>
                      <th>Empresa</th>
                      <th>Categoria / Origem</th>
                      <th className="text-right">Tempo / Unid.</th>
                      <th className="text-right">Tokens</th>
                      <th className="text-right">Custo (USD/BRL)</th>
                      <th className="text-right">Cliente (BRL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((l) => (
                      <tr key={l.id}>
                        <td className="text-xs whitespace-nowrap">{fmtDateTime(l.occurredAt)}</td>
                        <td className="text-xs font-medium">{l.workspaceName}</td>
                        <td className="text-xs">
                          <div className="font-medium">{CATEGORY_LABEL[l.category] ?? l.category}</div>
                          <div className="font-mono text-[10px] text-slate-400 flex items-center gap-1.5">
                            <span>{l.provider} · {l.sourceRef}</span>
                            {l.category === 'TELEPHONY_PSTN' && l.sourceRef && (
                              <Link
                                to="/"
                                className="text-brand-700 hover:underline font-sans"
                              >
                                Ver chamadas
                              </Link>
                            )}
                          </div>
                        </td>
                        <td className="text-right tabular-nums text-xs">
                          {l.durationSec > 0 ? fmtMmSs(l.durationSec) : `${l.units} ${l.unitLabel}`}
                        </td>
                        <td className="text-right tabular-nums text-xs">
                          {l.tokensIn + l.tokensOut > 0 ? `${l.tokensIn}/${l.tokensOut}` : '—'}
                        </td>
                        <td className="text-right tabular-nums text-xs">
                          {l.providerCostUsd > 0 ? `US$ ${l.providerCostUsd.toFixed(4)} · ` : ''}
                          R$ {l.providerCostBrl.toFixed(3)}
                        </td>
                        <td className="text-right tabular-nums text-xs font-semibold">R$ {l.clientChargeBrl.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Modal
            open={!!editingPlan}
            onOpenChange={(o) => !o && setEditingPlan(null)}
            title={`Plano e Tarifas · ${editingPlan?.workspaceName ?? ''}`}
            wide
            footer={
              <>
                <Button variant="secondary" onClick={() => setEditingPlan(null)}>Cancelar</Button>
                <Button
                  variant="primary"
                  loading={savePlanM.isPending}
                  onClick={() => editingPlan && savePlanM.mutate({ workspaceId: editingPlan.workspaceId, plan: editingPlan.plan })}
                >
                  Salvar Tarifação
                </Button>
              </>
            }
          >
            {editingPlan && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Nome do Plano">
                    {(f) => (
                      <Input
                        id={f.id}
                        value={editingPlan.plan.planName}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, planName: e.target.value } })}
                      />
                    )}
                  </Field>
                  <Field label="Franquia (minutos/mês)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        value={editingPlan.plan.monthlyIncludedMinutes}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, monthlyIncludedMinutes: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                  <Field label="Mensalidade Fixa (R$)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.01"
                        value={editingPlan.plan.monthlyPlatformFeeBrl}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, monthlyPlatformFeeBrl: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Custo PSTN (R$/min)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.001"
                        value={editingPlan.plan.voiceRatePerMinBrl}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, voiceRatePerMinBrl: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                  <Field label="Venda PSTN (R$/min)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.001"
                        value={editingPlan.plan.voiceRateClientPerMinBrl}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, voiceRateClientPerMinBrl: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                  <Field label="Markup IA (ex: 1.8x)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.1"
                        value={editingPlan.plan.aiMarkupMultiplier}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, aiMarkupMultiplier: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                  <Field label="Cotação USD → BRL">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.01"
                        value={editingPlan.plan.usdToBrlRate}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, usdToBrlRate: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="WhatsApp (R$/un)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.001"
                        value={editingPlan.plan.whatsappUnitBrl}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, whatsappUnitBrl: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                  <Field label="SMS (R$/un)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.001"
                        value={editingPlan.plan.smsUnitBrl}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, smsUnitBrl: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                  <Field label="E-mail (R$/un)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.0001"
                        value={editingPlan.plan.emailUnitBrl}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, emailUnitBrl: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                  <Field label="AMD / DSP (R$/un)">
                    {(f) => (
                      <Input
                        id={f.id}
                        type="number"
                        step="0.001"
                        value={editingPlan.plan.amdUnitBrl}
                        onChange={(e) => setEditingPlan({ ...editingPlan, plan: { ...editingPlan.plan, amdUnitBrl: Number(e.target.value) } })}
                      />
                    )}
                  </Field>
                </div>
              </div>
            )}
          </Modal>
        </>
      )}
    </div>
  );
}

export { Clock, DollarSign, PhoneCall, Sparkles, Timer };

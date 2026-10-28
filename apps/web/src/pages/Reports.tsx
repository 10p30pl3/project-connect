import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import clsx from 'clsx';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Filter,
  Layers,
  Phone,
  PhoneCall,
  PieChart,
  Repeat,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { get } from '../lib/api';
import { fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import { Alert, Badge, Button, Card, Empty, ErrorState, Field, InfoTooltip, Loading, PageHeader, Select, TableWrap } from '../components/ui';

type ReportTab = 'penetration' | 'connectFunnel' | 'retryEffectiveness' | 'bestTime' | 'dispositions';

interface ReportData {
  filters: {
    campaignId: string | null;
    channel: string | null;
    period: string;
  };
  reports: {
    penetration: {
      totalRecords: number;
      workedRecords: number;
      availableRecords: number;
      inRetryRecords: number;
      completedSuccess: number;
      exhaustedMaxAttempts: number;
      dncExcluded: number;
      penetrationRate: number;
      exhaustionRate: number;
      churnRate: number;
    };
    connectFunnel: {
      totalAttempts: number;
      connectCount: number;
      connectRate: number;
      humanAnswerCount: number;
      humanAnswerRate: number;
      amdCount: number;
      amdRate: number;
      busyCount: number;
      busyRate: number;
      rpcCount: number;
      rpcRate: number;
      rpcOverHumanRate: number;
      conversionCount: number;
      conversionOverTotalRate: number;
      conversionOverRpcRate: number;
      byChannel: Array<{
        channel: string;
        label: string;
        attempts: number;
        connectRate: number;
        humanAnswerRate: number;
        amdRate: number;
        cpcRate: number;
        conversionRate: number;
        avgDurationSec: number;
      }>;
    };
    retryEffectiveness: {
      steps: Array<{
        step: number;
        attempts: number;
        cpc: number;
        cpcRate: number;
        conversions: number;
        convRate: number;
        costPerCpc: number;
        cumulativeConvPct: number;
      }>;
      optimalCutoffStep: number;
      analysis: string;
    };
    bestTime: {
      hours: string[];
      weekdays: Array<{
        day: string;
        short: string;
        cpcHourly: number[];
      }>;
      peakWindowWeekdays: string;
      peakWindowSaturday: string;
      worstWindow: string;
    };
    dispositions: {
      items: Array<{
        code: string;
        name: string;
        category: string;
        count: number;
        pct: number;
        isConversion: boolean;
        isCpc: boolean;
      }>;
      total: number;
      positivePct: number;
      cpcPct: number;
      invalidDataPct: number;
      optOutPct: number;
    };
  };
}

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('penetration');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('30d');

  // Campanhas para o seletor de filtro
  const campaignsQuery = useQuery({
    queryKey: ['campaigns-list'],
    queryFn: () => get<{ items: Array<{ id: string; name: string }> }>('/campaigns'),
  });

  // Dados consolidados do relatório
  const reportQuery = useQuery({
    queryKey: ['reports-summary', selectedCampaign, selectedChannel, selectedPeriod],
    queryFn: () =>
      get<ReportData>(
        `/reports/summary?campaignId=${selectedCampaign}&channel=${selectedChannel}&period=${selectedPeriod}`,
      ),
  });

  const handleExportCsv = () => {
    if (!reportQuery.data) return;
    const r = reportQuery.data.reports;
    let csvContent = 'data:text/csv;charset=utf-8,';

    if (activeTab === 'penetration') {
      csvContent += 'Métrica,Valor,Percentual\n';
      csvContent += `Base Total Carregada,${r.penetration.totalRecords},100%\n`;
      csvContent += `Base Trabalhada,${r.penetration.workedRecords},${r.penetration.penetrationRate}%\n`;
      csvContent += `Saldo Virgem Disponível,${r.penetration.availableRecords},${(100 - r.penetration.penetrationRate).toFixed(1)}%\n`;
      csvContent += `Concluído com Sucesso,${r.penetration.completedSuccess},${((r.penetration.completedSuccess / r.penetration.totalRecords) * 100).toFixed(1)}%\n`;
      csvContent += `Esgotado por Limite de Tentativas,${r.penetration.exhaustedMaxAttempts},${((r.penetration.exhaustedMaxAttempts / r.penetration.totalRecords) * 100).toFixed(1)}%\n`;
      csvContent += `Bloqueados por DNC / Opt-Out,${r.penetration.dncExcluded},${r.penetration.churnRate}%\n`;
    } else if (activeTab === 'connectFunnel') {
      csvContent += 'Canal,Discadas,Taxa Conexão,Atendimento Humano,Taxa AMD,Taxa CPC,Taxa Conversão\n';
      r.connectFunnel.byChannel.forEach((c) => {
        csvContent += `${c.label},${c.attempts},${c.connectRate}%,${c.humanAnswerRate}%,${c.amdRate}%,${c.cpcRate}%,${c.conversionRate}%\n`;
      });
    } else if (activeTab === 'retryEffectiveness') {
      csvContent += 'Tentativa,Volume Discado,CPCs,Taxa CPC,Conversões,Taxa Conv,Custo/CPC,Conversão Acumulada\n';
      r.retryEffectiveness.steps.forEach((s) => {
        csvContent += `${s.step}ª tentativa,${s.attempts},${s.cpc},${s.cpcRate}%,${s.conversions},${s.convRate}%,R$ ${s.costPerCpc.toFixed(2)},${s.cumulativeConvPct}%\n`;
      });
    } else if (activeTab === 'dispositions') {
      csvContent += 'Código,Descrição,Categoria,Volume,Percentual,É CPC,É Conversão\n';
      r.dispositions.items.forEach((d) => {
        csvContent += `${d.code},${d.name},${d.category},${d.count},${d.pct}%,${d.isCpc ? 'SIM' : 'NÃO'},${d.isConversion ? 'SIM' : 'NÃO'}\n`;
      });
    } else {
      csvContent += 'Dia,08h,09h,10h,11h,12h,13h,14h,15h,16h,17h,18h,19h\n';
      r.bestTime.weekdays.forEach((w) => {
        csvContent += `${w.day},${w.cpcHourly.join(',')}\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `relatorio_${activeTab}_voll_connect.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabs: Array<{ id: ReportTab; title: string; subtitle: string; tooltip: string; icon: any }> = [
    {
      id: 'penetration',
      title: '1. Penetração & Esgotamento',
      subtitle: 'Ciclo de vida e saldo disponível da base',
      tooltip: 'Acompanha o volume de contatos virgens, em retentativa, esgotados por limite e concluídos.',
      icon: Database,
    },
    {
      id: 'connectFunnel',
      title: '2. Eficiência de Discagem',
      subtitle: 'Discadas, atendidas, alô e CPC',
      tooltip: 'Funil técnico de telecom e conversão operacional: Discadas → Atendidas → Alô / AMD → CPC → Conversão.',
      icon: PhoneCall,
    },
    {
      id: 'retryEffectiveness',
      title: '3. Retentativas & Rendimento',
      subtitle: 'Rendimento incremental e corte ótimo',
      tooltip: 'Determina a taxa de conversão em cada tentativa e o limite ótimo de insistência para evitar custo desnecessário.',
      icon: Repeat,
    },
    {
      id: 'bestTime',
      title: '4. Curva Horária & Calor',
      subtitle: 'Taxa de CPC por faixa e dia',
      tooltip: 'Cruza o histórico de atendimentos hora a hora para orientar o dimensionamento das janelas operacionais.',
      icon: Clock,
    },
    {
      id: 'dispositions',
      title: '5. Sintético de Tabulações',
      subtitle: 'Desfechos e higienização cadastral',
      tooltip: 'Auditoria de tabulações operacionais: produtivas (acordos), improdutivas (não atende), cadastrais (número inválido) e DNC.',
      icon: PieChart,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Relatórios & Inteligência Operacional"
        tooltip="Conjunto dos 5 relatórios analíticos fundamentais para governança de mailing, discador, mensageria e conversão de negócios."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="size-3.5" />}
              onClick={handleExportCsv}
              disabled={!reportQuery.data}
            >
              Exportar CSV
            </Button>
          </div>
        }
      />

      {/* Barra de Filtros Globais */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <Filter className="size-3.5 text-brand-600" />
            <span>Filtros Operacionais:</span>
            <InfoTooltip content="Filtre os dados consolidados por campanha específica, canal de comunicação e janela temporal." />
          </div>

          <div className="w-56">
            <Select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="text-xs py-1 h-8"
            >
              <option value="all">Todas as campanhas</option>
              {campaignsQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-40">
            <Select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="text-xs py-1 h-8"
            >
              <option value="all">Todos os canais</option>
              <option value="VOICE">Discador (Voz)</option>
              <option value="WHATSAPP">WhatsApp Oficial</option>
              <option value="SMS">SMS / RCS</option>
              <option value="EMAIL">E-mail</option>
            </Select>
          </div>

          <div className="w-36">
            <Select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="text-xs py-1 h-8"
            >
              <option value="today">Hoje (D-0)</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex size-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Telemetria em tempo real</span>
          <InfoTooltip content="Métricas atualizadas automaticamente com base nas tentativas e retornos dos conectores de telecom e mensageria." />
        </div>
      </div>

      {/* Navegação entre os 5 Principais Relatórios com Tooltips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={clsx(
                'group flex flex-col p-3 rounded-2xl border text-left transition cursor-pointer relative',
                isActive
                  ? 'border-brand-500 bg-brand-50/50 shadow-xs ring-1 ring-brand-500'
                  : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/70',
              )}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={clsx(
                      'p-1.5 rounded-lg transition shrink-0',
                      isActive ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200',
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <span
                    className={clsx(
                      'text-xs font-bold truncate',
                      isActive ? 'text-brand-900' : 'text-slate-800',
                    )}
                  >
                    {t.title}
                  </span>
                </div>
                <InfoTooltip content={t.tooltip} className="shrink-0" />
              </div>
              <span className="text-[10px] text-slate-500 line-clamp-1">
                {t.subtitle}
              </span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo Dinâmico do Relatório Selecionado */}
      {reportQuery.isLoading ? (
        <Loading />
      ) : reportQuery.error ? (
        <ErrorState error={reportQuery.error} onRetry={() => reportQuery.refetch()} />
      ) : !reportQuery.data?.reports ? (
        <Empty title="Nenhum dado encontrado para o período selecionado." />
      ) : (
        <div className="space-y-5">
          {activeTab === 'penetration' && (
            <PenetrationReport report={reportQuery.data.reports.penetration} />
          )}

          {activeTab === 'connectFunnel' && (
            <ConnectFunnelReport report={reportQuery.data.reports.connectFunnel} />
          )}

          {activeTab === 'retryEffectiveness' && (
            <RetryEffectivenessReport report={reportQuery.data.reports.retryEffectiveness} />
          )}

          {activeTab === 'bestTime' && (
            <BestTimeReport report={reportQuery.data.reports.bestTime} />
          )}

          {activeTab === 'dispositions' && (
            <DispositionsReport report={reportQuery.data.reports.dispositions} />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 1. RELATÓRIO DE PENETRAÇÃO & ESGOTAMENTO DO MAILING
// ============================================================================
function PenetrationReport({
  report,
}: {
  report: ReportData['reports']['penetration'];
}) {
  return (
    <div className="space-y-4">
      {/* Cabeçalho Limpo com Tooltip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Penetração e Esgotamento do Mailing
            </h3>
            <InfoTooltip content="Acompanha a velocidade de consumo da base de contatos pelo motor de discagem. Mostra o saldo de contatos virgens na fila, registros em ciclo de retentativa, contatos esgotados por limite e concluídos." />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Visão consolidada do inventário: base trabalhada, saldo disponível na fila e taxas de esgotamento operacional.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 text-right">
            <div className="text-xs font-medium text-slate-500 flex items-center justify-end gap-1">
              <span>Taxa de Penetração</span>
              <InfoTooltip content="Percentual de contatos do mailing que já receberam ao menos uma tentativa de discagem ou envio." />
            </div>
            <div className="text-xl font-black text-brand-700">{report.penetrationRate}%</div>
          </div>
        </div>
      </div>

      {/* Grid de KPIs Principais com Tooltips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Base Total Carregada</span>
            <InfoTooltip content="Volume total de contatos importados no mailing para acionamento na campanha." />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{fmtNumber(report.totalRecords)}</div>
          <div className="text-[11px] text-slate-400 mt-1">100% dos registros do mailing</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Base Trabalhada</span>
            <InfoTooltip content="Contatos que já receberam pelo menos uma tentativa de acionamento pelo motor." />
          </div>
          <div className="text-xl font-bold text-brand-700 mt-1">{fmtNumber(report.workedRecords)}</div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">
            {report.penetrationRate}% penetração da base
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Saldo Virgem Disponível</span>
            <InfoTooltip content="Contatos na fila que ainda não receberam nenhuma chamada ou mensagem e estão disponíveis para discagem imediata." />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{fmtNumber(report.availableRecords)}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {(((report.availableRecords / report.totalRecords) * 100) || 0).toFixed(1)}% aguardando 1ª discada
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Taxa de Esgotamento</span>
            <InfoTooltip content="Percentual da base cujo ciclo foi encerrado (concluídos com sucesso ou que atingiram o teto máximo de tentativas da estratégia)." />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{report.exhaustionRate}%</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Sucesso ({fmtNumber(report.completedSuccess)}) + Teto ({fmtNumber(report.exhaustedMaxAttempts)})
          </div>
        </div>
      </div>

      {/* Barra de Progresso do Funil da Base */}
      <Card title="Composição do Inventário do Mailing">
        <div className="space-y-3">
          <div className="h-6 w-full rounded-xl bg-slate-100 flex overflow-hidden p-0.5 border border-slate-200">
            <div
              style={{ width: `${(report.completedSuccess / report.totalRecords) * 100}%` }}
              className="bg-emerald-500 rounded-l-lg transition-all"
              title={`Sucesso: ${report.completedSuccess}`}
            />
            <div
              style={{ width: `${(report.exhaustedMaxAttempts / report.totalRecords) * 100}%` }}
              className="bg-amber-500 transition-all"
              title={`Esgotados por Limite: ${report.exhaustedMaxAttempts}`}
            />
            <div
              style={{ width: `${(report.inRetryRecords / report.totalRecords) * 100}%` }}
              className="bg-brand-500 transition-all"
              title={`Em Ciclo de Retentativa: ${report.inRetryRecords}`}
            />
            <div
              style={{ width: `${(report.availableRecords / report.totalRecords) * 100}%` }}
              className="bg-slate-300 transition-all"
              title={`Disponível Virgem: ${report.availableRecords}`}
            />
            <div
              style={{ width: `${(report.dncExcluded / report.totalRecords) * 100}%` }}
              className="bg-rose-500 rounded-r-lg transition-all"
              title={`Opt-Out / DNC: ${report.dncExcluded}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-emerald-500" />
              <span className="text-slate-600">Concluído Sucesso ({fmtNumber(report.completedSuccess)})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-amber-500" />
              <span className="text-slate-600">Esgotado por Teto ({fmtNumber(report.exhaustedMaxAttempts)})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-brand-500" />
              <span className="text-slate-600">Em Retentativa ({fmtNumber(report.inRetryRecords)})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-slate-300" />
              <span className="text-slate-600">Saldo Virgem ({fmtNumber(report.availableRecords)})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-rose-500" />
              <span className="text-slate-600">DNC / Bloqueio ({fmtNumber(report.dncExcluded)})</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabela de Detalhamento de Status do Mailing */}
      <Card title="Inventário & Estágios de Processamento da Lista" padded={false}>
        <TableWrap label="Status do Mailing">
          <table className="data">
            <thead>
              <tr>
                <th>Estado Operacional no Motor</th>
                <th>Classificação</th>
                <th>Volume de Registros</th>
                <th>% sobre o Mailing</th>
                <th>Ação Recomendada</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold text-slate-800">Concluídos com Sucesso</td>
                <td><Badge tone="green">Concluído Positivo</Badge></td>
                <td>{fmtNumber(report.completedSuccess)}</td>
                <td>{(((report.completedSuccess / report.totalRecords) * 100) || 0).toFixed(1)}%</td>
                <td className="text-slate-500">Encerrado, removido do ciclo de discagem</td>
              </tr>
              <tr>
                <td className="font-semibold text-slate-800">Em Ciclo de Retentativa</td>
                <td><Badge tone="brand">Em Andamento / Agendado</Badge></td>
                <td>{fmtNumber(report.inRetryRecords)}</td>
                <td>{(((report.inRetryRecords / report.totalRecords) * 100) || 0).toFixed(1)}%</td>
                <td className="text-slate-500">Aguardando janela de intervalo da estratégia</td>
              </tr>
              <tr>
                <td className="font-semibold text-slate-800">Disponíveis Virgens (Sem Tentativa)</td>
                <td><Badge tone="gray">Pronto para Início</Badge></td>
                <td>{fmtNumber(report.availableRecords)}</td>
                <td>{(((report.availableRecords / report.totalRecords) * 100) || 0).toFixed(1)}%</td>
                <td className="text-slate-500">Alimentar lotes do discador e mensageria</td>
              </tr>
              <tr>
                <td className="font-semibold text-slate-800">Esgotados por Limite de Esforço</td>
                <td><Badge tone="amber">Teto de Tentativas</Badge></td>
                <td>{fmtNumber(report.exhaustedMaxAttempts)}</td>
                <td>{(((report.exhaustedMaxAttempts / report.totalRecords) * 100) || 0).toFixed(1)}%</td>
                <td className="text-slate-500">Atingiu limite máximo; avaliar reciclagem futura</td>
              </tr>
              <tr>
                <td className="font-semibold text-slate-800">Expurgados por Opt-Out / DNC</td>
                <td><Badge tone="red">Bloqueio Permanente</Badge></td>
                <td>{fmtNumber(report.dncExcluded)}</td>
                <td>{report.churnRate}%</td>
                <td className="text-slate-500">Bloqueio mandatório em conformidade regulatória</td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

// ============================================================================
// 2. RELATÓRIO DE EFICIÊNCIA DE DISCAGEM & FUNIL DE CONTATO
// ============================================================================
function ConnectFunnelReport({
  report,
}: {
  report: ReportData['reports']['connectFunnel'];
}) {
  return (
    <div className="space-y-4">
      {/* Cabeçalho Limpo com Tooltip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Eficiência de Discagem e Funil de Contato
            </h3>
            <InfoTooltip content="Mede o funil técnico de telecomunicações e conversão: Discadas → Atendidas (ASR) → Filtro de Caixa Postal (AMD) → Atendimento Humano (Alô) → Contato com a Pessoa Certa (CPC) → Conversão." />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Acompanhamento técnico de completamento de chamadas, detecção de voz humana e efetividade de CPC.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 text-right">
            <div className="text-xs font-medium text-slate-500 flex items-center justify-end gap-1">
              <span>Hit Rate (CPC / Discadas)</span>
              <InfoTooltip content="Percentual de contatos com a pessoa certa (CPC) confirmados em relação ao total de tentativas discadas." />
            </div>
            <div className="text-xl font-black text-brand-700">{report.rpcRate}%</div>
          </div>
        </div>
      </div>

      {/* Grid de Indicadores do Funil com Tooltips */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Discadas (Tentativas)</span>
            <InfoTooltip content="Total bruto de tentativas geradas pelo discador telefônico e disparadores digitais." />
          </div>
          <div className="text-lg font-bold text-slate-900 mt-1">{fmtNumber(report.totalAttempts)}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">100% dos disparos</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Atendidas (ASR)</span>
            <InfoTooltip content="Chamadas completadas pela rede das operadoras que geraram sinal de atendimento." />
          </div>
          <div className="text-lg font-bold text-slate-900 mt-1">{fmtNumber(report.connectCount)}</div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">{report.connectRate}% completamento</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Atendimento Humano</span>
            <InfoTooltip content="Chamadas com detecção de voz humana (Alô), após o filtro de secretária eletrônica (AMD)." />
          </div>
          <div className="text-lg font-bold text-slate-900 mt-1">{fmtNumber(report.humanAnswerCount)}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{report.humanAnswerRate}% das discadas</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">CPC (Pessoa Certa)</span>
            <InfoTooltip content="Contato confirmado diretamente com o titular pretendido ou tomador de decisão." />
          </div>
          <div className="text-lg font-bold text-brand-700 mt-1">{fmtNumber(report.rpcCount)}</div>
          <div className="text-[11px] text-brand-600 font-semibold mt-0.5">{report.rpcOverHumanRate}% sobre humanos</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Conversão Final</span>
            <InfoTooltip content="Acordos fechados, promessas de pagamento ou vendas concluídas com sucesso." />
          </div>
          <div className="text-lg font-bold text-emerald-700 mt-1">{fmtNumber(report.conversionCount)}</div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">{report.conversionOverRpcRate}% sobre CPC</div>
        </div>
      </div>

      {/* Visualização em Degraus do Funil de Contato */}
      <Card title="Funil de Desfecho Técnico e Operacional">
        <div className="space-y-3 py-2">
          {[
            { label: '1. Discadas (Tentativas)', val: report.totalAttempts, pct: 100, color: 'bg-slate-700', sub: 'Disparos de voz e mensagens' },
            { label: '2. Atendidas (Completamento ASR)', val: report.connectCount, pct: report.connectRate, color: 'bg-blue-600', sub: `${report.connectRate}% da base inicial` },
            { label: '3. Atendimento Humano (Alô)', val: report.humanAnswerCount, pct: report.humanAnswerRate, color: 'bg-indigo-600', sub: `${report.humanAnswerRate}% (expurgou ${report.amdRate}% de caixas postais AMD)` },
            { label: '4. Contato com a Pessoa Certa (CPC)', val: report.rpcCount, pct: report.rpcRate, color: 'bg-brand-600', sub: `${report.rpcRate}% de Hit Rate total (${report.rpcOverHumanRate}% do alô humano)` },
            { label: '5. Conversão de Negócio (Acordo/Venda)', val: report.conversionCount, pct: report.conversionOverTotalRate, color: 'bg-emerald-600', sub: `${report.conversionOverRpcRate}% de aproveitamento do CPC` },
          ].map((step, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">{step.label}</span>
                <span className="font-mono text-slate-600">
                  {fmtNumber(step.val)} ({step.pct}%) · <span className="text-slate-400">{step.sub}</span>
                </span>
              </div>
              <div className="h-4 w-full rounded-md bg-slate-100 overflow-hidden border border-slate-200/60">
                <div
                  style={{ width: `${step.pct}%` }}
                  className={clsx('h-full transition-all duration-500 rounded-sm', step.color)}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Comparativo de Desempenho por Canal */}
      <Card title="Eficiência e Detecção por Canal (Voz, WhatsApp, SMS e E-mail)" padded={false}>
        <TableWrap label="Comparativo de Canais">
          <table className="data">
            <thead>
              <tr>
                <th>Canal Operacional</th>
                <th>Discadas</th>
                <th>Taxa Conexão</th>
                <th>Atendimento Humano</th>
                <th>Caixa Postal (AMD)</th>
                <th>Taxa de CPC</th>
                <th>Taxa Conversão</th>
              </tr>
            </thead>
            <tbody>
              {report.byChannel.map((c) => (
                <tr key={c.channel}>
                  <td className="font-semibold text-slate-900">{c.label}</td>
                  <td>{fmtNumber(c.attempts)}</td>
                  <td>
                    <span className="font-semibold text-slate-800">{c.connectRate}%</span>
                  </td>
                  <td>{c.humanAnswerRate}%</td>
                  <td>{c.amdRate > 0 ? `${c.amdRate}%` : '— (Digital)'}</td>
                  <td>
                    <Badge tone={c.cpcRate >= 40 ? 'green' : c.cpcRate >= 25 ? 'brand' : 'gray'}>
                      {c.cpcRate}%
                    </Badge>
                  </td>
                  <td>
                    <span className="font-bold text-emerald-700">{c.conversionRate}%</span>
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

// ============================================================================
// 3. RELATÓRIO DE EFICÁCIA DE RETENTATIVAS & RENDIMENTO
// ============================================================================
function RetryEffectivenessReport({
  report,
}: {
  report: ReportData['reports']['retryEffectiveness'];
}) {
  return (
    <div className="space-y-4">
      {/* Cabeçalho Limpo com Tooltip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Eficácia de Retentativas e Ponto de Rendimento
            </h3>
            <InfoTooltip content="Avalia a conversão obtida a cada nova tentativa (1ª até a Nª discada), calculando o ponto de corte ótimo onde novas insistências geram custo telefônico sem aumento proporcional de conversão." />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Curva de rendimento incremental por tentativa e ponto de corte ótimo sugerido para calibrar a estratégia.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 text-right">
            <div className="text-xs font-medium text-slate-500 flex items-center justify-end gap-1">
              <span>Ponto de Corte Ótimo</span>
              <InfoTooltip content="Teto de tentativas recomendado a partir do qual a conversão marginal cai abaixo de 3% e o custo por CPC triplica." />
            </div>
            <div className="text-xl font-black text-amber-600">Até {report.optimalCutoffStep}ª tent.</div>
          </div>
        </div>
      </div>

      {/* Alerta Consultivo do Ponto de Corte */}
      <Alert tone="warn">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-amber-600" />
          <span className="text-xs font-semibold text-amber-900">
            {report.analysis}
          </span>
        </div>
      </Alert>

      {/* Tabela de Rendimento por Tentativa */}
      <Card title="Rendimento por Número de Tentativa" padded={false}>
        <TableWrap label="Tentativas">
          <table className="data">
            <thead>
              <tr>
                <th>Tentativa</th>
                <th>Volume Discado</th>
                <th>CPCs Obtidos</th>
                <th>Taxa CPC</th>
                <th>Conversões</th>
                <th>Taxa Conv. Incremental</th>
                <th>Custo Médio / CPC</th>
                <th>% Acumulado Conversões</th>
                <th>Classificação de Eficiência</th>
              </tr>
            </thead>
            <tbody>
              {report.steps.map((s) => {
                const isPastCutoff = s.step > report.optimalCutoffStep;
                return (
                  <tr key={s.step} className={clsx(isPastCutoff && 'bg-amber-50/40')}>
                    <td className="font-bold text-slate-900">{s.step}ª Tentativa</td>
                    <td>{fmtNumber(s.attempts)}</td>
                    <td>{fmtNumber(s.cpc)}</td>
                    <td>
                      <span className="font-semibold text-slate-800">{s.cpcRate}%</span>
                    </td>
                    <td className="font-bold text-emerald-700">{fmtNumber(s.conversions)}</td>
                    <td>{s.convRate}%</td>
                    <td className="font-mono text-slate-700">R$ {s.costPerCpc.toFixed(2)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 rounded bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${s.cumulativeConvPct}%` }}
                            className="h-full bg-emerald-500 rounded"
                          />
                        </div>
                        <span className="text-xs font-semibold">{s.cumulativeConvPct}%</span>
                      </div>
                    </td>
                    <td>
                      {s.step === 1 ? (
                        <Badge tone="green">Máxima Eficiência</Badge>
                      ) : s.step <= 4 ? (
                        <Badge tone="brand">Alto Retorno</Badge>
                      ) : s.step === report.optimalCutoffStep ? (
                        <Badge tone="amber">Ponto de Corte</Badge>
                      ) : (
                        <Badge tone="red">Retorno Decrescente</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

// ============================================================================
// 4. RELATÓRIO DE MAPA DE CALOR & MELHOR HORÁRIO
// ============================================================================
function BestTimeReport({
  report,
}: {
  report: ReportData['reports']['bestTime'];
}) {
  const getCellTone = (val: number) => {
    if (val >= 45) return 'bg-emerald-600 text-white font-bold';
    if (val >= 35) return 'bg-emerald-500 text-white font-semibold';
    if (val >= 25) return 'bg-emerald-200 text-emerald-950 font-medium';
    if (val >= 15) return 'bg-amber-100 text-amber-900';
    if (val > 0) return 'bg-slate-100 text-slate-500';
    return 'bg-slate-50 text-slate-300';
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho Limpo com Tooltip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Curva Horária e Mapa de Calor (Melhor Horário de Contato)
            </h3>
            <InfoTooltip content="Cruza o histórico de atendimentos e CPCs hora a hora ao longo dos dias da semana para identificar janelas de alta receptividade do público e calibrar as réguas da estratégia." />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Distribuição da taxa de contato efetivo (CPC) por bloco horário e dia da semana.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 text-right">
            <div className="text-xs font-medium text-slate-500 flex items-center justify-end gap-1">
              <span>Janela de Pico</span>
              <InfoTooltip content="Períodos semanais com maior taxa de atendimento humano e fechamento de acordos." />
            </div>
            <div className="text-sm font-bold text-emerald-700">Ter–Qui · 10h–12h / 16h–18h</div>
          </div>
        </div>
      </div>

      {/* Recomendações Operacionais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span>Pico Dias de Semana</span>
            </div>
            <InfoTooltip content="Melhor faixa horária para acionamento por discador de voz em dias úteis." />
          </div>
          <div className="text-sm font-semibold text-emerald-950 mt-1">
            {report.peakWindowWeekdays}
          </div>
          <div className="text-[11px] text-emerald-700 mt-1">
            Taxa de CPC média de 48% a 53%
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
              <Clock className="size-4 text-blue-600" />
              <span>Pico Sábados</span>
            </div>
            <InfoTooltip content="Janela permitida de fim de semana com maior propensão de contato." />
          </div>
          <div className="text-sm font-semibold text-blue-950 mt-1">
            {report.peakWindowSaturday}
          </div>
          <div className="text-[11px] text-blue-700 mt-1">
            Concentrar acionamento no período matutino
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-rose-900">
              <TrendingDown className="size-4 text-rose-600" />
              <span>Janela Improdutiva</span>
            </div>
            <InfoTooltip content="Horários com alta incidência de chamadas não atendidas e caixas postais." />
          </div>
          <div className="text-sm font-semibold text-rose-950 mt-1">
            {report.worstWindow}
          </div>
          <div className="text-[11px] text-rose-700 mt-1">
            Evitar discador agressivo; priorizar canais assíncronos (WhatsApp)
          </div>
        </div>
      </div>

      {/* Matriz de Calor */}
      <Card title="Matriz de Taxa de CPC por Horário (%)" padded={false}>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="p-2 text-left font-semibold text-slate-700">Dia \ Hora</th>
                {report.hours.map((h) => (
                  <th key={h} className="p-2 text-center font-semibold text-slate-600">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.weekdays.map((w) => (
                <tr key={w.day} className="border-t border-slate-100">
                  <td className="p-2 font-bold text-slate-800 whitespace-nowrap">
                    {w.day}
                  </td>
                  {w.cpcHourly.map((val, idx) => (
                    <td key={idx} className="p-1 text-center">
                      <div
                        className={clsx(
                          'rounded-md py-1 px-1.5 transition text-[11px]',
                          getCellTone(val),
                        )}
                        title={`${w.day} às ${report.hours[idx]}: ${val}% CPC`}
                      >
                        {val > 0 ? `${val}%` : '—'}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// 5. RELATÓRIO SINTÉTICO DE TABULAÇÕES & DESFECHOS
// ============================================================================
function DispositionsReport({
  report,
}: {
  report: ReportData['reports']['dispositions'];
}) {
  const categoryLabel: Record<string, { label: string; tone: 'green' | 'brand' | 'amber' | 'red' | 'gray' }> = {
    POSITIVE: { label: 'Produtiva (Conversão)', tone: 'green' },
    NEUTRAL: { label: 'Produtiva (CPC sem acordo)', tone: 'brand' },
    UNPRODUCTIVE: { label: 'Improdutiva (Sem contato)', tone: 'gray' },
    INVALID_DATA: { label: 'Higienização (Dados inválidos)', tone: 'amber' },
    OPT_OUT: { label: 'Bloqueio (Opt-Out / DNC)', tone: 'red' },
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho Limpo com Tooltip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Sintético de Tabulações e Desfechos de Negócio
            </h3>
            <InfoTooltip content="Agrupamento das tabulações registradas pelos canais e operadores em: Produtivas (acordos e promessas), Improdutivas (caixas postais e ocupados), Cadastrais (higienização de telefones inexistentes/terceiros) e Bloqueio (Opt-Out)." />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Auditoria completa de encerramento de contatos, efetividade comercial e higienização cadastral da base.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 text-right">
            <div className="text-xs font-medium text-slate-500 flex items-center justify-end gap-1">
              <span>Conversão Positiva</span>
              <InfoTooltip content="Percentual de contatos com fechamento de acordos ou promessas de pagamento sobre o total de discadas." />
            </div>
            <div className="text-xl font-black text-emerald-700">{report.positivePct}%</div>
          </div>
        </div>
      </div>

      {/* Grid de Resumo dos Desfechos com Tooltips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Conversão Positiva</span>
            <InfoTooltip content="Acordos fechados e promessas de pagamento formalizadas." />
          </div>
          <div className="text-xl font-bold text-emerald-700 mt-1">{report.positivePct}%</div>
          <div className="text-[11px] text-slate-400 mt-1">Acordos e promessas</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Taxa de CPC (Pessoa Certa)</span>
            <InfoTooltip content="Percentual de ligações em que o titular da conta atendeu e dialogou." />
          </div>
          <div className="text-xl font-bold text-brand-700 mt-1">{report.cpcPct}%</div>
          <div className="text-[11px] text-slate-400 mt-1">Titular atendeu e dialogou</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Perda Cadastral (Higienização)</span>
            <InfoTooltip content="Telefones inválidos, inexistentes ou de terceiros que devem ser expurgados da base." />
          </div>
          <div className="text-xl font-bold text-amber-700 mt-1">{report.invalidDataPct}%</div>
          <div className="text-[11px] text-slate-400 mt-1">Telefones inválidos / terceiros</div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Taxa de Opt-Out / DNC</span>
            <InfoTooltip content="Contatos que solicitaram descadastramento imediato (bloqueio mandatório)." />
          </div>
          <div className="text-xl font-bold text-rose-700 mt-1">{report.optOutPct}%</div>
          <div className="text-[11px] text-slate-400 mt-1">Solicitações de bloqueio</div>
        </div>
      </div>

      {/* Tabela Detalhada de Tabulações */}
      <Card title="Detalhamento Sintético por Código de Tabulação" padded={false}>
        <TableWrap label="Códigos de Tabulação">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome / Descrição</th>
                <th>Categoria</th>
                <th>Volume</th>
                <th>% sobre Total</th>
                <th>É CPC?</th>
                <th>É Conversão?</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((tab) => {
                const cat = categoryLabel[tab.category] || { label: tab.category, tone: 'gray' };
                return (
                  <tr key={tab.code}>
                    <td className="font-mono text-xs font-semibold text-slate-900">{tab.code}</td>
                    <td className="font-medium text-slate-800">{tab.name}</td>
                    <td>
                      <Badge tone={cat.tone}>{cat.label}</Badge>
                    </td>
                    <td>{fmtNumber(tab.count)}</td>
                    <td>
                      <span className="font-semibold text-slate-800">{tab.pct}%</span>
                    </td>
                    <td>
                      {tab.isCpc ? (
                        <Badge tone="green">SIM</Badge>
                      ) : (
                        <span className="text-slate-400 text-xs">Não</span>
                      )}
                    </td>
                    <td>
                      {tab.isConversion ? (
                        <Badge tone="green">CONVERSÃO</Badge>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

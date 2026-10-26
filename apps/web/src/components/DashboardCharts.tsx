import { useState } from 'react';
import clsx from 'clsx';
import {
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Card, Badge, InfoTooltip } from './ui';

interface ChannelComparison {
  key: string;
  label: string;
  icon: typeof MessageSquare;
  withAiCpc: number;
  bruteForceCpc: number;
  savingsPct: number;
  cpcRate: number;
}

const CHANNELS_DATA: ChannelComparison[] = [
  {
    key: 'whatsapp',
    label: 'WhatsApp Oficial',
    icon: MessageSquare,
    withAiCpc: 1.80,
    bruteForceCpc: 3.90,
    savingsPct: 53.8,
    cpcRate: 44.5,
  },
  {
    key: 'voice',
    label: 'Discador (Voz)',
    icon: Phone,
    withAiCpc: 4.10,
    bruteForceCpc: 6.80,
    savingsPct: 39.7,
    cpcRate: 36.2,
  },
  {
    key: 'sms',
    label: 'SMS / RCS',
    icon: MessageCircle,
    withAiCpc: 2.90,
    bruteForceCpc: 4.90,
    savingsPct: 40.8,
    cpcRate: 28.6,
  },
  {
    key: 'email',
    label: 'E-mail Transacional',
    icon: Mail,
    withAiCpc: 0.95,
    bruteForceCpc: 2.20,
    savingsPct: 56.8,
    cpcRate: 19.4,
  },
];

interface HourlyPoint {
  hour: string;
  rate: number;
  cost: number;
  isPeak?: boolean;
  label: string;
}

const HOURLY_DATA: HourlyPoint[] = [
  { hour: '08h', rate: 21.4, cost: 4.80, label: '08:00 – 09:00' },
  { hour: '10h', rate: 34.8, cost: 3.60, label: '10:00 – 11:00' },
  { hour: '12h', rate: 48.2, cost: 2.40, isPeak: true, label: '12:00 – 13:00 (Pico Almoço)' },
  { hour: '14h', rate: 31.5, cost: 3.90, label: '14:00 – 15:00' },
  { hour: '16h', rate: 39.1, cost: 3.20, label: '16:00 – 17:00' },
  { hour: '18h', rate: 46.5, cost: 2.60, isPeak: true, label: '18:00 – 19:00 (Pico Fim de Tarde)' },
  { hour: '20h', rate: 23.8, cost: 4.50, label: '20:00 – 21:00' },
];

export function CpcChannelComparisonChart() {
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const maxCpc = 7.50; // Referência máxima para escala da barra

  return (
    <Card
      title="Eficiência de Custo por CPC por Canal"
      tooltip="Comparação auditável: Custo por CPC com Inteligência Voll Connect vs. Disparo Cego (Força Bruta)."
      actions={
        <Badge tone="green">
          <span className="font-bold">-43,2%</span> economia média
        </Badge>
      }
    >
      <div className="space-y-2.5">
        {/* Legenda compacta */}
        <div className="flex items-center justify-between text-[11px] border-b border-slate-100 pb-1.5 text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-slate-700 font-medium">
              <span className="size-2 rounded-xs bg-brand-600" />
              <span>Com Inteligência Voll</span>
            </span>
            <span className="flex items-center gap-1.5 text-slate-500 font-medium">
              <span className="size-2 rounded-xs bg-slate-300" />
              <span>Sem Inteligência (Força Bruta)</span>
            </span>
          </div>
          <span className="text-slate-400 text-[10px]">R$ / Pessoa Certa</span>
        </div>

        {/* Barras por Canal compactas */}
        <div className="space-y-1.5">
          {CHANNELS_DATA.map((ch) => {
            const Icon = ch.icon;
            const isHovered = hoveredChannel === ch.key;
            const aiWidthPct = Math.min(100, (ch.withAiCpc / maxCpc) * 100);
            const bruteWidthPct = Math.min(100, (ch.bruteForceCpc / maxCpc) * 100);

            return (
              <div
                key={ch.key}
                onMouseEnter={() => setHoveredChannel(ch.key)}
                onMouseLeave={() => setHoveredChannel(null)}
                className={clsx(
                  'rounded-md px-2 py-1 transition-colors',
                  isHovered ? 'bg-slate-50' : 'bg-transparent',
                )}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-1.5 font-medium text-slate-800">
                    <Icon className="size-3 text-slate-400" />
                    <span>{ch.label}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60 leading-none">
                      ↓ {ch.savingsPct.toFixed(1)}%
                    </span>
                    <span className="text-xs font-bold text-slate-900 tabular">
                      R$ {ch.withAiCpc.toFixed(2)}
                      <span className="text-slate-400 font-normal line-through ml-1.5 text-[10px]">
                        R$ {ch.bruteForceCpc.toFixed(2)}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Duas barras comparativas finas */}
                <div className="space-y-0.5">
                  {/* Barra IA */}
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden relative">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-600 to-indigo-600 transition-all duration-300"
                      style={{ width: `${aiWidthPct}%` }}
                    />
                  </div>
                  {/* Barra Força Bruta */}
                  <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden relative">
                    <div
                      className="h-full rounded-full bg-slate-300 transition-all duration-300"
                      style={{ width: `${bruteWidthPct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Resumo Ponderado Final compacto */}
        <div className="rounded-lg border border-brand-200/70 bg-gradient-to-r from-brand-50/70 via-indigo-50/40 to-emerald-50/50 px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-700">
            <Sparkles className="size-3.5 text-brand-700 shrink-0" />
            <span className="text-[11px]">
              Média Operação: <strong>R$ 3,18</strong> vs. <span className="text-slate-500">R$ 5,60</span> cego
            </span>
          </div>
          <span className="font-bold text-emerald-800 bg-white/90 border border-emerald-200 px-2 py-0.5 rounded text-[10px] shrink-0">
            -R$ 2,42 / contato
          </span>
        </div>
      </div>
    </Card>
  );
}

export function BttcHourlyTrendChart() {
  const [activePoint, setActivePoint] = useState<HourlyPoint>(HOURLY_DATA[2]); // 12h padrão

  // Coordenadas para o SVG (viewBox 0 0 500 120)
  const width = 500;
  const height = 120;
  const padX = 36;
  const padBottom = 22;
  const padTop = 14;
  const plotWidth = width - padX * 2;
  const plotHeight = height - padBottom - padTop;
  const maxRate = 60; // escala Y de 0 a 60%

  const points = HOURLY_DATA.map((d, i) => {
    const x = padX + (i / (HOURLY_DATA.length - 1)) * plotWidth;
    const y = padTop + plotHeight - (d.rate / maxRate) * plotHeight;
    return { ...d, x, y };
  });

  // Gera o path SVG suave (curva cúbica ou linear)
  const linePath = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  // Gera a área fechada para o gradiente
  const firstP = points[0];
  const lastP = points[points.length - 1];
  const baselineY = padTop + plotHeight;
  const areaPath = `${linePath} L ${lastP.x} ${baselineY} L ${firstP.x} ${baselineY} Z`;

  return (
    <Card
      title="Assertividade por Janela Horária (BTTC)"
      tooltip="Taxa de contato com a pessoa certa (%) identificada ao longo das faixas horárias do dia."
      actions={
        <Badge tone="brand">
          Pico Ativo: <span className="font-bold ml-1">12:00 (48,2%)</span>
        </Badge>
      }
    >
      <div className="space-y-2.5">
        {/* Banner do ponto selecionado / ativo compacto */}
        <div className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1 text-xs border border-slate-200/80">
          <span className="text-slate-600">
            Faixa: <strong className="text-slate-900">{activePoint.label}</strong>
          </span>
          <div className="flex items-center gap-2.5">
            <span className="text-slate-600">
              Taxa: <strong className="text-brand-700">{activePoint.rate.toFixed(1)}%</strong>
            </span>
            <span className="text-slate-600">
              Custo: <strong className="text-emerald-700">R$ {activePoint.cost.toFixed(2)}</strong>
            </span>
            {activePoint.isPeak && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">
                ⚡ Pico Assertivo
              </span>
            )}
          </div>
        </div>

        {/* Gráfico SVG Responsivo compacto */}
        <div className="relative w-full h-32">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full overflow-visible select-none"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="bttc-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.32" />
                <stop offset="80%" stopColor="#6366f1" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Linhas de grade Y */}
            {[20, 40].map((rateVal) => {
              const yVal = padTop + plotHeight - (rateVal / maxRate) * plotHeight;
              return (
                <g key={rateVal}>
                  <line
                    x1={padX}
                    y1={yVal}
                    x2={width - padX}
                    y2={yVal}
                    stroke="#e2e8f0"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={padX - 8}
                    y={yVal + 3}
                    textAnchor="end"
                    className="text-[10px] fill-slate-400 font-sans tabular"
                  >
                    {rateVal}%
                  </text>
                </g>
              );
            })}

            {/* Linha base */}
            <line
              x1={padX}
              y1={baselineY}
              x2={width - padX}
              y2={baselineY}
              stroke="#cbd5e1"
              strokeWidth="1"
            />

            {/* Área Preenchida com Gradiente */}
            <path d={areaPath} fill="url(#bttc-area-gradient)" />

            {/* Linha da Curva */}
            <path
              d={linePath}
              fill="none"
              stroke="#4f46e5"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Pontos Interativos e Rótulos */}
            {points.map((p) => {
              const isSelected = activePoint.hour === p.hour;

              return (
                <g
                  key={p.hour}
                  className="cursor-pointer group"
                  onClick={() => setActivePoint(p)}
                  onMouseEnter={() => setActivePoint(p)}
                >
                  {/* Barra transparente ampla para facilitar o clique/hover */}
                  <rect
                    x={p.x - 22}
                    y={padTop}
                    width={44}
                    height={plotHeight}
                    fill="transparent"
                  />

                  {/* Linha vertical tracejada ao selecionar */}
                  {isSelected && (
                    <line
                      x1={p.x}
                      y1={padTop}
                      x2={p.x}
                      y2={baselineY}
                      stroke="#818cf8"
                      strokeDasharray="3 3"
                      strokeWidth="1.5"
                    />
                  )}

                  {/* Ponto / Nó */}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isSelected ? 5.5 : p.isPeak ? 4.5 : 3.5}
                    fill={isSelected ? '#4f46e5' : '#ffffff'}
                    stroke={isSelected ? '#ffffff' : '#4f46e5'}
                    strokeWidth={isSelected ? 2 : 2.5}
                    className="transition-all duration-150"
                  />

                  {/* Valor de % acima do nó se for pico ou selecionado */}
                  {(p.isPeak || isSelected) && (
                    <text
                      x={p.x}
                      y={p.y - 8}
                      textAnchor="middle"
                      className="text-[10px] font-bold fill-indigo-900 font-sans"
                    >
                      {p.rate.toFixed(0)}%
                    </text>
                  )}

                  {/* Rótulo do Eixo X */}
                  <text
                    x={p.x}
                    y={baselineY + 16}
                    textAnchor="middle"
                    className={clsx(
                      'text-[10px] font-sans transition-colors',
                      isSelected ? 'font-bold fill-brand-700' : 'fill-slate-500 font-medium',
                    )}
                  >
                    {p.hour}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Rodapé informativo */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-1.5">
          <span>O motor BTTC direciona os disparos para os picos de almoço (12h) e fim de tarde (18h).</span>
          <span className="font-medium text-brand-700">Clique para detalhar</span>
        </div>
      </div>
    </Card>
  );
}

export function DashboardChartsGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CpcChannelComparisonChart />
      <BttcHourlyTrendChart />
    </div>
  );
}

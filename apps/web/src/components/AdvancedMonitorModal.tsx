import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDown,
  Clock,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  VolumeX,
} from 'lucide-react';
import { errorMessage, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtFullDateTimeSec } from '../lib/format';
import { LiveVoiceMonitor } from './LiveVoiceMonitor';
import {
  Badge,
  Button,
  InfoTooltip,
  Loading,
  Modal,
  Select,
  useToast,
} from './ui';
import {
  elapsedSince,
  type AudioFiltersConfig,
  type AudioFiltersResponse,
  type GatewayStatus,
  type LiveCall,
} from '../pages/telephony/types';

const DEFAULT_FILTERS: AudioFiltersConfig = {
  crosstalkMode: 'atual',
  crosstalkRatio: 0.45,
  crosstalkDynamicEcapaEnabled: true,
  aecSonarEnabled: true,
  energyVadEnabled: true,
  noiseSuppressionEnabled: false,
  inputGainAttenuationEnabled: true,
  bargeinEnabled: true,
  bargeinLevel: 3,
  bargeinGraceEnabled: true,
  bargeinGraceSec: 8,
  frameVadEnabled: true,
  firAntialiasingEnabled: true,
};

type FilterCardDef = {
  key: keyof Omit<
    AudioFiltersConfig,
    'crosstalkMode' | 'crosstalkRatio' | 'bargeinLevel' | 'bargeinGraceSec'
  >;
  label: string;
  tag: string;
  tooltip: string;
};

const GRANULAR_FILTER_CARDS: FilterCardDef[] = [
  {
    key: 'crosstalkDynamicEcapaEnabled',
    label: 'Chaveamento Dinâmico ECAPA',
    tag: 'Auto-switch ruído ≥ 200',
    tooltip:
      'Alterna automaticamente do filtro DSP para ECAPA-TDNN ONNX se o piso de ruído subir durante a chamada ou o Sonar detectar STREET/TV/OFFICE.',
  },
  {
    key: 'aecSonarEnabled',
    label: 'AEC Dinâmico (Sonar 425Hz)',
    tag: 'Cancelamento de Eco',
    tooltip:
      'Emite sonda de 425Hz nos primeiros 500–700ms para distinguir fone vs viva-voz e acionar echo_cancellation no FreeSWITCH apenas quando necessário.',
  },
  {
    key: 'energyVadEnabled',
    label: 'Ruído & VAD Dinâmico (4 Perfis)',
    tag: 'EnergyManager RMS',
    tooltip:
      'Classifica continuamente o ambiente em SILENCE, OFFICE, STREET ou TV e ajusta threshold, prefix_padding_ms e silence_duration_ms.',
  },
  {
    key: 'noiseSuppressionEnabled',
    label: 'Supressão de Ruído Speex',
    tag: 'FreeSWITCH Channel',
    tooltip:
      'Ativa noise_suppression no FreeSWITCH. Mantido desligado por padrão para preservar naturalidade vocal e evitar timbre metálico em G.711/PCM.',
  },
  {
    key: 'inputGainAttenuationEnabled',
    label: 'Atenuação de Ganho (-3 dB)',
    tag: 'Anti-Clipping RTP',
    tooltip:
      'Aplica rtp_audio_in_level -3 no canal FreeSWITCH para evitar saturação analógica e clipping digital na entrada.',
  },
  {
    key: 'bargeinEnabled',
    label: 'Barge-In Ultrarrápido & Purge',
    tag: 'Corte < 15ms',
    tooltip:
      'Interrompe instantaneamente o áudio da IA quando o cliente fala, enviando response.cancel e limpando o buffer de playout no FreeSWITCH.',
  },
  {
    key: 'bargeinGraceEnabled',
    label: 'Carência na Saudação (Grace)',
    tag: 'Proteção Inicial',
    tooltip:
      'Descarta ruídos e interrupções precoces durante os primeiros segundos da saudação inicial antes de liberar o canal para pedidos.',
  },
  {
    key: 'frameVadEnabled',
    label: 'VAD Local por Frame (FrameVad)',
    tag: 'Modos Neurais / None',
    tooltip:
      'Detector de fala ativa por energia e frames de ataque usado para validar barge-in quando o gate DSP (YIN F0) não está ativo.',
  },
  {
    key: 'firAntialiasingEnabled',
    label: 'Filtro FIR Blackman (24kHz HD)',
    tag: 'Anti-Aliasing 31-tap',
    tooltip:
      'Quando ativo, opera em PCM 24kHz com filtro FIR Sinc Blackman (31 taps / fc 3350Hz). Quando desligado, negocia G.711 μ-law 8kHz nativo.',
  },
];

const CROSSTALK_MODES: {
  id: AudioFiltersConfig['crosstalkMode'];
  label: string;
  tooltip: string;
}[] = [
  {
    id: 'atual',
    label: 'DSP YIN F0',
    tooltip: 'Pitch F0 (80–320Hz), proximidade espectral (<600Hz) e gate RMS adaptativo.',
  },
  {
    id: 'wespeaker',
    label: 'WeSpeaker CAM++',
    tooltip: 'Biometria neural ONNX 512-dim CAM++ com janela deslizante.',
  },
  {
    id: 'ecapa',
    label: 'ECAPA-TDNN',
    tooltip: 'Biometria neural ONNX 512-dim ECAPA-TDNN para ambientes ruidosos.',
  },
  {
    id: 'none',
    label: 'Desligado',
    tooltip: 'Desativa a filtragem de vozes de fundo / crosstalk.',
  },
];

function FilterSwitch({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-brand-700' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block size-4 transform rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function AdvancedMonitorModal({
  open,
  onOpenChange,
  initialCallId,
  initialSection,
  onOpenDialer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialCallId?: string | null;
  initialSection?: 'filters' | 'monitor';
  onOpenDialer?: () => void;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canHangup = !!me && ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATOR', 'SUPERVISOR'].includes(me.role);

  const [section, setSection] = useState<'filters' | 'monitor'>(initialSection ?? 'filters');
  const [selectedCallId, setSelectedCallId] = useState<string>(initialCallId || '');
  const [lastActiveCrosstalk, setLastActiveCrosstalk] = useState<'atual' | 'wespeaker' | 'ecapa'>('atual');
  const [lastSyncStatus, setLastSyncStatus] = useState<'full' | 'partial' | 'offline' | null>(null);
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);

  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    if (!open) return;
    if (initialCallId) {
      setSelectedCallId(initialCallId);
      setSection(initialSection ?? 'monitor');
    } else if (initialSection) {
      setSection(initialSection);
    }
  }, [open, initialCallId, initialSection]);

  const callsQ = useQuery({
    queryKey: ['telephony', 'calls'],
    queryFn: () => get<{ count: number; calls: LiveCall[] }>('/telephony/calls'),
    enabled: open,
    refetchInterval: 3000,
    retry: false,
  });

  const statusQ = useQuery({
    queryKey: ['telephony', 'status'],
    queryFn: () => get<GatewayStatus>('/telephony/status'),
    enabled: open,
    refetchInterval: 10000,
    retry: false,
  });

  const filtersQ = useQuery({
    queryKey: ['telephony', 'audio-filters'],
    queryFn: () => get<AudioFiltersResponse>('/telephony/audio-filters'),
    enabled: open,
    retry: false,
  });

  const calls = callsQ.data?.calls ?? [];
  const activeCall = selectedCallId ? calls.find((c) => c.callId === selectedCallId) ?? null : null;

  useEffect(() => {
    if (!selectedCallId && calls.length > 0 && initialCallId) {
      const match = calls.find((c) => c.callId === initialCallId);
      if (match) setSelectedCallId(match.callId);
    }
  }, [calls, selectedCallId, initialCallId]);

  const filters = filtersQ.data?.filters ?? DEFAULT_FILTERS;
  useEffect(() => {
    if (filters.crosstalkMode !== 'none') {
      setLastActiveCrosstalk(filters.crosstalkMode);
    }
  }, [filters.crosstalkMode]);

  const liveTranscriptQ = useQuery({
    queryKey: ['telephony', 'transcript', activeCall?.callId],
    queryFn: () =>
      get<{ formatted?: string; text?: string; transcript?: unknown[]; turns?: unknown[] }>(
        `/telephony/calls/${encodeURIComponent(activeCall!.callId)}/transcript`,
      ),
    enabled: open && !!activeCall?.callId && section === 'monitor',
    refetchInterval: 2000,
    retry: false,
  });

  const scrollToBottom = () => {
    const el = transcriptScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  };

  const handleScroll = (el: HTMLElement | null) => {
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    shouldAutoScrollRef.current = nearBottom;
    setAutoScrollPaused(!nearBottom);
  };

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    setAutoScrollPaused(false);
  }, [activeCall?.callId, section]);

  useEffect(() => {
    if (!open || section !== 'monitor' || !activeCall?.callId || !shouldAutoScrollRef.current) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      scrollToBottom();
      raf2 = requestAnimationFrame(scrollToBottom);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [open, section, activeCall?.callId, liveTranscriptQ.data, liveTranscriptQ.dataUpdatedAt]);

  const saveFiltersM = useMutation({
    mutationFn: (patch: Partial<AudioFiltersConfig> & { applyToCallId?: string }) =>
      put<{ ok: boolean; filters: AudioFiltersConfig; gatewaySync: 'full' | 'partial' | 'offline' }>(
        '/telephony/audio-filters',
        { filters: { ...filters, ...patch }, applyToCallId: patch.applyToCallId },
      ),
    onSuccess: (res) => {
      setLastSyncStatus(res.gatewaySync);
      qc.setQueryData<AudioFiltersResponse | undefined>(['telephony', 'audio-filters'], (prev) =>
        prev
          ? {
              ...prev,
              filters: res.filters,
              gatewaySupportsGranularFilters: res.gatewaySync === 'full',
            }
          : prev,
      );
      qc.invalidateQueries({ queryKey: ['telephony', 'features'] });
      qc.invalidateQueries({ queryKey: ['telephony', 'crosstalk-mode'] });
      qc.invalidateQueries({ queryKey: ['telephony', 'calls'] });
      toast(
        'success',
        res.gatewaySync === 'full'
          ? 'Filtros atualizados no gateway.'
          : res.gatewaySync === 'partial'
            ? 'Filtro salvo; crosstalk/barge-in aplicados ao vivo no gateway.'
            : 'Filtros salvos no painel (gateway offline).',
      );
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const inCallActionM = useMutation({
    mutationFn: ({ callId, action, body }: { callId: string; action: string; body?: Record<string, unknown> }) =>
      post(`/telephony/calls/${encodeURIComponent(callId)}/${action}`, body ?? {}),
    onSuccess: (_d, vars) => {
      toast('success', `Comando ${vars.action} executado.`);
      qc.invalidateQueries({ queryKey: ['telephony', 'calls'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const hangupM = useMutation({
    mutationFn: (callId: string) =>
      post(`/telephony/calls/${encodeURIComponent(callId)}/hangup`, { reason: 'Encerrada pelo operador no Monitor Avançado' }),
    onSuccess: () => {
      toast('success', 'Chamada encerrada.');
      qc.invalidateQueries({ queryKey: ['telephony', 'calls'] });
      qc.invalidateQueries({ queryKey: ['telephony', 'history'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const canManageGlobal = filtersQ.data?.canManageGlobal ?? false;
  const gatewayOnline = statusQ.data?.status === 'ok' || filtersQ.data?.gatewayOnline;
  const fsNodes = statusQ.data?.freeSwitchCluster ?? statusQ.data?.freeswitch;
  const whisperNodes = statusQ.data?.whisperCluster;

  const activeFiltersCount =
    (filters.crosstalkMode !== 'none' ? 1 : 0) +
    GRANULAR_FILTER_CARDS.reduce((acc, item) => acc + (filters[item.key] ? 1 : 0), 0);

  const toggleFilter = (key: FilterCardDef['key']) => {
    saveFiltersM.mutate({ [key]: !filters[key], applyToCallId: activeCall?.callId });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Monitoramento Avançado · Voz & Filtros DSP"
      description="Controle completo dos filtros de áudio e acompanhamento ao vivo (acessível com ou sem chamada ativa)."
      wide
      contentClassName="max-w-5xl h-[min(90dvh,860px)]"
      bodyClassName="flex flex-col overflow-y-auto"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Barra de Telemetria + Seletor de Chamada + Navegação */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={gatewayOnline ? 'green' : 'amber'}>
              <Radio className="mr-1 inline size-3" aria-hidden />
              {gatewayOnline ? 'Gateway Online' : 'Gateway Standby'}
            </Badge>
            {fsNodes?.totalNodes != null && (
              <Badge tone={fsNodes.healthyNodes ? 'green' : 'red'}>
                FreeSWITCH {fsNodes.healthyNodes ?? 0}/{fsNodes.totalNodes}
              </Badge>
            )}
            {whisperNodes?.totalNodes != null && (
              <Badge tone={whisperNodes.healthyNodes ? 'green' : 'amber'}>
                Whisper {whisperNodes.healthyNodes ?? 0}/{whisperNodes.totalNodes}
              </Badge>
            )}
            <Badge tone={calls.length > 0 ? 'green' : 'gray'}>
              {calls.length} {calls.length === 1 ? 'chamada ativa' : 'chamadas ativas'}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Selecionar chamada para monitorar"
              value={selectedCallId}
              onChange={(e) => setSelectedCallId(e.target.value)}
              className="h-7.5 min-w-52 text-xs"
            >
              <option value="">
                {calls.length > 0 ? 'Standby (Nenhuma selecionada)' : 'Standby · Sem chamadas ativas'}
              </option>
              {calls.map((c) => (
                <option key={c.callId} value={c.callId}>
                  {c.caller || '—'} → {c.called || '—'} ({elapsedSince(c.startedAt)})
                </option>
              ))}
            </Select>

            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setSection('filters')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  section === 'filters' ? 'bg-brand-700 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
                Filtros de Áudio ({activeFiltersCount}/10)
              </button>
              <button
                type="button"
                onClick={() => setSection('monitor')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  section === 'monitor' ? 'bg-brand-700 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Activity className="size-3.5" aria-hidden />
                Monitor Ao Vivo
              </button>
            </div>
          </div>
        </div>

        {/* SEÇÃO 1: FILTROS DE ÁUDIO & DSP */}
        {section === 'filters' ? (
          filtersQ.isLoading ? (
            <div className="flex-1 py-4">
              <Loading rows={4} />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
              {/* Cabeçalho de sincronização + restaurar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="brand">{activeFiltersCount}/10 filtros ativos</Badge>
                  {(lastSyncStatus === 'partial' || !filtersQ.data?.gatewaySupportsGranularFilters) && (
                    <Badge tone="amber">
                      Crosstalk/Barge-in sincronizados no gateway
                      <InfoTooltip
                        className="ml-1"
                        content="O gateway conectado aceita crosstalk, barge-in e codec em tempo real; flags de FreeSWITCH/Sonar aguardam atualização do processo voice-gateway."
                      />
                    </Badge>
                  )}
                  {!canManageGlobal && (
                    <Badge tone="gray">Somente Super Admin altera filtros globais</Badge>
                  )}
                </div>

                {canManageGlobal && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RotateCcw className="size-3.5" aria-hidden />}
                    disabled={saveFiltersM.isPending}
                    onClick={() =>
                      saveFiltersM.mutate({
                        ...DEFAULT_FILTERS,
                        applyToCallId: activeCall?.callId,
                      })
                    }
                  >
                    Restaurar Padrão
                  </Button>
                )}
              </div>

              {/* Card Principal: Filtro de Voz de Fundo (Crosstalk) */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Filtro de Voz de Fundo (Crosstalk Filter)
                    </span>
                    <InfoTooltip content="Seleciona o motor responsável por separar a voz do interlocutor principal de TV, ruído ou vozes paralelas." />
                    <Badge tone={filters.crosstalkMode === 'none' ? 'gray' : 'green'}>
                      {filters.crosstalkMode === 'none' ? 'Desligado' : `Ativo · ${filters.crosstalkMode.toUpperCase()}`}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">
                      {filters.crosstalkMode === 'none' ? 'Desativado' : 'Ativado'}
                    </span>
                    <FilterSwitch
                      checked={filters.crosstalkMode !== 'none'}
                      disabled={!canManageGlobal || saveFiltersM.isPending}
                      label="Ativar ou desativar Filtro de Voz de Fundo"
                      onToggle={() => {
                        const nextMode = filters.crosstalkMode === 'none' ? lastActiveCrosstalk : 'none';
                        saveFiltersM.mutate({
                          crosstalkMode: nextMode,
                          applyToCallId: activeCall?.callId,
                        });
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-4">
                  {CROSSTALK_MODES.map((m) => {
                    const selected = filters.crosstalkMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!canManageGlobal || saveFiltersM.isPending}
                        onClick={() =>
                          saveFiltersM.mutate({
                            crosstalkMode: m.id,
                            applyToCallId: activeCall?.callId,
                          })
                        }
                        className={`rounded-lg border p-2.5 text-left transition disabled:opacity-60 ${
                          selected
                            ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-slate-900">{m.label}</span>
                          <InfoTooltip content={m.tooltip} />
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2.5 text-xs">
                  <label className="flex items-center gap-2 text-slate-600">
                    <span>Sensibilidade DSP (Ratio):</span>
                    <input
                      type="range"
                      min={0.15}
                      max={0.85}
                      step={0.05}
                      disabled={!canManageGlobal || saveFiltersM.isPending || filters.crosstalkMode === 'none'}
                      value={filters.crosstalkRatio}
                      onChange={(e) =>
                        saveFiltersM.mutate({
                          crosstalkRatio: Number(e.target.value),
                          applyToCallId: activeCall?.callId,
                        })
                      }
                      className="w-32 accent-brand-700"
                    />
                    <span className="font-mono font-semibold text-slate-800">
                      {Math.round(filters.crosstalkRatio * 100)}%
                    </span>
                  </label>

                  {activeCall && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={inCallActionM.isPending}
                      onClick={() =>
                        inCallActionM.mutate({
                          callId: activeCall.callId,
                          action: 'crosstalk',
                          body: { mode: filters.crosstalkMode },
                        })
                      }
                    >
                      Aplicar na chamada ativa ({activeCall.caller || activeCall.callId})
                    </Button>
                  )}
                </div>
              </div>

              {/* Grid dos Demais Filtros de Áudio (Ativar / Desativar) */}
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {GRANULAR_FILTER_CARDS.map((card) => {
                  const enabled = filters[card.key];
                  return (
                    <div
                      key={card.key}
                      className={`flex flex-col justify-between gap-2 rounded-xl border p-3 transition ${
                        enabled ? 'border-slate-200 bg-white' : 'border-slate-200/80 bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-900">{card.label}</span>
                            <InfoTooltip content={card.tooltip} />
                          </div>
                          <div className="mt-0.5 text-[11px] font-mono text-slate-400">{card.tag}</div>
                        </div>

                        <FilterSwitch
                          checked={enabled}
                          disabled={!canManageGlobal || saveFiltersM.isPending}
                          label={`${enabled ? 'Desativar' : 'Ativar'} ${card.label}`}
                          onToggle={() => toggleFilter(card.key)}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                        <Badge tone={enabled ? 'green' : 'gray'}>
                          {enabled ? 'Ativo' : 'Desativado'}
                        </Badge>

                        {card.key === 'bargeinEnabled' && enabled && (
                          <Select
                            aria-label="Nível de sensibilidade do barge-in"
                            disabled={!canManageGlobal || saveFiltersM.isPending}
                            value={String(filters.bargeinLevel)}
                            onChange={(e) =>
                              saveFiltersM.mutate({
                                bargeinLevel: Number(e.target.value),
                                bargeinEnabled: true,
                              })
                            }
                            className="h-6.5 w-24 text-[11px]"
                          >
                            {[1, 2, 3, 4, 5].map((lvl) => (
                              <option key={lvl} value={lvl}>
                                Nível {lvl}
                              </option>
                            ))}
                          </Select>
                        )}

                        {card.key === 'bargeinGraceEnabled' && enabled && (
                          <Select
                            aria-label="Duração da carência inicial em segundos"
                            disabled={!canManageGlobal || saveFiltersM.isPending}
                            value={String(filters.bargeinGraceSec)}
                            onChange={(e) =>
                              saveFiltersM.mutate({
                                bargeinGraceSec: Number(e.target.value),
                                bargeinGraceEnabled: true,
                              })
                            }
                            className="h-6.5 w-20 text-[11px]"
                          >
                            {[2, 4, 6, 8, 10, 12, 15].map((sec) => (
                              <option key={sec} value={sec}>
                                {sec}s
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          /* SEÇÃO 2: MONITOR AO VIVO & TRANSCRIÇÃO (OU STANDBY QUANDO SEM CHAMADAS) */
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {activeCall ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                    <strong className="font-mono text-slate-900">
                      {activeCall.caller || '—'} → {activeCall.called || '—'}
                    </strong>
                    <Badge tone="brand">{elapsedSince(activeCall.startedAt)}</Badge>
                    <Badge tone="gray">{activeCall.noiseProfile || 'SILENCE'}</Badge>
                    <Badge tone="gray">
                      <Clock className="mr-1 inline size-3" aria-hidden />
                      {fmtFullDateTimeSec(Date.now())}
                    </Badge>
                  </div>

                  {canHangup && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={activeCall.isMuted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                        onClick={() =>
                          inCallActionM.mutate({
                            callId: activeCall.callId,
                            action: activeCall.isMuted ? 'unmute' : 'mute',
                          })
                        }
                      >
                        {activeCall.isMuted ? 'Reativar' : 'Mudo'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={activeCall.isHeld ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                        onClick={() =>
                          inCallActionM.mutate({
                            callId: activeCall.callId,
                            action: activeCall.isHeld ? 'unhold' : 'hold',
                          })
                        }
                      >
                        {activeCall.isHeld ? 'Retomar' : 'Espera'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<VolumeX className="size-3.5" />}
                        onClick={() => inCallActionM.mutate({ callId: activeCall.callId, action: 'interrupt' })}
                      >
                        Cortar IA
                      </Button>
                      <Select
                        aria-label="Trocar filtro crosstalk da chamada ativa"
                        value={activeCall.crosstalkMode || filters.crosstalkMode}
                        onChange={(e) =>
                          inCallActionM.mutate({
                            callId: activeCall.callId,
                            action: 'crosstalk',
                            body: { mode: e.target.value },
                          })
                        }
                        className="h-7.5 w-36 text-xs"
                      >
                        <option value="atual">DSP YIN F0</option>
                        <option value="wespeaker">WeSpeaker CAM++</option>
                        <option value="ecapa">ECAPA-TDNN</option>
                        <option value="none">Desligado</option>
                      </Select>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<PhoneOff className="size-3.5" />}
                        loading={hangupM.isPending}
                        disabled={hangupM.isPending}
                        onClick={() => hangupM.mutate(activeCall.callId)}
                      >
                        Desligar
                      </Button>
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  <LiveVoiceMonitor callId={activeCall.callId} call={activeCall} isAdvanced />
                </div>

                <div className="relative flex min-h-[180px] flex-1 flex-col">
                  {liveTranscriptQ.isLoading ? (
                    <Loading rows={3} />
                  ) : (
                    <div
                      ref={transcriptScrollRef}
                      onScroll={(e) => handleScroll(e.currentTarget)}
                      className="min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      {(() => {
                        const raw = liveTranscriptQ.data;
                        const turns: any[] = Array.isArray(raw?.transcript)
                          ? raw.transcript
                          : Array.isArray(raw?.turns)
                            ? raw.turns
                            : [];
                        if (turns.length === 0) {
                          return (
                            <p className="text-xs text-slate-500">
                              {raw?.formatted || raw?.text || 'Aguardando detecção de fala...'}
                            </p>
                          );
                        }
                        return turns.map((t, i) => {
                          const isAgent = /^(agent|assistant|ai|ia|atendente)/i.test(t.role || t.speaker || '');
                          const turnAt = t.at ?? t.timestamp ?? t.ts ?? t.createdAt ?? t.time;
                          return (
                            <div key={i} className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}>
                              <span className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                <span>{isAgent ? 'Agente IA' : 'Cliente'}</span>
                                {turnAt != null && turnAt !== '' && (
                                  <span className="font-mono font-normal normal-case tabular-nums text-slate-400">
                                    · {fmtFullDateTimeSec(turnAt)}
                                  </span>
                                )}
                              </span>
                              <div
                                className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs shadow-2xs ${
                                  isAgent
                                    ? 'rounded-tr-xs bg-brand-700 text-white'
                                    : 'rounded-tl-xs border border-slate-200 bg-white text-slate-800'
                                }`}
                              >
                                {t.text || t.content || String(t)}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}

                  {autoScrollPaused && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="pointer-events-auto shadow-md"
                        icon={<ArrowDown className="size-3.5" />}
                        onClick={() => {
                          shouldAutoScrollRef.current = true;
                          setAutoScrollPaused(false);
                          scrollToBottom();
                        }}
                      >
                        Acompanhar novas falas
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* STANDBY QUANDO NÃO HÁ CHAMADAS ATIVAS */
              <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center">
                <Activity className="size-8 text-brand-700" aria-hidden />
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Monitoramento Avançado em Standby
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Nenhuma chamada ativa no momento. Assim que uma ligação iniciar, selecione-a acima para inspecionar áudio e latência.
                  </div>
                </div>

                <div className="flex max-w-2xl flex-wrap justify-center gap-1.5">
                  <Badge tone={filters.crosstalkMode === 'none' ? 'gray' : 'green'}>
                    Crosstalk: {filters.crosstalkMode === 'none' ? 'Desligado' : filters.crosstalkMode.toUpperCase()}
                  </Badge>
                  {GRANULAR_FILTER_CARDS.map((card) => (
                    <Badge key={card.key} tone={filters[card.key] ? 'green' : 'gray'}>
                      {card.label}: {filters[card.key] ? 'ON' : 'OFF'}
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<SlidersHorizontal className="size-3.5" aria-hidden />}
                    onClick={() => setSection('filters')}
                  >
                    Configurar Filtros de Áudio ({activeFiltersCount}/10)
                  </Button>
                  {onOpenDialer && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<PhoneOutgoing className="size-3.5" aria-hidden />}
                      onClick={() => {
                        onOpenChange(false);
                        onOpenDialer();
                      }}
                    >
                      Nova Ligação de Teste
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

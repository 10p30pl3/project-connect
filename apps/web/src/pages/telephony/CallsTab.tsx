import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Download,
  FileText,
  Hash,
  MessageSquare,
  Mic,
  MicOff,
  Pause,
  PhoneForwarded,
  PhoneOff,
  PhoneOutgoing,
  Play,
  SlidersHorizontal,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { isSuperAdminRole } from '@voll/shared';
import { API_BASE, errorMessage, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useExperienceMode } from '../../lib/experience-mode';
import { fmtDateTime } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Loading,
  Modal,
  Select,
  TableWrap,
  Textarea,
  useToast,
} from '../../components/ui';
import {
  elapsedSince,
  fmtDuration,
  GatewayError,
  type HistoryItem,
  type LiveCall,
  type SipExtension,
  type TenantConfig,
  type TrunkItem,
} from './types';

function recordingBaseId(file?: string | null): string | null {
  if (!file) return null;
  return file.replace(/\.(wav|txt|json)$/i, '');
}

function escapeCsvCell(val: unknown): string {
  const s = val == null ? '' : String(val);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function CallsTab({
  openOriginateSignal = false,
  presetTenantId,
  onOriginateConsumed,
}: {
  openOriginateSignal?: boolean;
  presetTenantId?: string | null;
  onOriginateConsumed?: () => void;
}) {
  const { me, can } = useAuth();
  const { mode, isAtLeast } = useExperienceMode();
  const qc = useQueryClient();
  const toast = useToast();
  const canOperate = can('telephony.hangup');
  const canSeeCosts = isSuperAdminRole(me?.role);

  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [tabFilter, setTabFilter] = useState('all');

  const [endingCall, setEndingCall] = useState<LiveCall | null>(null);
  const [sayCall, setSayCall] = useState<LiveCall | null>(null);
  const [sayRole, setSayRole] = useState<'agent' | 'system'>('agent');
  const [sayText, setSayText] = useState('');
  const [sayInterrupt, setSayInterrupt] = useState(true);
  const [sayTrigger, setSayTrigger] = useState(true);

  const [dtmfCall, setDtmfCall] = useState<LiveCall | null>(null);
  const [dtmfDigits, setDtmfDigits] = useState('');
  const [dtmfDirection, setDtmfDirection] = useState<'inbound' | 'outbound'>('outbound');

  const [xferCall, setXferCall] = useState<LiveCall | null>(null);
  const [xferTarget, setXferTarget] = useState('');
  const [xferMode, setXferMode] = useState<'blind' | 'refer'>('blind');

  const [transcriptCallId, setTranscriptCallId] = useState<string | null>(null);
  const [historyPlayRec, setHistoryPlayRec] = useState<string | null>(null);

  const [originateOpen, setOriginateOpen] = useState(false);
  const [origMode, setOrigMode] = useState<'pstn' | 'sip'>('pstn');
  const [origTo, setOrigTo] = useState('');
  const [origFrom, setOrigFrom] = useState('5511989785888');
  const [origTenantId, setOrigTenantId] = useState('default');
  const [origAmd, setOrigAmd] = useState(false);
  const [origStt, setOrigStt] = useState(true);
  const [origInstructions, setOrigInstructions] = useState('');
  const [, setClockTick] = useState(0);

  useEffect(() => {
    if (openOriginateSignal) {
      if (presetTenantId) setOrigTenantId(presetTenantId);
      setOriginateOpen(true);
      onOriginateConsumed?.();
    }
  }, [openOriginateSignal, presetTenantId, onOriginateConsumed]);

  const liveQ = useQuery({
    queryKey: ['telephony', 'calls'],
    queryFn: () => get<{ count: number; calls: LiveCall[] }>('/telephony/calls'),
    refetchInterval: 3000,
    retry: false,
  });

  useEffect(() => {
    const activeCount = liveQ.data?.calls?.length ?? 0;
    if (!activeCount) return;
    const t = setInterval(() => setClockTick((n) => (n + 1) % 10000), 1000);
    return () => clearInterval(t);
  }, [liveQ.data?.calls?.length]);

  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ count: number; tenants: TenantConfig[] }>('/telephony/tenants'),
    retry: false,
  });

  const extQ = useQuery({
    queryKey: ['telephony', 'extensions'],
    queryFn: () => get<{ extensions: SipExtension[] }>('/telephony/extensions'),
    enabled: originateOpen || !!xferCall,
    retry: false,
  });

  const trunksQ = useQuery({
    queryKey: ['telephony', 'trunks'],
    queryFn: () => get<{ trunks: TrunkItem[] }>('/telephony/trunks'),
    enabled: originateOpen,
    retry: false,
  });

  const historyQ = useQuery({
    queryKey: ['telephony', 'history', search, direction, tenantFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '150' });
      if (search.trim()) qs.set('search', search.trim());
      if (direction !== 'all') qs.set('direction', direction);
      if (tenantFilter !== 'all') qs.set('tenantId', tenantFilter);
      return get<{ total: number; history: HistoryItem[] }>(`/telephony/calls/history?${qs}`);
    },
    refetchInterval: 10000,
    retry: false,
  });

  const liveTranscriptQ = useQuery({
    queryKey: ['telephony', 'live-transcript', transcriptCallId],
    queryFn: () => get<any>(`/telephony/calls/${encodeURIComponent(transcriptCallId!)}/transcript`),
    enabled: !!transcriptCallId,
    refetchInterval: 2000,
    retry: false,
  });

  const historyTranscriptQ = useQuery({
    queryKey: ['telephony', 'recording-transcript', historyPlayRec],
    queryFn: () => get<{ formatted?: string; text?: string }>(`/telephony/recordings/${encodeURIComponent(historyPlayRec!)}/transcript`),
    enabled: !!historyPlayRec,
    retry: false,
  });

  const invalidateCalls = () => {
    qc.invalidateQueries({ queryKey: ['telephony', 'calls'] });
    qc.invalidateQueries({ queryKey: ['telephony', 'history'] });
  };

  const hangupM = useMutation({
    mutationFn: (c: LiveCall) => post(`/telephony/calls/${encodeURIComponent(c.callId)}/hangup`, { reason: 'Encerrada pelo operador no Voll Plan' }),
    onSuccess: () => {
      toast('success', 'Chamada encerrada.');
      setEndingCall(null);
      invalidateCalls();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const inCallActionM = useMutation({
    mutationFn: ({ callId, action, body }: { callId: string; action: string; body?: unknown }) =>
      post(`/telephony/calls/${encodeURIComponent(callId)}/${action}`, body ?? {}),
    onSuccess: (_res, vars) => {
      toast('success', `Comando "${vars.action}" enviado.`);
      invalidateCalls();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const sayM = useMutation({
    mutationFn: () =>
      post(`/telephony/calls/${encodeURIComponent(sayCall!.callId)}/say`, {
        role: sayRole,
        text: sayText.trim(),
        interrupt: sayInterrupt,
        triggerResponse: sayTrigger,
      }),
    onSuccess: () => {
      toast('success', 'Fala injetada na chamada com sucesso!');
      setSayCall(null);
      setSayText('');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const dtmfM = useMutation({
    mutationFn: () =>
      post(`/telephony/calls/${encodeURIComponent(dtmfCall!.callId)}/dtmf`, {
        digits: dtmfDigits.trim(),
        direction: dtmfDirection,
      }),
    onSuccess: () => {
      toast('success', `Dígitos DTMF "${dtmfDigits.trim()}" enviados.`);
      setDtmfCall(null);
      setDtmfDigits('');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const xferM = useMutation({
    mutationFn: () =>
      post(`/telephony/calls/${encodeURIComponent(xferCall!.callId)}/transfer`, {
        target: xferTarget.trim(),
        mode: xferMode,
      }),
    onSuccess: () => {
      toast('success', `Transferência iniciada para ${xferTarget.trim()}.`);
      setXferCall(null);
      setXferTarget('');
      invalidateCalls();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const originateM = useMutation({
    mutationFn: () =>
      post<{ ok?: boolean; callId?: string }>('/telephony/calls', {
        to: origTo.trim(),
        from: origFrom.trim() || '5511989785888',
        tenantId: origTenantId || 'default',
        amd: origAmd,
        stt: origStt,
        instructions: origInstructions.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast('success', `Chamada originada${res?.callId ? ` (${res.callId})` : ''}!`);
      setOriginateOpen(false);
      invalidateCalls();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const activateTrunkAndOriginateM = useMutation({
    mutationFn: async (trunkId: string) => {
      await post(`/telephony/trunks/${encodeURIComponent(trunkId)}/status`, { active: true });
      return post<{ ok?: boolean; callId?: string }>('/telephony/calls', {
        to: origTo.trim(),
        from: origFrom.trim() || '5511989785888',
        tenantId: origTenantId || 'default',
        amd: origAmd,
        stt: origStt,
        instructions: origInstructions.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      toast('success', `Tronco ativado e chamada originada${res?.callId ? ` (${res.callId})` : ''}!`);
      setOriginateOpen(false);
      qc.invalidateQueries({ queryKey: ['telephony', 'trunks'] });
      invalidateCalls();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const calls = liveQ.data?.calls ?? [];
  const tenants = tenantsQ.data?.tenants ?? [];
  const extensions = extQ.data?.extensions ?? [];
  const onlineExtensions = extensions.filter((e) => e.registered);
  const trunks = trunksQ.data?.trunks ?? [];
  const activeTrunk = trunks.find((t) => t.active !== false);
  const pausedTrunk = trunks.find((t) => t.active === false);
  const rawHistory = historyQ.data?.history ?? [];

  const tabulationOptions = useMemo(() => {
    const s = new Set<string>();
    for (const h of rawHistory) if (h.tabulationCode) s.add(h.tabulationCode);
    return Array.from(s);
  }, [rawHistory]);

  const history = useMemo(() => {
    return rawHistory.filter((h) => {
      if (dateFilter && (!h.startedAt || !h.startedAt.slice(0, 10).includes(dateFilter))) return false;
      if (tabFilter !== 'all' && (h.tabulationCode ?? '') !== tabFilter) return false;
      return true;
    });
  }, [rawHistory, dateFilter, tabFilter]);

  const exportHistoryCsv = () => {
    const headers = [
      'Inicio',
      'CallId',
      'Origem',
      'Destino',
      'Agente',
      'Sentido',
      'DuracaoSec',
      'Tabulacao',
      'AMD',
      'Desligamento',
      ...(canSeeCosts ? ['CustoUSD'] : []),
    ];
    const rows = history.map((h) => [
      h.startedAt ?? '',
      h.callId,
      h.caller ?? '',
      h.called ?? '',
      h.tenantId ?? 'default',
      h.direction ?? '',
      h.durationSec ?? 0,
      h.tabulationCode ?? '',
      h.amdResult ?? '',
      h.hangupReason ?? '',
      ...(canSeeCosts ? [h.costUsd != null ? h.costUsd.toFixed(4) : ''] : []),
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(escapeCsvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico-chamadas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCockpitCall = transcriptCallId ? calls.find((c) => c.callId === transcriptCallId) ?? null : null;

  const renderTranscriptBody = (data: any) => {
    if (!data) return 'Sem transcrição disponível até o momento.';
    if (typeof data.formatted === 'string' && data.formatted.trim()) return data.formatted;
    if (typeof data.text === 'string' && data.text.trim()) return data.text;
    const turns = Array.isArray(data.transcript) ? data.transcript : Array.isArray(data.turns) ? data.turns : null;
    if (turns && turns.length > 0) {
      return turns
        .map((t: any) => `[${t.speaker || t.role || 'VOZ'}] ${t.text || t.content || ''}`)
        .join('\n');
    }
    return 'Aguardando detecção de fala...';
  };

  return (
    <div className="space-y-6">
      {/* Chamadas Ao Vivo */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <span>{mode === 'basic' ? 'Ligações em Andamento' : 'Chamadas em Andamento'}</span>
            <Badge tone={calls.length > 0 ? 'green' : 'gray'}>{calls.length} ativas</Badge>
          </div>
        }
        tooltip="Monitoramento em tempo real (atualização a cada 3s) com comandos completos In-Call."
        actions={
          canOperate && (
            <Button
              size="sm"
              variant="primary"
              icon={<PhoneOutgoing className="size-3.5" aria-hidden />}
              onClick={() => setOriginateOpen(true)}
            >
              Nova Ligação de Teste
            </Button>
          )
        }
        padded={false}
      >
        {liveQ.isLoading ? (
          <div className="p-4"><Loading /></div>
        ) : liveQ.error ? (
          <div className="p-4"><GatewayError error={liveQ.error} onRetry={() => liveQ.refetch()} /></div>
        ) : !calls.length ? (
          <div className="p-6">
            <Empty title="Nenhuma chamada ativa no momento">
              Clique em &ldquo;Nova Ligação de Teste&rdquo; ou ligue de um ramal para 9000 para testar o agente de IA.
            </Empty>
          </div>
        ) : (
          <TableWrap label="Chamadas em andamento">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>{mode === 'basic' ? 'Telefone' : 'Origem → Destino'}</th>
                  <th>{mode === 'basic' ? 'Agente de Voz' : 'Agente / Motor'}</th>
                  <th>Duração</th>
                  {isAtLeast('advanced') && <th>Áudio / Ambiente</th>}
                  <th>{isAtLeast('advanced') ? 'Estado / Canal' : 'Status'}</th>
                  <th className="text-right">{isAtLeast('advanced') ? 'Controles In-Call' : 'Ações'}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.callId}>
                    <td>
                      <div className="font-mono text-xs font-semibold text-slate-900">
                        {c.caller || '—'} → {c.called || '—'}
                      </div>
                      {isAtLeast('advanced') && (
                        <div className="font-mono text-[11px] text-slate-400 truncate max-w-52" title={c.callId}>
                          {c.callId}
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge tone="brand">{c.tenantId || 'default'}</Badge>
                      {isAtLeast('advanced') && c.stsEngine && (
                        <span className="ml-1 text-[11px] text-slate-500">{c.stsEngine}</span>
                      )}
                    </td>
                    <td className="tabular-nums text-xs">
                      <strong>{elapsedSince(c.startedAt)}</strong>
                      {isAtLeast('advanced') && c.maxDurationSec ? (
                        <span className="text-slate-400"> / {Math.round(c.maxDurationSec / 60)}m</span>
                      ) : null}
                    </td>
                    {isAtLeast('advanced') && (
                      <td className="text-xs text-slate-600">
                        <div className="flex flex-wrap gap-1">
                          {c.deviceMode === 'viva_voz' ? (
                            <Badge tone="amber">Viva-Voz · AEC ON</Badge>
                          ) : c.deviceMode === 'fone_ouvido' ? (
                            <Badge tone="green">Fone · AEC OFF</Badge>
                          ) : (
                            <span>{c.deviceMode || 'Calibrando Sonar'}</span>
                          )}
                          {c.noiseProfile && <Badge tone="gray">{c.noiseProfile}</Badge>}
                          {c.crosstalkMode && <Badge tone="brand">{c.crosstalkMode}</Badge>}
                        </div>
                      </td>
                    )}
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        {c.isAgentTalking ? <Badge tone="blue">IA falando</Badge> : <Badge tone="gray">Escutando</Badge>}
                        {c.isMuted && <Badge tone="amber">Mudo</Badge>}
                        {c.isHeld && <Badge tone="amber">Espera</Badge>}
                        {c.isRecording && (
                          <Badge tone={c.recordingPaused ? 'amber' : 'red'}>
                            {c.recordingPaused ? 'Gravação pausada' : 'Gravando'}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="primary"
                          title={isAtLeast('advanced') ? 'Abrir Cockpit ao Vivo (Transcrição + Controles)' : 'Acompanhar transcrição ao vivo'}
                          icon={<FileText className="size-3.5" aria-hidden />}
                          onClick={() => setTranscriptCallId(c.callId)}
                        >
                          {isAtLeast('advanced') ? 'Cockpit' : 'Acompanhar'}
                        </Button>
                        {canOperate && (
                          <>
                            {isAtLeast('advanced') && (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  title={c.isMuted ? 'Reativar microfone' : 'Mutar microfone'}
                                  icon={c.isMuted ? <MicOff className="size-3.5" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
                                  onClick={() => inCallActionM.mutate({ callId: c.callId, action: c.isMuted ? 'unmute' : 'mute' })}
                                />
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  title={c.isHeld ? 'Retomar da espera' : 'Colocar em espera'}
                                  icon={c.isHeld ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
                                  onClick={() => inCallActionM.mutate({ callId: c.callId, action: c.isHeld ? 'unhold' : 'hold' })}
                                />
                              </>
                            )}
                            {isAtLeast('advanced') && (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  title="Interromper fala da IA"
                                  icon={<VolumeX className="size-3.5" aria-hidden />}
                                  onClick={() => inCallActionM.mutate({ callId: c.callId, action: 'interrupt' })}
                                />
                                {c.isRecording && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    title={c.recordingPaused ? 'Retomar gravação' : 'Pausar gravação'}
                                    icon={c.recordingPaused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
                                    onClick={() =>
                                      inCallActionM.mutate({
                                        callId: c.callId,
                                        action: 'recording',
                                        body: { action: c.recordingPaused ? 'resume' : 'pause' },
                                      })
                                    }
                                  />
                                )}
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  title={c.isRecording ? 'Parar gravação' : 'Iniciar gravação'}
                                  icon={<Square className="size-3.5" aria-hidden />}
                                  onClick={() =>
                                    inCallActionM.mutate({
                                      callId: c.callId,
                                      action: 'recording',
                                      body: { action: c.isRecording ? 'stop' : 'start' },
                                    })
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  title="Injetar fala (Say)"
                                  icon={<MessageSquare className="size-3.5" aria-hidden />}
                                  onClick={() => setSayCall(c)}
                                />
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  title="Enviar DTMF"
                                  icon={<Hash className="size-3.5" aria-hidden />}
                                  onClick={() => setDtmfCall(c)}
                                />
                              </>
                            )}
                            {isAtLeast('advanced') && (
                              <Button
                                size="sm"
                                variant="secondary"
                                title="Transferir chamada"
                                icon={<PhoneForwarded className="size-3.5" aria-hidden />}
                                onClick={() => setXferCall(c)}
                              />
                            )}
                            <Button
                              size="sm"
                              variant="danger"
                              title="Encerrar chamada"
                              icon={<PhoneOff className="size-3.5" aria-hidden />}
                              onClick={() => setEndingCall(c)}
                            >
                              Desligar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* Histórico Detalhado de Chamadas */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <span>
              {mode === 'basic' ? 'Histórico de Ligações' : 'Histórico de Chamadas (CDR & Logs)'}
            </span>
            <Badge tone="gray">{history.length} registros</Badge>
          </div>
        }
        actions={
          isAtLeast('advanced') ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!history.length}
              icon={<Download className="size-3.5" aria-hidden />}
              onClick={exportHistoryCsv}
            >
              Exportar CSV
            </Button>
          ) : undefined
        }
        padded={false}
      >
        {mode === 'basic' ? (
          <div className="grid gap-2.5 border-b border-slate-100 px-5 py-3 sm:grid-cols-3">
            <Input
              placeholder="Buscar por telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar no histórico"
            />
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filtrar histórico por data"
            />
            <Select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
              <option value="all">Todos os agentes</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="grid gap-2.5 border-b border-slate-100 px-5 py-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              placeholder="Buscar por número, callId ou tabulação..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar no histórico"
            />
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filtrar histórico por data"
            />
            <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="all">Todos os sentidos</option>
              <option value="outbound">Saída (Outbound)</option>
              <option value="inbound">Entrada (Inbound)</option>
            </Select>
            <Select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
              <option value="all">Todos os agentes</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id}
                </option>
              ))}
            </Select>
            <Select value={tabFilter} onChange={(e) => setTabFilter(e.target.value)}>
              <option value="all">Todas tabulações</option>
              {tabulationOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>
        )}

        {historyQ.isLoading ? (
          <div className="p-4"><Loading /></div>
        ) : historyQ.error ? (
          <div className="p-4"><GatewayError error={historyQ.error} onRetry={() => historyQ.refetch()} /></div>
        ) : !history.length ? (
          <div className="p-6"><Empty title="Sem chamadas registradas no filtro atual" /></div>
        ) : (
          <TableWrap label="Histórico de chamadas">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>{isAtLeast('advanced') ? 'Início' : 'Data / Hora'}</th>
                  <th>{isAtLeast('advanced') ? 'Origem → Destino' : 'Telefone'}</th>
                  <th>Agente</th>
                  {isAtLeast('advanced') && <th>Sentido</th>}
                  <th>Duração</th>
                  {isAtLeast('advanced') && <th>Tabulação / AMD</th>}
                  {isAtLeast('advanced') && <th>Desligamento</th>}
                  {canSeeCosts && isAtLeast('advanced') && <th className="text-right">Custo IA</th>}
                  <th className="text-right">Gravação</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const recId = recordingBaseId(h.recordingFile);
                  return (
                    <tr key={h.callId}>
                      <td className="whitespace-nowrap text-xs">{h.startedAt ? fmtDateTime(h.startedAt) : '—'}</td>
                      <td>
                        <div className="font-mono text-xs font-medium text-slate-900">
                          {h.caller || '—'} → {h.called || '—'}
                        </div>
                        {isAtLeast('advanced') && (
                          <div className="font-mono text-[10px] text-slate-400 truncate max-w-44" title={h.callId}>
                            {h.callId}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge tone="gray">{h.tenantId || 'default'}</Badge>
                      </td>
                      {isAtLeast('advanced') && (
                        <td className="text-xs">
                          {h.direction === 'inbound' ? <Badge tone="green">Entrada</Badge> : h.direction === 'outbound' ? <Badge tone="blue">Saída</Badge> : '—'}
                        </td>
                      )}
                      <td className="tabular-nums text-xs font-medium">{fmtDuration(h.durationSec)}</td>
                      {isAtLeast('advanced') && (
                        <td className="text-xs">
                          <span>{h.tabulationCode ?? '—'}</span>
                          {isAtLeast('advanced') && h.amdResult && (
                            <span className="ml-1 text-[11px] text-slate-400">({h.amdResult})</span>
                          )}
                        </td>
                      )}
                      {isAtLeast('advanced') && (
                        <td className="text-xs text-slate-600">{h.hangupReason ?? '—'}</td>
                      )}
                      {canSeeCosts && isAtLeast('advanced') && (
                        <td className="text-right tabular-nums text-xs">
                          {h.costUsd != null ? `US$ ${h.costUsd.toFixed(4)}` : '—'}
                        </td>
                      )}
                      <td className="text-right">
                        {recId ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Volume2 className="size-3.5" aria-hidden />}
                            onClick={() => setHistoryPlayRec(recId)}
                          >
                            Ouvir
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
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

      {/* Modal Originar Chamada de Teste */}
      <Modal
        open={originateOpen}
        onOpenChange={setOriginateOpen}
        title={mode === 'basic' ? 'Nova Ligação de Teste' : 'Discador de Teste (1-Clique)'}
        description="Teste seu Agente IA ligando para o seu celular (PSTN) ou um ramal SIP interno."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOriginateOpen(false)}>
              Cancelar
            </Button>
            {origMode === 'pstn' && !activeTrunk && pausedTrunk ? (
              <Button
                variant="primary"
                loading={activateTrunkAndOriginateM.isPending}
                disabled={!origTo.trim()}
                onClick={() => activateTrunkAndOriginateM.mutate(pausedTrunk.id)}
                icon={<PhoneOutgoing className="size-4" aria-hidden />}
              >
                Ativar Tronco e Discar
              </Button>
            ) : (
              <Button
                variant="primary"
                loading={originateM.isPending}
                disabled={!origTo.trim()}
                onClick={() => originateM.mutate()}
                icon={<PhoneOutgoing className="size-4" aria-hidden />}
              >
                Chamar Agora
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setOrigMode('pstn');
                if (/^\d{3,4}$/.test(origTo)) setOrigTo('');
              }}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                origMode === 'pstn'
                  ? 'border-brand-600 bg-brand-50 text-brand-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Celular / Fixo (PSTN)
            </button>
            <button
              type="button"
              onClick={() => {
                setOrigMode('sip');
                if (!origTo) setOrigTo(onlineExtensions[0]?.id ?? '1000');
              }}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                origMode === 'sip'
                  ? 'border-brand-600 bg-brand-50 text-brand-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Ramal SIP ({onlineExtensions.length} online)
            </button>
          </div>

          {origMode === 'pstn' && trunks.length > 0 && !activeTrunk && pausedTrunk && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" aria-hidden />
              <div>
                O tronco SIP <strong>{pausedTrunk.name || pausedTrunk.id}</strong> está pausado. Clique em{' '}
                <strong>Ativar Tronco e Discar</strong> abaixo para ativar o tronco e iniciar a ligação em 1 clique.
              </div>
            </div>
          )}

          <div className={isAtLeast('advanced') ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'}>
            {origMode === 'pstn' ? (
              <Field label="Número com DDI/DDD" required>
                {(f) => (
                  <Input
                    id={f.id}
                    autoFocus
                    value={origTo}
                    onChange={(e) => setOrigTo(e.target.value)}
                    placeholder="Ex: 5511999998888"
                  />
                )}
              </Field>
            ) : (
              <Field label="Ramal SIP de Destino" required>
                {(f) => (
                  <div className="space-y-1.5">
                    <Input
                      id={f.id}
                      value={origTo}
                      onChange={(e) => setOrigTo(e.target.value)}
                      placeholder="Ex: 1000"
                    />
                    {extensions.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {extensions.slice(0, 8).map((ex) => (
                          <button
                            key={ex.id}
                            type="button"
                            onClick={() => setOrigTo(ex.id)}
                            className={`rounded px-2 py-0.5 text-[11px] font-mono border cursor-pointer ${
                              origTo === ex.id
                                ? 'border-brand-600 bg-brand-50 text-brand-800 font-semibold'
                                : ex.registered
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-200 bg-slate-50 text-slate-600'
                            }`}
                          >
                            {ex.id} {ex.registered ? '●' : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Field>
            )}
            {isAtLeast('advanced') && (
              <Field label="Caller ID (Origem)">
                {(f) => (
                  <Input
                    id={f.id}
                    value={origFrom}
                    onChange={(e) => setOrigFrom(e.target.value)}
                    placeholder="5511989785888"
                  />
                )}
              </Field>
            )}
          </div>
          <Field label="Agente de Voz (Tenant)">
            {(f) => (
              <Select id={f.id} value={origTenantId} onChange={(e) => setOrigTenantId(e.target.value)}>
                {!tenants.length && <option value="default">default</option>}
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || t.id} ({t.stsEngine === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isAtLeast('advanced') && (
            <>
              <div className="flex flex-wrap gap-4">
                <Checkbox label="Ativar AMD (Detecção de Caixa Postal)" checked={origAmd} onChange={(e) => setOrigAmd(e.target.checked)} />
                <Checkbox label="Transcrição em tempo real (STT)" checked={origStt} onChange={(e) => setOrigStt(e.target.checked)} />
              </div>
              <Field label="Instruções customizadas (opcional — sobrescreve apenas esta chamada)">
                {(f) => (
                  <Textarea
                    id={f.id}
                    rows={3}
                    value={origInstructions}
                    onChange={(e) => setOrigInstructions(e.target.value)}
                    placeholder="Deixe vazio para usar o prompt padrão do agente selecionado."
                  />
                )}
              </Field>
            </>
          )}
        </div>
      </Modal>

      {/* Modal Injetar Fala (Say) */}
      <Modal
        open={!!sayCall}
        onOpenChange={(o) => !o && setSayCall(null)}
        title="Injetar Fala / Comando na Sessão"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSayCall(null)}>Cancelar</Button>
            <Button variant="primary" loading={sayM.isPending} disabled={!sayText.trim()} onClick={() => sayM.mutate()}>
              Enviar Fala
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Papel">
            {(f) => (
              <Select id={f.id} value={sayRole} onChange={(e) => setSayRole(e.target.value as 'agent' | 'system')}>
                <option value="agent">Falar como Agente (TTS / IA)</option>
                <option value="system">Instrução de Sistema (Contexto invisível)</option>
              </Select>
            )}
          </Field>
          <Field label="Texto" required>
            {(f) => <Textarea id={f.id} rows={3} value={sayText} onChange={(e) => setSayText(e.target.value)} placeholder="Digite a frase ou instrução..." />}
          </Field>
          <div className="flex gap-4">
            <Checkbox label="Interromper áudio atual" checked={sayInterrupt} onChange={(e) => setSayInterrupt(e.target.checked)} />
            <Checkbox label="Gerar resposta imediata" checked={sayTrigger} onChange={(e) => setSayTrigger(e.target.checked)} />
          </div>
        </div>
      </Modal>

      {/* Modal DTMF */}
      <Modal
        open={!!dtmfCall}
        onOpenChange={(o) => !o && setDtmfCall(null)}
        title="Enviar Dígitos DTMF"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDtmfCall(null)}>Cancelar</Button>
            <Button variant="primary" loading={dtmfM.isPending} disabled={!dtmfDigits.trim()} onClick={() => dtmfM.mutate()}>
              Enviar DTMF
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Dígitos (ex: 123#)" required>
            {(f) => <Input id={f.id} value={dtmfDigits} onChange={(e) => setDtmfDigits(e.target.value)} placeholder="1234#" />}
          </Field>
          <Field label="Direção">
            {(f) => (
              <Select id={f.id} value={dtmfDirection} onChange={(e) => setDtmfDirection(e.target.value as 'inbound' | 'outbound')}>
                <option value="outbound">Outbound (Enviar ao destino PSTN/SIP)</option>
                <option value="inbound">Inbound (Simular tecla do cliente)</option>
              </Select>
            )}
          </Field>
        </div>
      </Modal>

      {/* Modal Transferência */}
      <Modal
        open={!!xferCall}
        onOpenChange={(o) => !o && setXferCall(null)}
        title="Transferir Chamada"
        footer={
          <>
            <Button variant="secondary" onClick={() => setXferCall(null)}>Cancelar</Button>
            <Button variant="primary" loading={xferM.isPending} disabled={!xferTarget.trim()} onClick={() => xferM.mutate()}>
              Transferir
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Destino (Ramal SIP ou Telefone)" required>
            {(f) => (
              <div className="space-y-2">
                <Input id={f.id} value={xferTarget} onChange={(e) => setXferTarget(e.target.value)} placeholder="Ex: 1001 ou 5511999998888" />
                {onlineExtensions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-500">Ramais online:</span>
                    {onlineExtensions.map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => setXferTarget(ex.id)}
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                      >
                        {ex.id} {ex.name ? `(${ex.name})` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
          <Field label="Modo">
            {(f) => (
              <Select id={f.id} value={xferMode} onChange={(e) => setXferMode(e.target.value as 'blind' | 'refer')}>
                <option value="blind">Blind Bridge (FreeSWITCH deflexiona/ponte)</option>
                <option value="refer">SIP REFER</option>
              </Select>
            )}
          </Field>
        </div>
      </Modal>

      {/* Modal Cockpit Unificado & Transcrição ao Vivo */}
      <Modal
        open={!!transcriptCallId}
        onOpenChange={(o) => !o && setTranscriptCallId(null)}
        title={
          isAtLeast('advanced')
            ? activeCockpitCall
              ? `Cockpit ao Vivo · ${activeCockpitCall.caller || '—'} → ${activeCockpitCall.called || '—'}`
              : 'Transcrição em Tempo Real'
            : 'Acompanhar Ligação ao Vivo'
        }
        description={isAtLeast('advanced') ? (transcriptCallId ?? undefined) : undefined}
        wide
      >
        <div className="space-y-4">
          {activeCockpitCall && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge tone="brand">{elapsedSince(activeCockpitCall.startedAt)}</Badge>
                <Badge tone="gray">{activeCockpitCall.tenantId || 'default'}</Badge>
                {isAtLeast('advanced') && (
                  <>
                    {activeCockpitCall.deviceMode === 'viva_voz' ? (
                      <Badge tone="amber">Viva-Voz · AEC ON</Badge>
                    ) : activeCockpitCall.deviceMode === 'fone_ouvido' ? (
                      <Badge tone="green">Fone · AEC OFF</Badge>
                    ) : null}
                    {activeCockpitCall.noiseProfile && <Badge tone="gray">{activeCockpitCall.noiseProfile}</Badge>}
                  </>
                )}
              </div>
              {canOperate && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {isAtLeast('advanced') && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={activeCockpitCall.isMuted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                        onClick={() => inCallActionM.mutate({ callId: activeCockpitCall.callId, action: activeCockpitCall.isMuted ? 'unmute' : 'mute' })}
                      >
                        {activeCockpitCall.isMuted ? 'Reativar Mic' : 'Mudo'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={activeCockpitCall.isHeld ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                        onClick={() => inCallActionM.mutate({ callId: activeCockpitCall.callId, action: activeCockpitCall.isHeld ? 'unhold' : 'hold' })}
                      >
                        {activeCockpitCall.isHeld ? 'Retomar' : 'Espera'}
                      </Button>
                    </>
                  )}
                  {isAtLeast('advanced') && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<VolumeX className="size-3.5" />}
                        onClick={() => inCallActionM.mutate({ callId: activeCockpitCall.callId, action: 'interrupt' })}
                      >
                        Interromper IA
                      </Button>
                      <Select
                        className="h-8 w-36 text-xs"
                        aria-label="Modo de filtro Crosstalk"
                        value={activeCockpitCall.crosstalkMode || 'atual'}
                        onChange={(e) =>
                          inCallActionM.mutate({
                            callId: activeCockpitCall.callId,
                            action: 'crosstalk',
                            body: { mode: e.target.value },
                          })
                        }
                      >
                        <option value="atual">Filtro DSP (YIN)</option>
                        <option value="wespeaker">WeSpeaker</option>
                        <option value="ecapa">ECAPA Neural</option>
                        <option value="none">Sem Filtro</option>
                      </Select>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<MessageSquare className="size-3.5" />}
                        onClick={() => setSayCall(activeCockpitCall)}
                      >
                        Say
                      </Button>
                    </>
                  )}
                  {isAtLeast('advanced') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<PhoneForwarded className="size-3.5" />}
                      onClick={() => setXferCall(activeCockpitCall)}
                    >
                      Transferir
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<PhoneOff className="size-3.5" />}
                    onClick={() => setEndingCall(activeCockpitCall)}
                  >
                    Desligar
                  </Button>
                </div>
              )}
            </div>
          )}

          {liveTranscriptQ.isLoading ? (
            <Loading rows={3} />
          ) : (() => {
              const data = liveTranscriptQ.data;
              const turns: { role?: string; speaker?: string; text?: string; at?: string }[] = Array.isArray(data?.transcript)
                ? data.transcript
                : Array.isArray(data?.turns)
                  ? data.turns
                  : [];
              if (turns.length > 0 && typeof turns[0] === 'object') {
                return (
                  <div className="max-h-96 space-y-2.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    {turns.map((t, i) => {
                      const isAgent = /^(agent|assistant|ai|ia|atendente)/i.test(t.role || t.speaker || '');
                      return (
                        <div key={i} className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}>
                          <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            {isAgent ? 'Agente IA' : 'Cliente'}
                          </span>
                          <div
                            className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs shadow-2xs ${
                              isAgent
                                ? 'rounded-tr-xs bg-brand-700 text-white'
                                : 'rounded-tl-xs border border-slate-200 bg-white text-slate-800'
                            }`}
                          >
                            {t.text || String(t)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }
              return (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-4 font-mono text-xs text-slate-100">
                  {renderTranscriptBody(data)}
                </pre>
              );
            })()}
        </div>
      </Modal>

      {/* Modal Reproduzir Gravação do Histórico */}
      <Modal
        open={!!historyPlayRec}
        onOpenChange={(o) => !o && setHistoryPlayRec(null)}
        title="Gravação Estéreo da Chamada"
        description={historyPlayRec ?? undefined}
        wide
      >
        {historyPlayRec && (
          <div className="space-y-3">
            <audio key={historyPlayRec} controls preload="none" className="w-full" src={`${API_BASE}/telephony/recordings/${encodeURIComponent(historyPlayRec)}/audio`} />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Canal Esquerdo: Cliente · Canal Direito: Agente IA</span>
              <a
                href={`${API_BASE}/telephony/recordings/${encodeURIComponent(historyPlayRec)}/audio`}
                download={`${historyPlayRec}.wav`}
                className="font-semibold text-brand-700 hover:underline"
              >
                ⬇ Baixar WAV
              </a>
            </div>
            {historyTranscriptQ.isLoading ? (
              <Loading rows={2} />
            ) : (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                {renderTranscriptBody(historyTranscriptQ.data)}
              </pre>
            )}
          </div>
        )}
      </Modal>

      {/* Confirmação Hangup */}
      <ConfirmDialog
        open={!!endingCall}
        onOpenChange={(o) => !o && setEndingCall(null)}
        title="Encerrar esta chamada?"
        confirmLabel="Encerrar chamada"
        danger
        loading={hangupM.isPending}
        onConfirm={() => endingCall && hangupM.mutate(endingCall)}
      >
        A ligação para <strong>{endingCall?.called || endingCall?.callId}</strong> será desligada agora e registrada na auditoria.
      </ConfirmDialog>
    </div>
  );
}

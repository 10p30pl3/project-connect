/**
 * Telefonia: chamadas de voz ao vivo, histórico, gravações e custo de IA do gateway de voz,
 * dentro do Voll Plan (antes só no dashboard.html do voice-app). Os dados passam pela API.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneOff, RefreshCw } from 'lucide-react';
import { API_BASE, ApiError, errorMessage, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { Alert, Badge, Button, Card, ConfirmDialog, Empty, Input, Loading, PageHeader, Stat, TableWrap, Tabs, useToast } from '../components/ui';

type LiveCall = {
  callId: string;
  tenantId?: string;
  caller?: string;
  called?: string;
  startedAt?: string;
  maxDurationSec?: number;
  lineType?: string;
  deviceMode?: string;
  noiseProfile?: string;
  isAgentTalking?: boolean;
  attemptId?: string | null;
};
type HistoryItem = {
  callId: string;
  tenantId?: string;
  caller?: string;
  called?: string;
  direction?: string;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  hangupReason?: string;
  tabulationCode?: string;
  costUsd?: number;
};
type Recording = { id: string; sizeBytes: number; createdAt: string; transcriptFile: string | null };

const mask = (n?: string) => (n ? (n.length > 6 ? `${n.slice(0, 4)}•••${n.slice(-3)}` : n) : '—');
const elapsed = (iso?: string) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function GatewayError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notConfigured = error instanceof ApiError && error.status === 409;
  return (
    <Alert tone={notConfigured ? 'warn' : 'error'} title={notConfigured ? 'Gateway de voz não configurado' : 'Gateway de voz indisponível'}>
      <p>{errorMessage(error)}</p>
      {!notConfigured && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </Alert>
  );
}

function LiveCalls() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [ending, setEnding] = useState<LiveCall | null>(null);
  const q = useQuery({
    queryKey: ['telephony', 'calls'],
    queryFn: () => get<{ count: number; calls: LiveCall[] }>('/telephony/calls'),
    refetchInterval: 3000,
    retry: false,
  });
  const hangup = useMutation({
    mutationFn: (c: LiveCall) => post(`/telephony/calls/${encodeURIComponent(c.callId)}/hangup`, { reason: 'Encerrada pelo supervisor no Voll Plan' }),
    onSuccess: () => {
      toast('success', 'Chamada encerrada.');
      qc.invalidateQueries({ queryKey: ['telephony', 'calls'] });
    },
    onError: (err) => toast('error', errorMessage(err)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;
  const calls = q.data?.calls ?? [];
  if (!calls.length) return <Empty title="Nenhuma chamada em andamento">A lista atualiza a cada 3 segundos.</Empty>;
  return (
    <>
      <TableWrap label="Chamadas em andamento">
        <table className="data w-full">
          <thead>
            <tr>
              <th>Destino</th>
              <th>Origem</th>
              <th>Duração</th>
              <th>Linha</th>
              <th>Ambiente</th>
              <th>Fala</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.callId}>
                <td className="font-medium">{mask(c.called)}</td>
                <td>{mask(c.caller)}</td>
                <td className="tabular-nums">
                  {elapsed(c.startedAt)}
                  {c.maxDurationSec ? <span className="text-slate-400"> / {Math.round(c.maxDurationSec / 60)} min</span> : null}
                </td>
                <td>{c.lineType ?? '—'}</td>
                <td>{[c.deviceMode, c.noiseProfile].filter(Boolean).join(' · ') || '—'}</td>
                <td>{c.isAgentTalking ? <Badge tone="blue">Agente</Badge> : <Badge tone="gray">Cliente</Badge>}</td>
                <td className="text-right">
                  {can('telephony.hangup') && (
                    <Button size="sm" variant="secondary" icon={<PhoneOff className="size-3.5" aria-hidden />} onClick={() => setEnding(c)}>
                      Encerrar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <ConfirmDialog
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        title="Encerrar esta chamada?"
        confirmLabel="Encerrar chamada"
        danger
        loading={hangup.isPending}
        onConfirm={() => {
          if (ending) hangup.mutate(ending);
          setEnding(null);
        }}
      >
        A ligação para {mask(ending?.called)} será desligada agora. A ação fica registrada na auditoria.
      </ConfirmDialog>
    </>
  );
}

function History() {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['telephony', 'history', search],
    queryFn: () => get<{ total: number; history: HistoryItem[] }>(`/telephony/calls/history?limit=200${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    retry: false,
  });
  return (
    <div className="space-y-3">
      <Input placeholder="Buscar por número ou id da chamada" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar no histórico" />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <GatewayError error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.history.length ? (
        <Empty title="Sem chamadas no histórico" />
      ) : (
        <TableWrap label="Histórico de chamadas">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Início</th>
                <th>Destino</th>
                <th>Sentido</th>
                <th>Duração</th>
                <th>Tabulação</th>
                <th>Encerramento</th>
                <th className="text-right">Custo IA (US$)</th>
              </tr>
            </thead>
            <tbody>
              {q.data.history.map((h) => (
                <tr key={h.callId}>
                  <td>{h.startedAt ? fmtDateTime(h.startedAt) : '—'}</td>
                  <td>{mask(h.called)}</td>
                  <td>{h.direction === 'inbound' ? 'Entrada' : h.direction === 'outbound' ? 'Saída' : '—'}</td>
                  <td className="tabular-nums">{h.durationSec != null ? `${h.durationSec}s` : '—'}</td>
                  <td>{h.tabulationCode ?? '—'}</td>
                  <td>{h.hangupReason ?? '—'}</td>
                  <td className="text-right tabular-nums">{h.costUsd != null ? h.costUsd.toFixed(4) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

function Recordings() {
  const [playing, setPlaying] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['telephony', 'recordings'], queryFn: () => get<{ count: number; recordings: Recording[] }>('/telephony/recordings'), retry: false });
  const transcript = useQuery({
    queryKey: ['telephony', 'recording-transcript', playing],
    queryFn: () => get<{ formatted?: string; text?: string }>(`/telephony/recordings/${encodeURIComponent(playing!)}/transcript`),
    enabled: !!playing,
    retry: false,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.recordings.length) return <Empty title="Nenhuma gravação" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TableWrap label="Gravações">
        <table className="data w-full">
          <thead>
            <tr>
              <th>Gravação</th>
              <th>Data</th>
              <th className="text-right">Tamanho</th>
            </tr>
          </thead>
          <tbody>
            {q.data.recordings.map((r) => (
              <tr key={r.id} className={playing === r.id ? 'bg-brand-50' : undefined}>
                <td>
                  <button type="button" className="text-left font-medium text-brand-700 hover:underline" onClick={() => setPlaying(r.id)}>
                    {r.id}
                  </button>
                </td>
                <td>{fmtDateTime(r.createdAt)}</td>
                <td className="text-right tabular-nums">{(r.sizeBytes / 1024).toFixed(0)} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Card title={playing ? 'Gravação selecionada' : 'Selecione uma gravação'}>
        {playing ? (
          <div className="space-y-3">
            <audio key={playing} controls preload="none" className="w-full" src={`${API_BASE}/telephony/recordings/${encodeURIComponent(playing)}/audio`}>
              Seu navegador não reproduz áudio.
            </audio>
            <p className="text-xs text-slate-500">Canal esquerdo: cliente · direito: agente. Ouvir fica registrado na auditoria.</p>
            {transcript.isLoading ? (
              <Loading rows={2} />
            ) : transcript.data ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[12px] text-slate-700">
                {transcript.data.formatted ?? transcript.data.text ?? 'Sem transcrição.'}
              </pre>
            ) : (
              <p className="text-xs text-slate-500">Sem transcrição para esta gravação.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Escolha uma gravação na lista para ouvir e ler a transcrição.</p>
        )}
      </Card>
    </div>
  );
}

function Costs() {
  const q = useQuery({ queryKey: ['telephony', 'ai-costs'], queryFn: () => get<any>('/telephony/ai-costs'), retry: false });
  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data ?? {};
  const month = d.currentMonth ?? d.month ?? {};
  const total = d.total ?? d.allTime ?? {};
  const usd = (v: unknown) => (typeof v === 'number' ? `US$ ${v.toFixed(2)}` : null);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Custo de IA no mês" value={usd(month.costUsd ?? month.totalCostUsd) ?? '—'} />
        <Stat label="Chamadas com IA no mês" value={month.calls ?? month.requests ?? '—'} />
        <Stat label="Custo de IA acumulado" value={usd(total.costUsd ?? total.totalCostUsd) ?? '—'} />
      </div>
      <p className="text-xs text-slate-500">
        Custo do modelo de IA informado pelo gateway, em dólar. O custo de telefonia de cada tentativa (em reais) está em Relatórios.
      </p>
    </div>
  );
}

export function TelephonyPage() {
  const [tab, setTab] = useState('live');
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['telephony', 'status'], queryFn: () => get<any>('/telephony/status'), retry: false, refetchInterval: 15000 });
  const s = status.data ?? {};
  const fs = s.freeSwitchCluster ?? s.freeswitch ?? {};
  return (
    <div>
      <PageHeader
        title="Telefonia"
        tooltip="Chamadas do gateway de voz: ao vivo, histórico, gravações e custo de IA. O roteiro e a voz de cada agente ficam em Canais > Agente de voz."
        actions={
          <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => qc.invalidateQueries({ queryKey: ['telephony'] })}>
            Atualizar
          </Button>
        }
      />
      {status.data && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
          <Badge tone={s.status === 'ok' ? 'green' : 'amber'}>{s.status === 'ok' ? 'Gateway no ar' : `Gateway: ${s.status ?? 'desconhecido'}`}</Badge>
          <Badge tone={s.drachtioConnected ? 'green' : 'red'}>SIP {s.drachtioConnected ? 'conectado' : 'desconectado'}</Badge>
          {fs.totalNodes != null && (
            <Badge tone={fs.healthyNodes ? 'green' : 'red'}>
              FreeSWITCH {fs.healthyNodes ?? 0}/{fs.totalNodes} nós
            </Badge>
          )}
        </div>
      )}
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'live', label: 'Ao vivo', content: <LiveCalls /> },
          { value: 'history', label: 'Histórico', content: <History /> },
          { value: 'recordings', label: 'Gravações', content: <Recordings /> },
          { value: 'costs', label: 'Custo de IA', content: <Costs /> },
        ]}
      />
    </div>
  );
}

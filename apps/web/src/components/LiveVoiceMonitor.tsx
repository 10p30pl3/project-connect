import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Pause, Play, Radio, Volume2, VolumeX } from 'lucide-react';
import { API_BASE, getActiveWorkspaceId, getDemoRole, isClientMockActive } from '../lib/api';
import type { LiveCall } from '../pages/telephony/types';
import { Badge, InfoTooltip } from './ui';

export type WaveSample = {
  t: number;
  caller: number;
  agent: number;
};

export type LatencyTurn = {
  atMs: number;
  userEndAt?: number;
  aiStartAt?: number;
  responseMs: number;
  endpointingMs?: number;
  aiTurnaroundMs?: number;
};

export type LatencyStats = {
  lastMs?: number | null;
  avgMs?: number | null;
  p50Ms?: number | null;
  maxMs?: number | null;
  turnsCount?: number;
};

type AudioChannel = 'stereo' | 'caller' | 'agent';

function useIsDarkTheme() {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') === 'dark' : false,
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.getAttribute('data-theme') === 'dark');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function latencyBadgeTone(ms: number | null | undefined): 'green' | 'amber' | 'red' | 'gray' {
  if (ms == null) return 'gray';
  if (ms <= 350) return 'green';
  if (ms <= 750) return 'amber';
  return 'red';
}

export function LiveVoiceMonitor({
  callId,
  call,
  isAdvanced,
}: {
  callId: string;
  call?: LiveCall | null;
  isAdvanced: boolean;
}) {
  const dark = useIsDarkTheme();
  const isMock = isClientMockActive();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef<WaveSample[]>([]);
  const turnsRef = useRef<LatencyTurn[]>([]);

  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<LatencyStats>(() => call?.responseLatency ?? {});
  const [lastTurn, setLastTurn] = useState<LatencyTurn | null>(null);

  const [listening, setListening] = useState(false);
  const [channel, setChannel] = useState<AudioChannel>('stereo');
  const [volume, setVolume] = useState(0.85);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);

  const abortAudioRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // Sincroniza stats iniciais quando vierem do polling do cockpit
  useEffect(() => {
    if (call?.responseLatency) {
      setStats((prev) => ({
        ...prev,
        ...call.responseLatency,
      }));
    }
  }, [call?.responseLatency]);

  // Fluxo SSE real ou simulado (Demo)
  useEffect(() => {
    samplesRef.current = [];
    turnsRef.current = [];
    setLastTurn(null);

    if (isMock) {
      setConnected(true);
      const started = Date.now() - 8000;
      const initSamples: WaveSample[] = [];
      const initTurns: LatencyTurn[] = [];
      let phase = 0;
      for (let i = 0; i < 120; i++) {
        const t = started + i * 60;
        const slot = i % 40;
        const caller = slot < 14 ? 0.15 + Math.abs(Math.sin(i * 0.6)) * 0.55 : 0.02;
        const agent = slot >= 18 && slot < 36 ? 0.18 + Math.abs(Math.cos(i * 0.5)) * 0.62 : 0.02;
        initSamples.push({ t, caller, agent });
        if (slot === 18) {
          const turn: LatencyTurn = {
            atMs: t,
            responseMs: 195 + Math.round(Math.sin(i) * 28),
            endpointingMs: 120,
            aiTurnaroundMs: 75,
          };
          initTurns.push(turn);
          phase = turn.responseMs;
        }
      }
      samplesRef.current = initSamples;
      turnsRef.current = initTurns;
      if (initTurns.length) setLastTurn(initTurns[initTurns.length - 1]);
      setStats({ lastMs: phase || 204, avgMs: 210, p50Ms: 205, maxMs: 238, turnsCount: initTurns.length });

      let tick = 120;
      const timer = window.setInterval(() => {
        tick++;
        const now = Date.now();
        const slot = tick % 44;
        const caller = slot < 16 ? 0.14 + Math.random() * 0.62 : 0.015 + Math.random() * 0.02;
        const agent = slot >= 20 && slot < 39 ? 0.16 + Math.random() * 0.68 : 0.015 + Math.random() * 0.02;
        samplesRef.current.push({ t: now, caller, agent });
        if (samplesRef.current.length > 220) samplesRef.current.shift();

        if (slot === 20) {
          const endpointingMs = 110 + Math.round(Math.random() * 40);
          const aiTurnaroundMs = 70 + Math.round(Math.random() * 55);
          const responseMs = endpointingMs + aiTurnaroundMs;
          const turn: LatencyTurn = { atMs: now, responseMs, endpointingMs, aiTurnaroundMs };
          turnsRef.current.push(turn);
          if (turnsRef.current.length > 40) turnsRef.current.shift();
          setLastTurn(turn);
          setStats((prev) => {
            const count = (prev.turnsCount ?? 0) + 1;
            const avg = prev.avgMs ? Math.round((prev.avgMs * (count - 1) + responseMs) / count) : responseMs;
            return {
              lastMs: responseMs,
              avgMs: avg,
              p50Ms: avg,
              maxMs: Math.max(prev.maxMs ?? 0, responseMs),
              turnsCount: count,
            };
          });
        }
      }, 65);
      return () => window.clearInterval(timer);
    }

    const ac = new AbortController();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const demoRole = getDemoRole();
    if (demoRole) headers['X-Demo-Role'] = demoRole;
    const ws = getActiveWorkspaceId();
    if (ws) headers['X-Workspace-Id'] = ws;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/telephony/calls/${encodeURIComponent(callId)}/monitor/events`, {
          headers,
          credentials: 'include',
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          setConnected(false);
          return;
        }
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = 'message';

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            if (!line) {
              currentEvent = 'message';
              continue;
            }
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
              continue;
            }
            if (line.startsWith('data:')) {
              const rawJson = line.slice(5).trim();
              if (!rawJson) continue;
              try {
                const payload = JSON.parse(rawJson);
                if (currentEvent === 'init') {
                  if (Array.isArray(payload.samples)) {
                    samplesRef.current = payload.samples.slice(-220);
                  }
                  if (Array.isArray(payload.latencyHistory)) {
                    turnsRef.current = payload.latencyHistory.slice(-40);
                    if (turnsRef.current.length) {
                      setLastTurn(turnsRef.current[turnsRef.current.length - 1]);
                    }
                  }
                  if (payload.stats) setStats(payload.stats);
                } else if (currentEvent === 'wave_sample') {
                  samplesRef.current.push(payload);
                  if (samplesRef.current.length > 220) samplesRef.current.shift();
                } else if (currentEvent === 'latency_turn') {
                  turnsRef.current.push(payload);
                  if (turnsRef.current.length > 40) turnsRef.current.shift();
                  setLastTurn(payload);
                  if (payload.stats) setStats(payload.stats);
                }
              } catch {
                // ignora evento malformado
              }
            }
          }
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [callId, isMock]);

  // Renderização contínua em Canvas 60fps respeitando Light / Dark
  useEffect(() => {
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(320, Math.floor(rect.width));
        const h = 148;
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);

          const bg = dark ? '#0b1222' : '#f8fafc';
          const grid = dark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)';
          const centerLine = dark ? 'rgba(148,163,184,0.32)' : 'rgba(15,23,42,0.18)';
          const callerBar = dark ? '#38bdf8' : '#0284c7';
          const aiBar = dark ? '#f60151' : '#c2003f';
          const markerColor = dark ? '#fb923c' : '#ea580c';
          const labelBg = dark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.95)';
          const mutedText = dark ? '#94a3b8' : '#64748b';

          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);

          // Linhas guia
          ctx.strokeStyle = grid;
          ctx.lineWidth = 1;
          for (const yFrac of [0.25, 0.75]) {
            ctx.beginPath();
            ctx.moveTo(0, h * yFrac);
            ctx.lineTo(w, h * yFrac);
            ctx.stroke();
          }

          const midY = h / 2;
          ctx.strokeStyle = centerLine;
          ctx.beginPath();
          ctx.moveTo(0, midY);
          ctx.lineTo(w, midY);
          ctx.stroke();

          // Rótulos laterais dos canais
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.fillStyle = callerBar;
          ctx.fillText('CLIENTE (↑)', 8, 14);
          ctx.fillStyle = aiBar;
          ctx.fillText('AGENTE IA (↓)', 8, h - 8);

          const samples = samplesRef.current;
          const visibleCount = Math.min(180, Math.max(80, Math.floor(w / 4)));
          const slice = samples.slice(-visibleCount);
          const barSlot = w / visibleCount;
          const barWidth = Math.max(1.8, barSlot * 0.62);
          const maxAmp = midY - 18;

          if (slice.length > 0) {
            const tStart = slice[0].t;
            const tEnd = Math.max(slice[slice.length - 1].t, tStart + 1);

            for (let i = 0; i < slice.length; i++) {
              const s = slice[i];
              const x = (visibleCount - slice.length + i) * barSlot;

              const cAmp = Math.max(1.5, Math.min(1, s.caller) * maxAmp);
              ctx.fillStyle = callerBar;
              ctx.fillRect(x, midY - cAmp - 1, barWidth, cAmp);

              const aAmp = Math.max(1.5, Math.min(1, s.agent) * maxAmp);
              ctx.fillStyle = aiBar;
              ctx.fillRect(x, midY + 1, barWidth, aAmp);
            }

            // Marcadores verticais de tempo de resposta (ex.: 200 ms)
            for (const turn of turnsRef.current) {
              if (turn.atMs < tStart || turn.atMs > tEnd + 120) continue;
              const idxRatio = (turn.atMs - tStart) / Math.max(1, tEnd - tStart);
              const xEnd = ((visibleCount - slice.length) + idxRatio * (slice.length - 1)) * barSlot;
              const gapPx = Math.min(24, Math.max(6, Math.round(turn.responseMs / 35)));
              const xStart = Math.max(0, xEnd - gapPx);

              ctx.strokeStyle = markerColor;
              ctx.lineWidth = 1.25;
              ctx.beginPath();
              ctx.moveTo(xStart, 18);
              ctx.lineTo(xStart, h - 14);
              ctx.moveTo(xEnd, 18);
              ctx.lineTo(xEnd, h - 14);
              ctx.stroke();

              const badgeText = `${turn.responseMs} ms`;
              ctx.font = '700 11px Inter, system-ui, sans-serif';
              const tw = ctx.measureText(badgeText).width + 10;
              const bx = Math.min(w - tw - 4, Math.max(4, (xStart + xEnd) / 2 - tw / 2));
              ctx.fillStyle = labelBg;
              ctx.fillRect(bx, 4, tw, 18);
              ctx.strokeStyle = markerColor;
              ctx.strokeRect(bx, 4, tw, 18);
              ctx.fillStyle = markerColor;
              ctx.fillText(badgeText, bx + 5, 17);
            }
          } else {
            ctx.fillStyle = mutedText;
            ctx.font = '500 12px Inter, system-ui, sans-serif';
            ctx.fillText('Aguardando pacotes de áudio da ligação…', w / 2 - 115, midY - 6);
          }

          ctx.restore();
        }
      }
      raf = window.requestAnimationFrame(render);
    };
    raf = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(raf);
  }, [dark]);

  // Controle de volume
  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = volume;
    }
  }, [volume]);

  // Parar escuta ao desmontar ou trocar callId
  const stopListening = () => {
    abortAudioRef.current?.abort();
    abortAudioRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    gainRef.current = null;
    setListening(false);
    setAudioStatus(null);
  };

  useEffect(() => () => stopListening(), [callId]);

  async function startListening(selectedChannel: AudioChannel = channel) {
    stopListening();
    if (isMock) {
      setListening(true);
      setAudioStatus('Modo demonstração (waveform ativo; áudio SIP requer gateway ativo)');
      return;
    }

    const ac = new AbortController();
    abortAudioRef.current = ac;
    setListening(true);
    setAudioStatus('Conectando fluxo de áudio…');

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 8000 });
      await ctx.resume();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainRef.current = gain;

      const headers: Record<string, string> = {};
      const demoRole = getDemoRole();
      if (demoRole) headers['X-Demo-Role'] = demoRole;
      const ws = getActiveWorkspaceId();
      if (ws) headers['X-Workspace-Id'] = ws;

      const res = await fetch(
        `${API_BASE}/telephony/calls/${encodeURIComponent(callId)}/monitor/audio?channel=${selectedChannel}`,
        { headers, credentials: 'include', signal: ac.signal },
      );
      if (!res.ok || !res.body) {
        setAudioStatus('Stream de áudio indisponível para esta ligação.');
        setListening(false);
        return;
      }

      setAudioStatus(`Escutando ao vivo (${selectedChannel === 'stereo' ? 'Estéreo' : selectedChannel === 'caller' ? 'Cliente' : 'Agente IA'})`);
      const numChannels = selectedChannel === 'stereo' ? 2 : 1;
      const frameBytes = numChannels * 2;
      const reader = res.body.getReader();
      let leftover = new Uint8Array(0);
      let nextTime = ctx.currentTime + 0.08;

      while (!ac.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        const combined = new Uint8Array(leftover.length + value.length);
        combined.set(leftover, 0);
        combined.set(value, leftover.length);

        const usableLen = combined.length - (combined.length % frameBytes);
        leftover = combined.slice(usableLen);
        if (usableLen <= 0) continue;

        const frameCount = usableLen / frameBytes;
        const buffer = ctx.createBuffer(numChannels, frameCount, 8000);
        const view = new DataView(combined.buffer, combined.byteOffset, usableLen);

        if (numChannels === 2) {
          const ch0 = buffer.getChannelData(0);
          const ch1 = buffer.getChannelData(1);
          for (let i = 0; i < frameCount; i++) {
            ch0[i] = view.getInt16(i * 4, true) / 32768;
            ch1[i] = view.getInt16(i * 4 + 2, true) / 32768;
          }
        } else {
          const ch0 = buffer.getChannelData(0);
          for (let i = 0; i < frameCount; i++) {
            ch0[i] = view.getInt16(i * 2, true) / 32768;
          }
        }

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(gain);
        const now = ctx.currentTime;
        if (nextTime < now) nextTime = now + 0.03;
        src.start(nextTime);
        nextTime += buffer.duration;
      }
    } catch {
      if (!ac.signal.aborted) {
        setAudioStatus('Escuta encerrada.');
        setListening(false);
      }
    }
  }

  const lastMs = stats.lastMs ?? lastTurn?.responseMs ?? null;
  const avgMs = stats.avgMs ?? null;
  const p50Ms = stats.p50Ms ?? null;
  const maxMs = stats.maxMs ?? null;

  const channelLabel = useMemo(
    () => (channel === 'stereo' ? 'Estéreo (Cliente + IA)' : channel === 'caller' ? 'Somente Cliente' : 'Somente Agente IA'),
    [channel],
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-brand-700" aria-hidden />
          <span className="text-sm font-semibold text-slate-900">Monitor de Voz &amp; Latência em Tempo Real</span>
          <InfoTooltip content="Exibe em tempo real o áudio do Cliente (topo) e do Agente IA (base) com o tempo exato de resposta (ms) a cada turno de fala." />
          <Badge tone={connected ? 'green' : 'gray'}>
            <Radio className="mr-1 size-3 inline" aria-hidden />
            {connected ? 'Ao vivo' : 'Conectando…'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone={latencyBadgeTone(lastMs)}>
            Última resp.: <strong>{lastMs != null ? `${lastMs} ms` : '—'}</strong>
          </Badge>
          {avgMs != null && (
            <Badge tone="gray">
              Média: <strong>{avgMs} ms</strong>
            </Badge>
          )}
          {isAdvanced && p50Ms != null && (
            <Badge tone="gray">
              P50: <strong>{p50Ms} ms</strong>
            </Badge>
          )}
          {isAdvanced && maxMs != null && (
            <Badge tone="gray">
              Pico: <strong>{maxMs} ms</strong>
            </Badge>
          )}
        </div>
      </div>

      {/* Waveform Dual-Track */}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <canvas ref={canvasRef} className="block w-full h-[148px]" aria-label="Osciloscópio de voz em tempo real Cliente vs Agente IA" />
      </div>

      {/* Barra de reprodução de áudio + Breakdown avançado */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (listening ? stopListening() : startListening(channel))}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              listening
                ? 'bg-brand-700 text-white hover:bg-brand-800'
                : 'border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
            }`}
          >
            {listening ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {listening ? 'Silenciar escuta' : 'Ouvir ao Vivo'}
          </button>

          {isAdvanced && (
            <select
              aria-label="Canal da escuta ao vivo"
              value={channel}
              onChange={(e) => {
                const next = e.target.value as AudioChannel;
                setChannel(next);
                if (listening) startListening(next);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            >
              <option value="stereo">Estéreo (Cliente + IA)</option>
              <option value="caller">Somente Cliente</option>
              <option value="agent">Somente Agente IA</option>
            </select>
          )}

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            {volume === 0 ? <VolumeX className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
            <input
              type="range"
              aria-label="Volume da escuta ao vivo"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-20 accent-brand-700"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          {audioStatus ? (
            <span>{audioStatus}</span>
          ) : (
            <span>Canal selecionado: {channelLabel}</span>
          )}
          {isAdvanced && lastTurn && (
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700">
              Endpointing {lastTurn.endpointingMs ?? '—'}ms · IA {lastTurn.aiTurnaroundMs ?? '—'}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

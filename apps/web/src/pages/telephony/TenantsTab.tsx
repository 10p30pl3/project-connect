import { useState } from 'react';
import { OPENAI_ENGINE_MODELS, defaultOpenAiModel } from '@voll/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronUp, Edit, PhoneOutgoing, Plus, RotateCcw, Trash2, Volume2 } from 'lucide-react';
import { API_BASE, del, errorMessage, get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useExperienceMode } from '../../lib/experience-mode';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Empty,
  Field,
  InfoTooltip,
  Input,
  Loading,
  Modal,
  Select,
  TableWrap,
  Textarea,
  useToast,
} from '../../components/ui';
import { GatewayError, type StsEngine, type TenantConfig, type VoiceAgentUsageSummary } from './types';

const DEFAULT_PROMPT =
  'Você é o assistente virtual oficial da Voll Solutions. Seja cordial, claro e objetivo. Responda em português do Brasil com frases naturais e curtas adequadas a uma ligação telefônica.';

const DEFAULT_GREETING =
  "Diga cordialmente de forma curta e amigável: 'Olá! Sou o assistente virtual da Voll Solutions. Como posso ajudar você hoje?'";

const OPENAI_VOICES: { id: string; label: string; style: string; pitch: number; rate: number }[] = [
  { id: 'marin', label: 'Marin', style: 'Feminina · Natural & Profissional (Padrão)', pitch: 1.08, rate: 1.0 },
  { id: 'cedar', label: 'Cedar', style: 'Masculina · Calma & Assertiva', pitch: 0.9, rate: 0.98 },
  { id: 'alloy', label: 'Alloy', style: 'Neutra · Versátil & Equilibrada', pitch: 1.0, rate: 1.02 },
  { id: 'coral', label: 'Coral', style: 'Feminina · Acolhedora & Empática', pitch: 1.12, rate: 0.98 },
  { id: 'sage', label: 'Sage', style: 'Feminina · Clara & Didática', pitch: 1.05, rate: 1.0 },
  { id: 'shimmer', label: 'Shimmer', style: 'Feminina · Expressiva & Dinâmica', pitch: 1.15, rate: 1.04 },
  { id: 'ash', label: 'Ash', style: 'Masculina · Direta & Executiva', pitch: 0.88, rate: 1.02 },
  { id: 'ballad', label: 'Ballad', style: 'Masculina · Suave & Conversacional', pitch: 0.94, rate: 0.96 },
  { id: 'echo', label: 'Echo', style: 'Masculina · Tradicional & Firme', pitch: 0.86, rate: 1.0 },
  { id: 'verse', label: 'Verse', style: 'Masculina · Jovem & Energética', pitch: 0.96, rate: 1.05 },
];

const ELEVENLABS_MODELS = [
  { id: 'eleven_turbo_v2_5', label: 'eleven_turbo_v2_5 (Rápido & Multilíngue)' },
  { id: 'eleven_flash_v2_5', label: 'eleven_flash_v2_5 (Latência Mínima)' },
  { id: 'eleven_multilingual_v2', label: 'eleven_multilingual_v2 (Alta Expressividade)' },
  { id: 'eleven_turbo_v2', label: 'eleven_turbo_v2 (Legado)' },
];

const ELEVENLABS_VOICES: { id: string; apiId: string; label: string; style: string; pitch: number; rate: number }[] = [
  { id: 'Rachel', apiId: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', style: 'Feminina · Natural & Calma', pitch: 1.06, rate: 1.0 },
  { id: 'Adam', apiId: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', style: 'Masculina · Profissional & Firme', pitch: 0.88, rate: 0.98 },
  { id: 'Bella', apiId: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella', style: 'Feminina · Acolhedora & Suave', pitch: 1.12, rate: 0.98 },
  { id: 'Antoni', apiId: 'ErXwobaYiN019PkySvjV', label: 'Antoni', style: 'Masculina · Dinâmica & Clara', pitch: 0.94, rate: 1.02 },
  { id: 'Domi', apiId: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi', style: 'Feminina · Assertiva & Executiva', pitch: 1.04, rate: 1.02 },
  { id: 'Josh', apiId: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh', style: 'Masculina · Jovem & Conversacional', pitch: 0.96, rate: 1.04 },
  { id: 'Arnold', apiId: 'VR6AewLTigWG4xSOukaG', label: 'Arnold', style: 'Masculina · Grave & Autoritária', pitch: 0.84, rate: 0.96 },
  { id: 'Sam', apiId: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam', style: 'Masculina · Neutra & Equilibrada', pitch: 0.92, rate: 1.0 },
];

let activeSampleAudio: HTMLAudioElement | null = null;

async function previewVoiceSample(
  voiceLabel: string,
  style: string,
  pitch = 1,
  rate = 1,
  opts?: {
    engine?: StsEngine;
    voiceId?: string;
    model?: string;
    speed?: number;
    stability?: number;
    similarityBoost?: number;
    optimizeLatency?: number;
  },
) {
  const engine = opts?.engine ?? 'openai';
  const voiceId = (opts?.voiceId || voiceLabel).trim();
  const effectiveSpeed = opts?.speed ?? rate;
  const sampleText = `Olá! Eu sou a voz ${voiceLabel} da Voll Solutions. ${style.split('·')[0].trim()} para atendimento telefônico.`;

  try {
    if (activeSampleAudio) {
      activeSampleAudio.pause();
      activeSampleAudio = null;
    }
    const res = await fetch(`${API_BASE}/telephony/voice-preview`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine,
        voice: engine === 'elevenlabs' ? voiceId : voiceId.toLowerCase(),
        model: opts?.model,
        speed: effectiveSpeed,
        stability: opts?.stability,
        similarityBoost: opts?.similarityBoost,
        optimizeLatency: opts?.optimizeLatency,
        text: sampleText,
      }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeSampleAudio = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      return;
    }
  } catch {
    // fallback para Web Speech API caso TTS remoto não esteja disponível
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(sampleText);
    utt.lang = 'pt-BR';
    utt.pitch = Math.max(0.5, Math.min(1.6, pitch));
    utt.rate = Math.max(0.75, Math.min(1.3, rate));
    window.speechSynthesis.speak(utt);
  } catch {
    // ignore speech synthesis blocked
  }
}

type TenantForm = {
  id: string;
  name: string;
  extension: string;
  dids: string;
  stsEngine: StsEngine;
  voice: string;
  openaiModel: string;
  openaiPromptId: string;
  openaiVadType: 'server_vad' | 'semantic_vad';
  openaiVadEagerness: 'low' | 'medium' | 'high' | 'auto';
  openaiTemperature: number;
  openaiSpeed: number;
  openaiMaxOutputTokens: string;
  openaiTranscriptionModel: 'whisper-1' | 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe';
  openaiTranscriptionLanguage: 'pt' | 'en' | 'es' | 'auto';
  openaiInterruptResponse: boolean;
  vadThreshold: number;
  prefixPaddingMs: number;
  silenceDurationMs: number;
  elevenlabsAgentId: string;
  elevenlabsModel: string;
  elevenlabsVoiceId: string;
  elevenlabsStability: number;
  elevenlabsSimilarityBoost: number;
  elevenlabsSpeed: number;
  elevenlabsOptimizeLatency: number;
  greetingInstructions: string;
  instructions: string;
  maxConcurrentCalls: number;
  maxCallsPerSecond: number;
  maxDurationSec: number;
  bargeinGraceSec: string;
  bargeinLevel: string;
  audioCodec: string;
  dtmfDebounceMs: number;
  active: boolean;
  amdEnabled: boolean;
  amdMode: 'active' | 'shadow';
  sttEnabled: boolean;
  crosstalkMode: string;
  crosstalkRatio: number;
  crosstalkThreshold: string;
};

function normalizeEngine(raw?: string | null): StsEngine {
  if (raw === 'elevenlabs') return 'elevenlabs';
  if (raw === 'openai_live') return 'openai_live';
  return 'openai';
}

function toForm(t?: TenantConfig | null): TenantForm {
  const stsEngine = normalizeEngine(t?.stsEngine);
  return {
    id: t?.id ?? '',
    name: t?.name ?? '',
    extension: t?.extension ?? '',
    dids: (t?.dids ?? ['*']).join(', '),
    stsEngine,
    voice: t?.voice ?? 'marin',
    openaiModel: t?.openaiModel?.trim() || defaultOpenAiModel(stsEngine),
    openaiPromptId: t?.openaiPromptId ?? '',
    openaiVadType: t?.openaiVadType ?? (stsEngine === 'openai_live' ? 'semantic_vad' : 'server_vad'),
    openaiVadEagerness: t?.openaiVadEagerness ?? 'medium',
    openaiTemperature: t?.openaiTemperature ?? 0.8,
    openaiSpeed: t?.openaiSpeed ?? 1.0,
    openaiMaxOutputTokens: t?.openaiMaxOutputTokens != null ? String(t.openaiMaxOutputTokens) : '',
    openaiTranscriptionModel: t?.openaiTranscriptionModel ?? 'whisper-1',
    openaiTranscriptionLanguage: t?.openaiTranscriptionLanguage ?? 'pt',
    openaiInterruptResponse: t?.openaiInterruptResponse !== false,
    vadThreshold: t?.vadThreshold ?? 0.45,
    prefixPaddingMs: t?.prefixPaddingMs ?? 160,
    silenceDurationMs: t?.silenceDurationMs ?? 280,
    elevenlabsAgentId: t?.elevenlabsAgentId ?? '',
    elevenlabsModel: t?.elevenlabsModel ?? 'eleven_turbo_v2_5',
    elevenlabsVoiceId: t?.elevenlabsVoiceId ?? 'Rachel',
    elevenlabsStability: t?.elevenlabsStability ?? 0.5,
    elevenlabsSimilarityBoost: t?.elevenlabsSimilarityBoost ?? 0.75,
    elevenlabsSpeed: t?.elevenlabsSpeed ?? 1.0,
    elevenlabsOptimizeLatency: t?.elevenlabsOptimizeLatency ?? 3,
    greetingInstructions: t?.greetingInstructions ?? DEFAULT_GREETING,
    instructions: t?.instructions ?? DEFAULT_PROMPT,
    maxConcurrentCalls: t?.maxConcurrentCalls ?? 200,
    maxCallsPerSecond: t?.maxCallsPerSecond ?? 30,
    maxDurationSec: t?.maxDurationSec ?? 180,
    bargeinGraceSec: t?.bargeinGraceSec != null ? String(t.bargeinGraceSec) : '',
    bargeinLevel: t?.bargeinLevel != null ? String(t.bargeinLevel) : '',
    audioCodec: t?.audioCodec ?? 'pcmu',
    dtmfDebounceMs: t?.dtmf?.debounceMs ?? 1200,
    active: t?.active !== false,
    amdEnabled: Boolean(t?.amd?.enabled),
    amdMode: t?.amd?.mode === 'shadow' ? 'shadow' : 'active',
    sttEnabled: t?.stt?.enabled !== false,
    crosstalkMode: t?.crosstalkFilter?.mode ?? t?.crosstalkMode ?? 'atual',
    crosstalkRatio: t?.crosstalkFilter?.ratio ?? 0.45,
    crosstalkThreshold: t?.crosstalkFilter?.threshold != null ? String(t.crosstalkFilter.threshold) : '',
  };
}

export function TenantsTab({ onTestTenant }: { onTestTenant: (tenantId: string) => void }) {
  const { can } = useAuth();
  const { mode, isAtLeast } = useExperienceMode();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('connections.write');

  const [editing, setEditing] = useState<{ isNew: boolean; idManual: boolean; form: TenantForm } | null>(null);
  const [showDsp, setShowDsp] = useState(false);
  const [deleting, setDeleting] = useState<TenantConfig | null>(null);

  const q = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ count: number; tenants: TenantConfig[] }>('/telephony/tenants'),
    retry: false,
  });

  const usagesQ = useQuery({
    queryKey: ['telephony', 'tenants', 'usages'],
    queryFn: () => get<{ items: Record<string, VoiceAgentUsageSummary> }>('/telephony/tenants/usages'),
    retry: false,
  });

  const saveM = useMutation({
    mutationFn: ({ isNew, form }: { isNew: boolean; form: TenantForm }) => {
      const payload = {
        id: form.id.trim(),
        name: form.name.trim() || form.id.trim(),
        extension: form.extension.trim() || null,
        dids: form.dids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        stsEngine: form.stsEngine,
        voice: form.voice,
        openaiModel: form.openaiModel,
        openaiPromptId: form.openaiPromptId.trim() || null,
        openaiVadType: form.openaiVadType,
        openaiVadEagerness: form.openaiVadEagerness,
        openaiTemperature: Number(form.openaiTemperature) || 0.8,
        openaiSpeed: Number(form.openaiSpeed) || 1.0,
        openaiMaxOutputTokens: form.openaiMaxOutputTokens.trim() ? Number(form.openaiMaxOutputTokens) : null,
        openaiTranscriptionModel: form.openaiTranscriptionModel,
        openaiTranscriptionLanguage: form.openaiTranscriptionLanguage,
        openaiInterruptResponse: form.openaiInterruptResponse,
        vadThreshold: Number(form.vadThreshold) || 0.45,
        prefixPaddingMs: Number(form.prefixPaddingMs) || 160,
        silenceDurationMs: Number(form.silenceDurationMs) || 280,
        elevenlabsAgentId: form.elevenlabsAgentId.trim() || null,
        elevenlabsModel: form.elevenlabsModel,
        elevenlabsVoiceId: form.elevenlabsVoiceId,
        elevenlabsStability: Number(form.elevenlabsStability),
        elevenlabsSimilarityBoost: Number(form.elevenlabsSimilarityBoost),
        elevenlabsSpeed: Number(form.elevenlabsSpeed) || 1.0,
        elevenlabsOptimizeLatency: Number(form.elevenlabsOptimizeLatency),
        greetingInstructions: form.greetingInstructions.trim() || null,
        instructions: form.instructions.trim(),
        maxConcurrentCalls: Number(form.maxConcurrentCalls) || 200,
        maxCallsPerSecond: Number(form.maxCallsPerSecond) || 30,
        maxDurationSec: Number(form.maxDurationSec) || 180,
        ...(form.bargeinGraceSec.trim() !== '' ? { bargeinGraceSec: Number(form.bargeinGraceSec) } : { bargeinGraceSec: null }),
        ...(form.bargeinLevel.trim() !== '' ? { bargeinLevel: Number(form.bargeinLevel) } : {}),
        audioCodec: form.audioCodec || 'pcmu',
        dtmf: { enabled: true, debounceMs: Number(form.dtmfDebounceMs) || 1200 },
        active: form.active,
        amd: { enabled: form.amdEnabled, mode: form.amdMode },
        stt: { enabled: form.sttEnabled },
        crosstalkFilter: {
          mode: form.crosstalkMode,
          ratio: Number(form.crosstalkRatio) || 0.45,
          threshold: form.crosstalkThreshold.trim() === '' ? null : Number(form.crosstalkThreshold),
        },
      };
      if (!payload.dids.length) payload.dids = ['*'];
      return isNew
        ? post('/telephony/tenants', payload)
        : put(`/telephony/tenants/${encodeURIComponent(payload.id)}`, payload);
    },
    onSuccess: () => {
      toast('success', 'Agente salvo com hot-reload ativo no cluster local!');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'tenants'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const delM = useMutation({
    mutationFn: (id: string) => del(`/telephony/tenants/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast('success', 'Agente removido com sucesso.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'tenants'] });
      qc.invalidateQueries({ queryKey: ['telephony', 'tenants', 'usages'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;

  const tenants = q.data?.tenants ?? [];
  const usagesMap = usagesQ.data?.items ?? {};
  const deletingUsage = deleting ? usagesMap[deleting.id] : undefined;

  return (
    <div className="space-y-4">
      <Card
        title={
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-brand-700" aria-hidden />
            <span>Agentes de Voz ({tenants.length})</span>
          </div>
        }
        tooltip="Cada Agente de Voz possui motor STS (OpenAI Realtime ou ElevenLabs), prompt, filtros acústicos e limites próprios, podendo ser reutilizado por Canais, Rotas e Campanhas."
        actions={
          canManage && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => setEditing({ isNew: true, idManual: false, form: toForm(null) })}
            >
              Novo Agente
            </Button>
          )
        }
        padded={false}
      >
        {!tenants.length ? (
          <div className="p-6"><Empty title="Nenhum agente de voz configurado" /></div>
        ) : (
          <TableWrap label="Agentes de Voz">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>{mode === 'basic' ? 'Agente' : 'Agente / ID'}</th>
                  <th>Motor STS &amp; Voz</th>
                  <th>Ramal Interno</th>
                  {isAtLeast('advanced') && <th>Ramal / DIDs</th>}
                  {isAtLeast('advanced') && <th>Pipeline (AMD/STT/Crosstalk)</th>}
                  <th>{mode === 'basic' ? 'Duração Máx.' : 'Limites'}</th>
                  <th>Vínculos Ativos</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const eng = normalizeEngine(t.stsEngine);
                  const isEleven = eng === 'elevenlabs';
                  const isLive = eng === 'openai_live';
                  const usage = usagesMap[t.id];
                  const usageTooltip = usage && usage.totalReferences > 0
                    ? [
                        usage.channels.length ? `Canais: ${usage.channels.map((c) => c.name).join(', ')}` : null,
                        usage.routes.length ? `Rotas: ${usage.routes.map((r) => r.name).join(', ')}` : null,
                        usage.campaigns.length ? `Campanhas: ${usage.campaigns.map((c) => c.name).join(', ')}` : null,
                        usage.templates.length ? `Modelos: ${usage.templates.map((tp) => tp.name).join(', ')}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Sem vínculos diretos no momento (disponível para reutilização).';
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="font-semibold text-xs text-slate-900">{t.name || t.id}</div>
                        {isAtLeast('advanced') && <div className="font-mono text-[11px] text-slate-500">{t.id}</div>}
                      </td>
                      <td className="text-xs">
                        <Badge tone={isEleven ? 'blue' : isLive ? 'green' : 'brand'}>
                          {isEleven ? 'ElevenLabs STS' : isLive ? 'OpenAI Live' : 'OpenAI Realtime'}
                        </Badge>
                        <div className="mt-1 text-[11px] text-slate-600">
                          {isEleven
                            ? `${t.elevenlabsVoiceId || 'Rachel'} · ${t.elevenlabsModel || 'turbo_v2_5'}`
                            : `${t.voice || 'marin'} · ${t.openaiModel || 'gpt-realtime-mini'}`}
                        </div>
                      </td>
                      <td className="text-xs">
                        <span className="font-mono font-semibold text-slate-800">
                          {t.extension || (t.id === 'default' ? '9000' : '—')}
                        </span>
                      </td>
                      {isAtLeast('advanced') && (
                        <td className="text-xs">
                          <div className="font-mono font-semibold text-slate-800">
                            Ramal: {t.extension || (t.id === 'default' ? '9000' : '—')}
                          </div>
                          <div className="text-[11px] text-slate-500">DIDs: {(t.dids ?? ['*']).join(', ')}</div>
                        </td>
                      )}
                      {isAtLeast('advanced') && (
                        <td className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={t.amd?.enabled ? 'green' : 'gray'}>
                              AMD {t.amd?.enabled ? (t.amd?.mode === 'shadow' ? 'SHADOW' : 'ON') : 'OFF'}
                            </Badge>
                            <Badge tone={t.stt?.enabled !== false ? 'green' : 'gray'}>STT {t.stt?.enabled !== false ? 'ON' : 'OFF'}</Badge>
                            <Badge tone="brand">{t.crosstalkFilter?.mode || t.crosstalkMode || 'atual'}</Badge>
                          </div>
                        </td>
                      )}
                      <td className="text-xs text-slate-600 tabular-nums">
                        {isAtLeast('advanced') && <div>{t.maxConcurrentCalls ?? 200} sessões</div>}
                        <div>Cap: {t.maxDurationSec ?? 180}s</div>
                      </td>
                      <td className="text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {usage && usage.totalReferences > 0 ? (
                            <>
                              {usage.channels.length > 0 && <Badge tone="brand">{usage.channels.length} canal(is)</Badge>}
                              {usage.routes.length > 0 && <Badge tone="blue">{usage.routes.length} rota(s)</Badge>}
                              {usage.campaigns.length > 0 && <Badge tone="amber">{usage.campaigns.length} camp.</Badge>}
                              {usage.templates.length > 0 && <Badge tone="gray">{usage.templates.length} mod.</Badge>}
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-400">Sem vínculo</span>
                          )}
                          <InfoTooltip content={usageTooltip} />
                        </div>
                      </td>
                      <td>
                        <Badge tone={t.active !== false ? 'green' : 'red'}>
                          {t.active !== false ? 'Ativo' : 'Pausado'}
                        </Badge>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            title="Testar agente em chamada real"
                            icon={<PhoneOutgoing className="size-3.5" aria-hidden />}
                            onClick={() => onTestTenant(t.id)}
                          >
                            Testar
                          </Button>
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={<Edit className="size-3.5" aria-hidden />}
                                onClick={() => setEditing({ isNew: false, idManual: true, form: toForm(t) })}
                                title="Editar agente"
                              >
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={t.id === 'default'}
                                title={t.id === 'default' ? 'O agente padrão do gateway não pode ser excluído' : 'Excluir agente'}
                                aria-label="Excluir agente"
                                className="text-red-600 hover:bg-red-50"
                                icon={<Trash2 className="size-3.5" aria-hidden />}
                                onClick={() => setDeleting(t)}
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* Modal Editor de Tenant */}
      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.isNew ? 'Novo Agente de Voz' : `Editar Agente: ${editing?.form.id}`}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={saveM.isPending}
              disabled={!editing?.form.id.trim()}
              onClick={() => editing && saveM.mutate(editing)}
            >
              Salvar Agente (Hot-Reload)
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {/* Camada Essencial */}
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Nome de Exibição" required>
                {(f) => (
                  <Input
                    id={f.id}
                    value={editing.form.name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      const slug = nextName
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/(^-|-$)/g, '');
                      setEditing({
                        ...editing,
                        form: {
                          ...editing.form,
                          name: nextName,
                          id: editing.isNew && !editing.idManual ? slug : editing.form.id,
                        },
                      });
                    }}
                    placeholder="Agente Voll Atendimento"
                  />
                )}
              </Field>
              <Field label="ID do Agente" required>
                {(f) => (
                  <Input
                    id={f.id}
                    disabled={!editing.isNew}
                    value={editing.form.id}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        idManual: e.target.value.trim().length > 0,
                        form: { ...editing.form, id: e.target.value },
                      })
                    }
                    placeholder="ex: vendas-vip"
                  />
                )}
              </Field>
              <Field label="Motor de IA Conversacional (STS Engine)">
                {(f) => (
                  <Select
                    id={f.id}
                    value={editing.form.stsEngine}
                    onChange={(e) => {
                      const nextEngine = e.target.value as StsEngine;
                      const prevEngine = editing.form.stsEngine;
                      let nextVadType = editing.form.openaiVadType;
                      let nextModel = editing.form.openaiModel;
                      if (nextEngine === 'openai_live' && prevEngine !== 'openai_live') {
                        if (editing.form.openaiVadType === 'server_vad') nextVadType = 'semantic_vad';
                        nextModel = defaultOpenAiModel('openai_live');
                      } else if (nextEngine === 'openai' && prevEngine === 'openai_live') {
                        if (editing.form.openaiVadType === 'semantic_vad') nextVadType = 'server_vad';
                        nextModel = defaultOpenAiModel('openai');
                      }
                      setEditing({
                        ...editing,
                        form: {
                          ...editing.form,
                          stsEngine: nextEngine,
                          openaiVadType: nextVadType,
                          openaiModel: nextModel,
                        },
                      });
                    }}
                  >
                    <option value="openai">OpenAI Realtime API</option>
                    <option value="openai_live">OpenAI Live API</option>
                    <option value="elevenlabs">ElevenLabs Conversational AI (STS)</option>
                  </Select>
                )}
              </Field>
              <Field label="Ramal Interno (ex: 9000)">
                {(f) => (
                  <Input
                    id={f.id}
                    value={editing.form.extension}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, extension: e.target.value } })}
                    placeholder="9000"
                  />
                )}
              </Field>
            </div>

            {editing.form.stsEngine !== 'elevenlabs' ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Modelo OpenAI">
                    {(f) => {
                      const catalog =
                        editing.form.stsEngine === 'openai_live'
                          ? OPENAI_ENGINE_MODELS.openai_live
                          : OPENAI_ENGINE_MODELS.openai;
                      const hasSavedLegacy =
                        Boolean(editing.form.openaiModel) &&
                        !catalog.options.some((o) => o.id === editing.form.openaiModel);
                      return (
                        <Select
                          id={f.id}
                          value={editing.form.openaiModel || catalog.default}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, openaiModel: e.target.value } })}
                        >
                          {hasSavedLegacy && (
                            <option value={editing.form.openaiModel}>{editing.form.openaiModel} (legado)</option>
                          )}
                          {catalog.options.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </Select>
                      );
                    }}
                  </Field>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<Volume2 className="size-3.5" aria-hidden />}
                      onClick={() => {
                        const v = OPENAI_VOICES.find((item) => item.id === editing.form.voice) ?? OPENAI_VOICES[0];
                        previewVoiceSample(v.label, v.style, v.pitch, v.rate);
                      }}
                    >
                      Ouvir amostra ({editing.form.voice})
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-700">Escolha a voz do agente</div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {OPENAI_VOICES.map((v) => {
                      const activeVoice = editing.form.voice === v.id;
                      return (
                        <div
                          key={v.id}
                          onClick={() => setEditing({ ...editing, form: { ...editing.form, voice: v.id } })}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-2 text-left text-xs transition ${
                            activeVoice
                              ? 'border-brand-600 bg-brand-50/70 ring-1 ring-brand-500'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900">{v.label}</div>
                            <div className="truncate text-[11px] text-slate-500" title={v.style}>{v.style}</div>
                          </div>
                          <button
                            type="button"
                            title={`Ouvir amostra ${v.label}`}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              previewVoiceSample(v.label, v.style, v.pitch, v.rate);
                            }}
                            className="shrink-0 rounded-md border border-slate-200 bg-slate-50 p-1.5 text-slate-600 hover:bg-brand-100 hover:text-brand-800"
                          >
                            <Volume2 className="size-3.5" aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="ElevenLabs Agent ID">
                  {(f) => (
                    <Input
                      id={f.id}
                      value={editing.form.elevenlabsAgentId}
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, elevenlabsAgentId: e.target.value } })}
                      placeholder="agent_..."
                    />
                  )}
                </Field>
                <Field label="Modelo ElevenLabs">
                  {(f) => (
                    <Select
                      id={f.id}
                      value={editing.form.elevenlabsModel}
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, elevenlabsModel: e.target.value } })}
                    >
                      {!ELEVENLABS_MODELS.some((m) => m.id === editing.form.elevenlabsModel) && editing.form.elevenlabsModel && (
                        <option value={editing.form.elevenlabsModel}>{editing.form.elevenlabsModel}</option>
                      )}
                      {ELEVENLABS_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Voz ElevenLabs">
                  {(f) => (
                    <div className="flex items-center gap-2">
                      <Select
                        id={f.id}
                        value={editing.form.elevenlabsVoiceId}
                        onChange={(e) => setEditing({ ...editing, form: { ...editing.form, elevenlabsVoiceId: e.target.value } })}
                      >
                        {!ELEVENLABS_VOICES.some((v) => v.id === editing.form.elevenlabsVoiceId) && editing.form.elevenlabsVoiceId && (
                          <option value={editing.form.elevenlabsVoiceId}>{editing.form.elevenlabsVoiceId}</option>
                        )}
                        {ELEVENLABS_VOICES.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label} · {v.style.split('·')[0].trim()}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        icon={<Volume2 className="size-3.5" aria-hidden />}
                        onClick={() => {
                          const found = ELEVENLABS_VOICES.find((v) => v.id === editing.form.elevenlabsVoiceId);
                          previewVoiceSample(
                            found?.label ?? editing.form.elevenlabsVoiceId,
                            found?.style ?? 'Voz ElevenLabs',
                            found?.pitch ?? 1,
                            found?.rate ?? 1,
                            {
                              engine: 'elevenlabs',
                              voiceId: found?.apiId ?? editing.form.elevenlabsVoiceId,
                              model: editing.form.elevenlabsModel,
                            },
                          );
                        }}
                      >
                        Testar
                      </Button>
                    </div>
                  )}
                </Field>
              </div>
            )}

            <Field label="Saudação Inicial (Protegida por Carência Inicial)">
              {(f) => (
                <Textarea
                  id={f.id}
                  rows={2}
                  value={editing.form.greetingInstructions}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, greetingInstructions: e.target.value } })}
                />
              )}
            </Field>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-700">Prompt Principal / Instruções da Persona</label>
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, form: { ...editing.form, instructions: DEFAULT_PROMPT, greetingInstructions: DEFAULT_GREETING } })}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline cursor-pointer"
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Restaurar Padrão Voll Solutions
                </button>
              </div>
              <Textarea
                rows={4}
                value={editing.form.instructions}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, instructions: e.target.value } })}
              />
            </div>

            <div className="flex flex-wrap gap-5 pt-1">
              <Checkbox
                label="Agente Ativo"
                checked={editing.form.active}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, active: e.target.checked } })}
              />
              <Checkbox
                label="AMD (Detector de Caixa Postal)"
                checked={editing.form.amdEnabled}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, amdEnabled: e.target.checked } })}
              />
              <Checkbox
                label="Transcrição em Tempo Real (STT)"
                checked={editing.form.sttEnabled}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, sttEnabled: e.target.checked } })}
              />
            </div>

            {/* Parâmetros Avançados (API do Motor + Engenharia Acústica, SIP & DSP) */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70">
              <button
                type="button"
                onClick={() => setShowDsp((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>Parâmetros avançados</span>
                  <InfoTooltip
                    content={
                      editing.form.stsEngine === 'elevenlabs'
                        ? 'Ajustes finos da ElevenLabs (estabilidade, similaridade, velocidade, latência) e engenharia SIP/DSP.'
                        : 'Ajustes finos da OpenAI (VAD, agilidade de turno, temperatura, velocidade, transcrição, tokens) e engenharia SIP/DSP.'
                    }
                  />
                </span>
                {showDsp ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
              </button>
              {showDsp && (
                <div className="space-y-4 border-t border-slate-200 p-4">
                  {/* Parâmetros específicos da API selecionada */}
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        {editing.form.stsEngine === 'elevenlabs'
                          ? 'Parâmetros da API — ElevenLabs STS'
                          : editing.form.stsEngine === 'openai_live'
                            ? 'Parâmetros da API — OpenAI Live'
                            : 'Parâmetros da API — OpenAI Realtime'}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        icon={<Volume2 className="size-3.5" aria-hidden />}
                        onClick={() => {
                          if (editing.form.stsEngine === 'elevenlabs') {
                            const found = ELEVENLABS_VOICES.find((v) => v.id === editing.form.elevenlabsVoiceId);
                            previewVoiceSample(
                              found?.label ?? editing.form.elevenlabsVoiceId,
                              found?.style ?? 'Voz ElevenLabs',
                              found?.pitch ?? 1,
                              editing.form.elevenlabsSpeed,
                              {
                                engine: 'elevenlabs',
                                voiceId: found?.apiId ?? editing.form.elevenlabsVoiceId,
                                model: editing.form.elevenlabsModel,
                                speed: editing.form.elevenlabsSpeed,
                                stability: editing.form.elevenlabsStability,
                                similarityBoost: editing.form.elevenlabsSimilarityBoost,
                                optimizeLatency: editing.form.elevenlabsOptimizeLatency,
                              },
                            );
                          } else {
                            const found = OPENAI_VOICES.find((v) => v.id === editing.form.voice);
                            previewVoiceSample(
                              found?.label ?? editing.form.voice,
                              found?.style ?? 'Voz OpenAI',
                              found?.pitch ?? 1,
                              editing.form.openaiSpeed,
                              {
                                engine: editing.form.stsEngine,
                                model: editing.form.openaiModel,
                                speed: editing.form.openaiSpeed,
                              },
                            );
                          }
                        }}
                      >
                        Testar com parâmetros
                      </Button>
                    </div>

                    {editing.form.stsEngine !== 'elevenlabs' ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field
                            label="Detecção de turno (VAD)"
                            tooltip="server_vad detecta fim de fala por silêncio acústico; semantic_vad avalia contexto semântico antes de responder."
                          >
                            {(f) => (
                              <Select
                                id={f.id}
                                value={editing.form.openaiVadType}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    form: { ...editing.form, openaiVadType: e.target.value as 'server_vad' | 'semantic_vad' },
                                  })
                                }
                              >
                                <option value="server_vad">Server VAD (Acústico)</option>
                                <option value="semantic_vad">Semantic VAD (Contextual)</option>
                              </Select>
                            )}
                          </Field>
                          {editing.form.openaiVadType === 'semantic_vad' ? (
                            <Field
                              label="Agilidade do turno"
                              tooltip="Controla o quão rápido o agente assume a palavra após uma pausa semântica do cliente."
                            >
                              {(f) => (
                                <Select
                                  id={f.id}
                                  value={editing.form.openaiVadEagerness}
                                  onChange={(e) =>
                                    setEditing({
                                      ...editing,
                                      form: {
                                        ...editing.form,
                                        openaiVadEagerness: e.target.value as 'low' | 'medium' | 'high' | 'auto',
                                      },
                                    })
                                  }
                                >
                                  <option value="low">Baixa (espera mais)</option>
                                  <option value="medium">Média (equilibrado)</option>
                                  <option value="high">Alta (resposta rápida)</option>
                                  <option value="auto">Automática</option>
                                </Select>
                              )}
                            </Field>
                          ) : (
                            <Field
                              label="Sensibilidade VAD (0.1–0.95)"
                              tooltip="Limiar de energia de fala para o Server VAD disparar detecção de voz."
                            >
                              {(f) => (
                                <Input
                                  id={f.id}
                                  type="number"
                                  min={0.1}
                                  max={0.95}
                                  step={0.05}
                                  value={editing.form.vadThreshold}
                                  onChange={(e) =>
                                    setEditing({
                                      ...editing,
                                      form: { ...editing.form, vadThreshold: Number(e.target.value) },
                                    })
                                  }
                                />
                              )}
                            </Field>
                          )}
                          <Field
                            label="Temperatura (0.6–1.2)"
                            tooltip="Controla a variabilidade e espontaneidade das respostas faladas do agente."
                          >
                            {(f) => (
                              <Input
                                id={f.id}
                                type="number"
                                min={0.6}
                                max={1.2}
                                step={0.05}
                                value={editing.form.openaiTemperature}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    form: { ...editing.form, openaiTemperature: Number(e.target.value) },
                                  })
                                }
                              />
                            )}
                          </Field>
                        </div>

                        {editing.form.openaiVadType === 'server_vad' && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                              label="Prefix Padding (ms)"
                              tooltip="Áudio preservado antes da detecção de início de fala (0 a 1000 ms)."
                            >
                              {(f) => (
                                <Input
                                  id={f.id}
                                  type="number"
                                  min={0}
                                  max={1000}
                                  step={10}
                                  value={editing.form.prefixPaddingMs}
                                  onChange={(e) =>
                                    setEditing({
                                      ...editing,
                                      form: { ...editing.form, prefixPaddingMs: Number(e.target.value) },
                                    })
                                  }
                                />
                              )}
                            </Field>
                            <Field
                              label="Silêncio fim de turno (ms)"
                              tooltip="Tempo de silêncio após a fala para concluir o turno do cliente (100 a 2000 ms)."
                            >
                              {(f) => (
                                <Input
                                  id={f.id}
                                  type="number"
                                  min={100}
                                  max={2000}
                                  step={20}
                                  value={editing.form.silenceDurationMs}
                                  onChange={(e) =>
                                    setEditing({
                                      ...editing,
                                      form: { ...editing.form, silenceDurationMs: Number(e.target.value) },
                                    })
                                  }
                                />
                              )}
                            </Field>
                          </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field
                            label="Velocidade da fala (0.25–1.5)"
                            tooltip="Velocidade de síntese de áudio da resposta (1.0 = velocidade natural)."
                          >
                            {(f) => (
                              <Input
                                id={f.id}
                                type="number"
                                min={0.25}
                                max={1.5}
                                step={0.05}
                                value={editing.form.openaiSpeed}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    form: { ...editing.form, openaiSpeed: Number(e.target.value) },
                                  })
                                }
                              />
                            )}
                          </Field>
                          <Field
                            label="Máx. tokens de resposta"
                            tooltip="Limite máximo de tokens por turno (64 a 4096). Deixe vazio para ilimitado."
                          >
                            {(f) => (
                              <Input
                                id={f.id}
                                type="number"
                                min={64}
                                max={4096}
                                placeholder="Ilimitado"
                                value={editing.form.openaiMaxOutputTokens}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    form: { ...editing.form, openaiMaxOutputTokens: e.target.value },
                                  })
                                }
                              />
                            )}
                          </Field>
                          <Field
                            label="Prompt ID (opcional)"
                            tooltip="Identificador de prompt salvo no painel da OpenAI (usado se não houver instruções manuais)."
                          >
                            {(f) => (
                              <Input
                                id={f.id}
                                placeholder="pmpt_..."
                                value={editing.form.openaiPromptId}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    form: { ...editing.form, openaiPromptId: e.target.value },
                                  })
                                }
                              />
                            )}
                          </Field>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 items-end">
                          <Field
                            label="Modelo de transcrição"
                            tooltip="Modelo utilizado para transcrever a fala do cliente na entrada."
                          >
                            {(f) => (
                              <Select
                                id={f.id}
                                value={editing.form.openaiTranscriptionModel}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    form: {
                                      ...editing.form,
                                      openaiTranscriptionModel: e.target.value as
                                        | 'whisper-1'
                                        | 'gpt-4o-mini-transcribe'
                                        | 'gpt-4o-transcribe',
                                    },
                                  })
                                }
                              >
                                <option value="whisper-1">whisper-1</option>
                                <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
                                <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
                              </Select>
                            )}
                          </Field>
                          <Field
                            label="Idioma da transcrição"
                            tooltip="Idioma esperado do cliente para aumentar a precisão do reconhecimento de fala."
                          >
                            {(f) => (
                              <Select
                                id={f.id}
                                value={editing.form.openaiTranscriptionLanguage}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    form: {
                                      ...editing.form,
                                      openaiTranscriptionLanguage: e.target.value as 'pt' | 'en' | 'es' | 'auto',
                                    },
                                  })
                                }
                              >
                                <option value="pt">Português (pt)</option>
                                <option value="en">Inglês (en)</option>
                                <option value="es">Espanhol (es)</option>
                                <option value="auto">Detecção automática</option>
                              </Select>
                            )}
                          </Field>
                          <div className="pb-1.5">
                            <Checkbox
                              label={
                                <span className="inline-flex items-center gap-1">
                                  <span>Interrupção imediata (Barge-in)</span>
                                  <InfoTooltip content="Interrompe a fala do agente imediatamente quando o cliente começa a falar." />
                                </span>
                              }
                              checked={editing.form.openaiInterruptResponse}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  form: { ...editing.form, openaiInterruptResponse: e.target.checked },
                                })
                              }
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field
                          label="Estabilidade da voz (0–1)"
                          tooltip="Valores maiores tornam a voz mais constante; valores menores aumentam a expressividade."
                        >
                          {(f) => (
                            <Input
                              id={f.id}
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              value={editing.form.elevenlabsStability}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  form: { ...editing.form, elevenlabsStability: Number(e.target.value) },
                                })
                              }
                            />
                          )}
                        </Field>
                        <Field
                          label="Similaridade (0–1)"
                          tooltip="Fidelidade ao timbre original da voz ElevenLabs selecionada."
                        >
                          {(f) => (
                            <Input
                              id={f.id}
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              value={editing.form.elevenlabsSimilarityBoost}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  form: { ...editing.form, elevenlabsSimilarityBoost: Number(e.target.value) },
                                })
                              }
                            />
                          )}
                        </Field>
                        <Field
                          label="Velocidade da fala (0.7–1.2)"
                          tooltip="Velocidade de locução da ElevenLabs (1.0 = padrão)."
                        >
                          {(f) => (
                            <Input
                              id={f.id}
                              type="number"
                              min={0.7}
                              max={1.2}
                              step={0.05}
                              value={editing.form.elevenlabsSpeed}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  form: { ...editing.form, elevenlabsSpeed: Number(e.target.value) },
                                })
                              }
                            />
                          )}
                        </Field>
                        <Field
                          label="Otimização de latência (0–4)"
                          tooltip="Nível de otimização de streaming de áudio da ElevenLabs (0 = padrão, 4 = latência mínima)."
                        >
                          {(f) => (
                            <Input
                              id={f.id}
                              type="number"
                              min={0}
                              max={4}
                              step={1}
                              value={editing.form.elevenlabsOptimizeLatency}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  form: { ...editing.form, elevenlabsOptimizeLatency: Number(e.target.value) },
                                })
                              }
                            />
                          )}
                        </Field>
                        <Field
                          label="Sensibilidade VAD (0.1–0.95)"
                          tooltip="Limiar local de detecção de voz humana antes do envio."
                        >
                          {(f) => (
                            <Input
                              id={f.id}
                              type="number"
                              min={0.1}
                              max={0.95}
                              step={0.05}
                              value={editing.form.vadThreshold}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  form: { ...editing.form, vadThreshold: Number(e.target.value) },
                                })
                              }
                            />
                          )}
                        </Field>
                        <Field
                          label="Silêncio fim de turno (ms)"
                          tooltip="Tempo de silêncio de referência para encerrar o turno de fala (100 a 2000 ms)."
                        >
                          {(f) => (
                            <Input
                              id={f.id}
                              type="number"
                              min={100}
                              max={2000}
                              step={20}
                              value={editing.form.silenceDurationMs}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  form: { ...editing.form, silenceDurationMs: Number(e.target.value) },
                                })
                              }
                            />
                          )}
                        </Field>
                      </div>
                    )}
                  </div>

                  <div>
                    <Field label="DIDs associados (vírgula)">
                      {(f) => (
                        <Input
                          id={f.id}
                          value={editing.form.dids}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, dids: e.target.value } })}
                          placeholder="*, 5511989785888"
                        />
                      )}
                    </Field>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Filtro de Voz / Crosstalk">
                      {(f) => (
                        <Select
                          id={f.id}
                          value={editing.form.crosstalkMode}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, crosstalkMode: e.target.value } })}
                        >
                          <option value="atual">DSP Acústico (YIN F0)</option>
                          <option value="wespeaker">WeSpeaker CAM++ (Neural)</option>
                          <option value="ecapa">ECAPA-TDNN (Neural)</option>
                          <option value="none">Desligado</option>
                        </Select>
                      )}
                    </Field>
                    <Field label="Ratio Crosstalk (0–1)">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          step="0.05"
                          value={editing.form.crosstalkRatio}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, crosstalkRatio: Number(e.target.value) } })}
                        />
                      )}
                    </Field>
                    <Field label="Threshold Crosstalk (opcional)">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          step="0.05"
                          value={editing.form.crosstalkThreshold}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, crosstalkThreshold: e.target.value } })}
                          placeholder="auto"
                        />
                      )}
                    </Field>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Máx. Canais">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          value={editing.form.maxConcurrentCalls}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, maxConcurrentCalls: Number(e.target.value) } })}
                        />
                      )}
                    </Field>
                    <Field label="Máx. CPS (cham/s)">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          value={editing.form.maxCallsPerSecond}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, maxCallsPerSecond: Number(e.target.value) } })}
                        />
                      )}
                    </Field>
                    <Field label="Duração Máx. (s)">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          value={editing.form.maxDurationSec}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, maxDurationSec: Number(e.target.value) } })}
                        />
                      )}
                    </Field>
                    <Field label="Modo AMD">
                      {(f) => (
                        <Select
                          id={f.id}
                          value={editing.form.amdMode}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, amdMode: e.target.value as 'active' | 'shadow' } })}
                        >
                          <option value="active">Active (desliga caixa postal)</option>
                          <option value="shadow">Shadow (apenas log)</option>
                        </Select>
                      )}
                    </Field>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Carência Saudação (s)">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          step="0.5"
                          placeholder="dinâmico"
                          value={editing.form.bargeinGraceSec}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, bargeinGraceSec: e.target.value } })}
                        />
                      )}
                    </Field>
                    <Field label="Nível Barge-in (RMS)">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          placeholder="auto"
                          value={editing.form.bargeinLevel}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, bargeinLevel: e.target.value } })}
                        />
                      )}
                    </Field>
                    <Field label="Codec Áudio">
                      {(f) => (
                        <Select
                          id={f.id}
                          value={editing.form.audioCodec}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, audioCodec: e.target.value } })}
                        >
                          <option value="pcmu">PCMU (G.711 µ-law)</option>
                          <option value="pcma">PCMA (G.711 A-law)</option>
                          <option value="opus">Opus</option>
                        </Select>
                      )}
                    </Field>
                    <Field label="Debounce DTMF (ms)">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          value={editing.form.dtmfDebounceMs}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, dtmfDebounceMs: Number(e.target.value) } })}
                        />
                      )}
                    </Field>
                  </div>

                  {editing.form.stsEngine === 'openai' && (
                    <Field label="Prompt ID OpenAI (opcional)">
                      {(f) => (
                        <Input
                          id={f.id}
                          value={editing.form.openaiPromptId}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, openaiPromptId: e.target.value } })}
                          placeholder="pmpt_..."
                        />
                      )}
                    </Field>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remover agente "${deleting?.name || deleting?.id}"?`}
        confirmLabel="Remover"
        danger
        loading={delM.isPending}
        onConfirm={() => deleting && delM.mutate(deleting.id)}
      >
        <div className="space-y-3">
          {deletingUsage && deletingUsage.totalReferences > 0 && (
            <Alert tone="warn" title="Agente vinculado em recursos ativos">
              Este agente está referenciado em{' '}
              {[
                deletingUsage.channels.length ? `${deletingUsage.channels.length} canal(is) (${deletingUsage.channels.map((c) => c.name).join(', ')})` : null,
                deletingUsage.routes.length ? `${deletingUsage.routes.length} rota(s) (${deletingUsage.routes.map((r) => r.name).join(', ')})` : null,
                deletingUsage.campaigns.length ? `${deletingUsage.campaigns.length} campanha(s) (${deletingUsage.campaigns.map((c) => c.name).join(', ')})` : null,
                deletingUsage.templates.length ? `${deletingUsage.templates.length} modelo(s) (${deletingUsage.templates.map((t) => t.name).join(', ')})` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              . Desvincule antes de excluir.
            </Alert>
          )}
          <p>O agente será removido da memória e da configuração de voz da empresa.</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}

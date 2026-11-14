import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronUp, Edit, PhoneOutgoing, Plus, RotateCcw, Trash2, Volume2 } from 'lucide-react';
import { del, errorMessage, get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useExperienceMode } from '../../lib/experience-mode';
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
import { GatewayError, type TenantConfig } from './types';

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

function previewVoiceSample(voiceLabel: string, style: string, pitch = 1, rate = 1) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(
      `Olá! Eu sou a voz ${voiceLabel} da Voll Solutions. ${style.split('·')[0].trim()} para atendimento telefônico.`,
    );
    utt.lang = 'pt-BR';
    utt.pitch = pitch;
    utt.rate = rate;
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
  stsEngine: 'openai' | 'elevenlabs';
  voice: string;
  openaiModel: string;
  openaiPromptId: string;
  elevenlabsAgentId: string;
  elevenlabsModel: string;
  elevenlabsVoiceId: string;
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

function toForm(t?: TenantConfig | null): TenantForm {
  return {
    id: t?.id ?? '',
    name: t?.name ?? '',
    extension: t?.extension ?? '',
    dids: (t?.dids ?? ['*']).join(', '),
    stsEngine: t?.stsEngine === 'elevenlabs' ? 'elevenlabs' : 'openai',
    voice: t?.voice ?? 'marin',
    openaiModel: t?.openaiModel ?? 'gpt-realtime-2.1-mini',
    openaiPromptId: t?.openaiPromptId ?? '',
    elevenlabsAgentId: t?.elevenlabsAgentId ?? '',
    elevenlabsModel: t?.elevenlabsModel ?? 'eleven_turbo_v2_5',
    elevenlabsVoiceId: t?.elevenlabsVoiceId ?? 'Rachel',
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

  const [editing, setEditing] = useState<{ isNew: boolean; form: TenantForm } | null>(null);
  const [showDsp, setShowDsp] = useState(false);
  const [deleting, setDeleting] = useState<TenantConfig | null>(null);

  const q = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ count: number; tenants: TenantConfig[] }>('/telephony/tenants'),
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
        elevenlabsAgentId: form.elevenlabsAgentId.trim() || null,
        elevenlabsModel: form.elevenlabsModel,
        elevenlabsVoiceId: form.elevenlabsVoiceId,
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
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;

  const tenants = q.data?.tenants ?? [];

  return (
    <div className="space-y-4">
      <Card
        title={
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-brand-700" aria-hidden />
            <span>Agentes de IA / Tenants ({tenants.length})</span>
          </div>
        }
        tooltip="Cada tenant possui seu próprio motor STS (OpenAI Realtime ou ElevenLabs), persona, ramal de atendimento, filtro de voz e limites."
        actions={
          canManage && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => setEditing({ isNew: true, form: toForm(null) })}
            >
              Novo Agente / Tenant
            </Button>
          )
        }
        padded={false}
      >
        {!tenants.length ? (
          <div className="p-6"><Empty title="Nenhum tenant configurado no gateway" /></div>
        ) : (
          <TableWrap label="Agentes IA (Tenants)">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>{mode === 'basic' ? 'Agente' : 'Agente / ID'}</th>
                  <th>Motor STS &amp; Voz</th>
                  {isAtLeast('advanced') && <th>Ramal / DIDs</th>}
                  {isAtLeast('advanced') && <th>Pipeline (AMD/STT/Crosstalk)</th>}
                  <th>{mode === 'basic' ? 'Duração Máx.' : 'Limites'}</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const isEleven = t.stsEngine === 'elevenlabs';
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="font-semibold text-xs text-slate-900">{t.name || t.id}</div>
                        {isAtLeast('advanced') && <div className="font-mono text-[11px] text-slate-500">{t.id}</div>}
                      </td>
                      <td className="text-xs">
                        <Badge tone={isEleven ? 'blue' : 'brand'}>
                          {isEleven ? 'ElevenLabs STS' : 'OpenAI Realtime'}
                        </Badge>
                        <div className="mt-1 text-[11px] text-slate-600">
                          {isEleven
                            ? `${t.elevenlabsVoiceId || 'Rachel'} · ${t.elevenlabsModel || 'turbo_v2_5'}`
                            : `${t.voice || 'marin'} · ${t.openaiModel || 'gpt-realtime-mini'}`}
                        </div>
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
                        {isAtLeast('advanced') && <div>{t.maxConcurrentCalls ?? 200} canais</div>}
                        <div>Cap: {t.maxDurationSec ?? 180}s</div>
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
                                onClick={() => setEditing({ isNew: false, form: toForm(t) })}
                              >
                                Editar
                              </Button>
                              {t.id !== 'default' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-600 hover:bg-red-50"
                                  icon={<Trash2 className="size-3.5" aria-hidden />}
                                  onClick={() => setDeleting(t)}
                                />
                              )}
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
        title={editing?.isNew ? 'Novo Agente de IA (Tenant)' : `Editar Agente: ${editing?.form.id}`}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome de Exibição" required>
                {(f) => (
                  <Input
                    id={f.id}
                    value={editing.form.name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setEditing({
                        ...editing,
                        form: {
                          ...editing.form,
                          name: nextName,
                          id:
                            editing.isNew && !editing.form.id
                              ? nextName
                                  .toLowerCase()
                                  .normalize('NFD')
                                  .replace(/[\u0300-\u036f]/g, '')
                                  .replace(/[^a-z0-9]+/g, '-')
                                  .replace(/(^-|-$)/g, '')
                              : editing.form.id,
                        },
                      });
                    }}
                    placeholder="Agente Voll Atendimento"
                  />
                )}
              </Field>
              <Field label="Motor de IA Conversacional (STS Engine)">
                {(f) => (
                  <Select
                    id={f.id}
                    value={editing.form.stsEngine}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        form: { ...editing.form, stsEngine: e.target.value as 'openai' | 'elevenlabs' },
                      })
                    }
                  >
                    <option value="openai">OpenAI Realtime API</option>
                    <option value="elevenlabs">ElevenLabs Conversational AI (STS)</option>
                  </Select>
                )}
              </Field>
            </div>

            {editing.form.stsEngine === 'openai' ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Modelo OpenAI">
                    {(f) => (
                      <Select
                        id={f.id}
                        value={editing.form.openaiModel}
                        onChange={(e) => setEditing({ ...editing, form: { ...editing.form, openaiModel: e.target.value } })}
                      >
                        <option value="gpt-realtime-2.1-mini">gpt-realtime-2.1-mini (Rápido &amp; Econômico)</option>
                        <option value="gpt-realtime-2.1">gpt-realtime-2.1 (Máxima Fluidez)</option>
                        <option value="gpt-realtime-mini">gpt-realtime-mini</option>
                        <option value="gpt-realtime">gpt-realtime</option>
                      </Select>
                    )}
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
                    <Input
                      id={f.id}
                      value={editing.form.elevenlabsModel}
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, elevenlabsModel: e.target.value } })}
                    />
                  )}
                </Field>
                <Field label="Voz ElevenLabs">
                  {(f) => (
                    <Input
                      id={f.id}
                      value={editing.form.elevenlabsVoiceId}
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, elevenlabsVoiceId: e.target.value } })}
                    />
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

            {/* Engenharia Acústica & DSP (Accordion Colapsável) */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70">
              <button
                type="button"
                onClick={() => setShowDsp((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                <span>Engenharia Acústica, SIP &amp; Parâmetros DSP (Avançado)</span>
                {showDsp ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
              </button>
              {showDsp && (
                <div className="space-y-3 border-t border-slate-200 p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="ID do Tenant" required>
                      {(f) => (
                        <Input
                          id={f.id}
                          disabled={!editing.isNew}
                          value={editing.form.id}
                          onChange={(e) => setEditing({ ...editing, form: { ...editing.form, id: e.target.value } })}
                          placeholder="ex: vendas-vip"
                        />
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
        O agente será removido da memória e do arquivo de configuração do gateway.
      </ConfirmDialog>
    </div>
  );
}

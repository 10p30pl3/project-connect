/**
 * Agente de voz da conexão (cadastro único): roteiro, voz, AMD e caller IDs ficam no Voll Plan,
 * versionados, e são publicados no gateway de voz. Chamadas só saem com a versão publicada.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, CloudUpload, Copy, FlaskConical, Play, Plus, Save, ShieldCheck, Trash2, Users, Workflow, Wrench } from 'lucide-react';
import { VoiceAgentSchema, type VoiceAgent } from '@voll/shared';
import { applyFieldErrors, errorMessage, get, post, put } from '../lib/api';
import { useExperienceMode } from '../lib/experience-mode';
import { fmtDateTime } from '../lib/format';
import { Alert, Badge, Button, Checkbox, Field, InfoTooltip, Input, Loading, Modal, Select, Tabs, Textarea, useToast } from './ui';

type AgentState = {
  agent: VoiceAgent | null;
  version: number;
  syncedVersion: number | null;
  syncedAt: string | null;
  syncError: string | null;
  inSync: boolean;
  published?: boolean;
};

type EvalScenarioResult = {
  id: string;
  name: string;
  status: string;
  estimatedOpenAiMs: number;
  estimatedElevenMs: number;
};

type EvalRunResponse = {
  ok: boolean;
  agentVersion: number;
  passedCount: number;
  totalCount: number;
  results: EvalScenarioResult[];
};

const FormSchema = z.object({
  name: z.string().min(1, 'Informe o nome do agente'),
  engine: z.enum(['openai', 'elevenlabs']),
  openaiModel: z.string().optional(),
  voice: z.string().optional(),
  elevenlabsVoiceId: z.string().optional(),
  instructions: z.string().min(20, 'Descreva o roteiro do agente (mínimo de 20 caracteres)'),
  greeting: z.string().optional(),
  firstMessageMode: z.enum(['assistant-speaks-first', 'assistant-waits-for-user']),
  maxDurationSec: z.coerce.number().int().min(30, 'Mínimo de 30 s').max(900, 'Máximo de 900 s'),
  amdEnabled: z.boolean(),
  amdMode: z.enum(['active', 'shadow']),
  voicemailAction: z.enum(['hangup', 'leave_message']),
  voicemailMessage: z.string().optional(),
  sttEnabled: z.boolean(),
  bargeinLevel: z.coerce.number().int().min(1).max(5),
  defaultCallerId: z.string().min(8, 'Informe o caller ID com DDI e DDD'),
  allowedCallerIds: z.string(),
  callerIdStrategy: z.enum(['FIXED', 'LOCAL_PRESENCE_DDD', 'ROUND_ROBIN']),
  idleTimeoutSeconds: z.coerce.number().int().min(3).max(30),
  idleMessagesText: z.string(),
  endpointWaitSeconds: z.coerce.number().min(0.1).max(3),
  smartEndpointing: z.boolean(),
  interruptionEnabled: z.boolean(),
  interruptionMinWords: z.coerce.number().int().min(1).max(10),
  interruptionMinVoiceMs: z.coerce.number().int().min(80).max(1500),
  interruptionBackoffMs: z.coerce.number().int().min(0).max(3000),
  dtmfSendEnabled: z.boolean(),
  dtmfCollectEnabled: z.boolean(),
  transferMode: z.enum(['blind', 'warm']),
  transferDefaultTarget: z.string().optional(),
  crossCallMemoryEnabled: z.boolean(),
  piiRedactionEnabled: z.boolean(),
  agentMode: z.enum(['prompt', 'pathway']),
  guardrailsOnViolation: z.enum(['warn', 'block_and_rephrase']),
  mandatoryDisclosuresText: z.string(),
  forbiddenTopicsText: z.string(),
  escalationKeywordsText: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

type ExtraAdvancedState = {
  pronunciationRules: NonNullable<VoiceAgent['pronunciationRules']>;
  tools: NonNullable<VoiceAgent['tools']>;
  structuredDataSchemaText: string;
  transferSipHeadersText: string;
  pathway: NonNullable<VoiceAgent['pathway']>;
  squadAgents: NonNullable<VoiceAgent['squadAgents']>;
};

const emptyAdvanced: ExtraAdvancedState = {
  pronunciationRules: [],
  tools: [],
  structuredDataSchemaText: '',
  transferSipHeadersText: '',
  pathway: { startNodeId: '', nodes: [], globalNodes: [] },
  squadAgents: [],
};

const empty: FormValues = {
  name: '',
  engine: 'openai',
  openaiModel: 'gpt-realtime-mini',
  voice: 'marin',
  elevenlabsVoiceId: '',
  instructions: '',
  greeting: '',
  firstMessageMode: 'assistant-speaks-first',
  maxDurationSec: 180,
  amdEnabled: true,
  amdMode: 'active',
  voicemailAction: 'hangup',
  voicemailMessage: '',
  sttEnabled: true,
  bargeinLevel: 3,
  defaultCallerId: '',
  allowedCallerIds: '',
  callerIdStrategy: 'FIXED',
  idleTimeoutSeconds: 8,
  idleMessagesText: '',
  endpointWaitSeconds: 0.4,
  smartEndpointing: true,
  interruptionEnabled: true,
  interruptionMinWords: 2,
  interruptionMinVoiceMs: 260,
  interruptionBackoffMs: 350,
  dtmfSendEnabled: true,
  dtmfCollectEnabled: true,
  transferMode: 'blind',
  transferDefaultTarget: '',
  crossCallMemoryEnabled: false,
  piiRedactionEnabled: false,
  agentMode: 'prompt',
  guardrailsOnViolation: 'warn',
  mandatoryDisclosuresText: '',
  forbiddenTopicsText: '',
  escalationKeywordsText: '',
};

const linesToArr = (txt: string) =>
  txt
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

function toForm(a: VoiceAgent | null): FormValues {
  if (!a) return empty;
  return {
    name: a.name,
    engine: a.engine,
    openaiModel: a.openaiModel ?? '',
    voice: a.voice ?? '',
    elevenlabsVoiceId: a.elevenlabsVoiceId ?? '',
    instructions: a.instructions,
    greeting: a.greeting ?? '',
    firstMessageMode: a.firstMessageMode ?? 'assistant-speaks-first',
    maxDurationSec: a.maxDurationSec,
    amdEnabled: a.amd.enabled,
    amdMode: a.amd.mode,
    voicemailAction: a.amd.voicemailAction ?? 'hangup',
    voicemailMessage: a.amd.voicemailMessage ?? '',
    sttEnabled: a.stt.enabled,
    bargeinLevel: a.bargeinLevel,
    defaultCallerId: a.defaultCallerId,
    allowedCallerIds: a.allowedCallerIds.join('\n'),
    callerIdStrategy: a.callerIdStrategy ?? 'FIXED',
    idleTimeoutSeconds: a.idleTimeoutSeconds ?? 8,
    idleMessagesText: (a.idleMessages ?? []).join('\n'),
    endpointWaitSeconds: a.endpointingPlan?.waitSeconds ?? 0.4,
    smartEndpointing: a.endpointingPlan?.smartEndpointing ?? true,
    interruptionEnabled: a.interruptionPlan?.enabled ?? true,
    interruptionMinWords: a.interruptionPlan?.minWords ?? 2,
    interruptionMinVoiceMs: a.interruptionPlan?.minVoiceMs ?? 260,
    interruptionBackoffMs: a.interruptionPlan?.backoffMs ?? 350,
    dtmfSendEnabled: a.dtmfConfig?.sendEnabled ?? true,
    dtmfCollectEnabled: a.dtmfConfig?.collectEnabled ?? true,
    transferMode: a.transferConfig?.mode ?? 'blind',
    transferDefaultTarget: a.transferConfig?.defaultTarget ?? '',
    crossCallMemoryEnabled: a.crossCallMemoryEnabled ?? false,
    piiRedactionEnabled: a.piiRedactionEnabled ?? false,
    agentMode: a.mode ?? 'prompt',
    guardrailsOnViolation: a.guardrails?.onViolation ?? 'warn',
    mandatoryDisclosuresText: (a.guardrails?.mandatoryDisclosures ?? []).join('\n'),
    forbiddenTopicsText: (a.guardrails?.forbiddenTopics ?? []).join('\n'),
    escalationKeywordsText: (a.guardrails?.escalationKeywords ?? []).join('\n'),
  };
}

function toAdvanced(a: VoiceAgent | null): ExtraAdvancedState {
  if (!a) return emptyAdvanced;
  const sipHeadersLines = Object.entries(a.transferConfig?.sipHeaders ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return {
    pronunciationRules: a.pronunciationRules ?? [],
    tools: a.tools ?? [],
    structuredDataSchemaText: a.structuredDataSchema ? JSON.stringify(a.structuredDataSchema, null, 2) : '',
    transferSipHeadersText: sipHeadersLines,
    pathway: a.pathway ?? { startNodeId: '', nodes: [], globalNodes: [] },
    squadAgents: a.squadAgents ?? [],
  };
}

function parseSipHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of linesToArr(text)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
  }
  return out;
}

function toAgent(v: FormValues, adv: ExtraAdvancedState): VoiceAgent {
  const opt = (s?: string) => (s && s.trim() ? s.trim() : undefined);
  let structuredDataSchema: Record<string, unknown> | null = null;
  if (adv.structuredDataSchemaText.trim()) {
    try {
      structuredDataSchema = JSON.parse(adv.structuredDataSchemaText);
    } catch {
      throw new Error('JSON inválido em "Structured Data Schema (Extração)".');
    }
  }

  return VoiceAgentSchema.parse({
    name: v.name.trim(),
    engine: v.engine,
    openaiModel: v.engine === 'openai' ? opt(v.openaiModel) : undefined,
    voice: v.engine === 'openai' ? opt(v.voice) : undefined,
    elevenlabsVoiceId: v.engine === 'elevenlabs' ? opt(v.elevenlabsVoiceId) : undefined,
    instructions: v.instructions,
    greeting: opt(v.greeting),
    firstMessageMode: v.firstMessageMode,
    maxDurationSec: v.maxDurationSec,
    amd: {
      enabled: v.amdEnabled,
      mode: v.amdMode,
      voicemailAction: v.voicemailAction,
      voicemailMessage: v.voicemailAction === 'leave_message' ? opt(v.voicemailMessage) : undefined,
    },
    stt: { enabled: v.sttEnabled },
    bargeinLevel: v.bargeinLevel,
    defaultCallerId: v.defaultCallerId.replace(/[^\d+]/g, ''),
    allowedCallerIds: v.allowedCallerIds
      .split(/[\s,;]+/)
      .map((s) => s.replace(/[^\d+]/g, ''))
      .filter(Boolean),
    callerIdStrategy: v.callerIdStrategy,
    idleMessages: linesToArr(v.idleMessagesText).slice(0, 5),
    idleTimeoutSeconds: v.idleTimeoutSeconds,
    structuredDataSchema,
    endpointingPlan: {
      waitSeconds: v.endpointWaitSeconds,
      smartEndpointing: v.smartEndpointing,
    },
    interruptionPlan: {
      enabled: v.interruptionEnabled,
      minWords: v.interruptionMinWords,
      minVoiceMs: v.interruptionMinVoiceMs,
      backoffMs: v.interruptionBackoffMs,
    },
    pronunciationRules: adv.pronunciationRules.filter((r) => r.pattern.trim() && r.replacement.trim()),
    tools: adv.tools.filter((t) => t.name.trim() && t.url.trim()),
    dtmfConfig: {
      sendEnabled: v.dtmfSendEnabled,
      collectEnabled: v.dtmfCollectEnabled,
    },
    crossCallMemoryEnabled: v.crossCallMemoryEnabled,
    piiRedactionEnabled: v.piiRedactionEnabled,
    transferConfig: {
      mode: v.transferMode,
      defaultTarget: opt(v.transferDefaultTarget),
      sipHeaders: parseSipHeaders(adv.transferSipHeadersText),
    },
    mode: v.agentMode,
    pathway: v.agentMode === 'pathway' || adv.pathway.nodes.length > 0 ? adv.pathway : null,
    guardrails: {
      mandatoryDisclosures: linesToArr(v.mandatoryDisclosuresText),
      forbiddenTopics: linesToArr(v.forbiddenTopicsText),
      escalationKeywords: linesToArr(v.escalationKeywordsText),
      onViolation: v.guardrailsOnViolation,
    },
    squadAgents: adv.squadAgents.filter((s) => s.key.trim() && s.name.trim() && s.instructions.trim().length >= 10),
  });
}

export function VoiceAgentStatus({ state }: { state: AgentState | undefined }) {
  if (!state || state.version === 0) return <Badge tone="gray">Sem agente</Badge>;
  if (state.inSync) return <Badge tone="green">Agente v{state.version} publicado</Badge>;
  return <Badge tone="amber">v{state.version} não publicada</Badge>;
}

export function VoiceAgentPanel({
  connectionId,
  connectionName,
  open,
  onOpenChange,
  canEdit,
}: {
  connectionId: string;
  connectionName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canEdit: boolean;
}) {
  const { isAtLeast } = useExperienceMode();
  const isAdvanced = isAtLeast('advanced');
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['voice-agent', connectionId];
  const q = useQuery({ queryKey: key, queryFn: () => get<AgentState>(`/connections/${connectionId}/voice-agent`), enabled: open });
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: empty });
  const engine = form.watch('engine');
  const voicemailAction = form.watch('voicemailAction');
  const agentMode = form.watch('agentMode');

  const [tab, setTab] = useState('general');
  const [adv, setAdv] = useState<ExtraAdvancedState>(emptyAdvanced);
  const [advDirty, setAdvDirty] = useState(false);
  const [evalResult, setEvalResult] = useState<EvalRunResponse | null>(null);

  useEffect(() => {
    if (q.data) {
      form.reset(toForm(q.data.agent));
      setAdv(toAdvanced(q.data.agent));
      setAdvDirty(false);
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (v: FormValues) => put<AgentState>(`/connections/${connectionId}/voice-agent`, toAgent(v, adv)),
    onSuccess: (s) => {
      qc.setQueryData(key, s);
      setAdvDirty(false);
      toast('success', `Agente salvo na versão ${s.version}. Publique para que as chamadas usem esta versão.`);
    },
    onError: (err) => {
      if (err instanceof Error && !('fieldErrors' in err)) {
        toast('error', err.message);
      } else {
        applyFieldErrors(err, form.setError, { setFocus: form.setFocus });
      }
    },
  });

  const sync = useMutation({
    mutationFn: () => post<AgentState>(`/connections/${connectionId}/voice-agent/sync`),
    onError: (err) => toast('error', errorMessage(err)),
    onSuccess: (s) => {
      qc.setQueryData(key, s);
      qc.invalidateQueries({ queryKey: ['connections'] });
      toast(s.published ? 'success' : 'error', s.published ? `Versão ${s.version} publicada no gateway de voz.` : `Não foi possível publicar: ${s.syncError}`);
    },
  });

  const runEvals = useMutation({
    mutationFn: () => post<EvalRunResponse>(`/connections/${connectionId}/voice-agent/evals/run`, {}),
    onSuccess: (res) => {
      setEvalResult(res);
      toast('success', `Simulação concluída: ${res.passedCount}/${res.totalCount} cenários aprovados.`);
    },
    onError: (err) => toast('error', errorMessage(err)),
  });

  const onSubmit = form.handleSubmit((v) => {
    try {
      save.mutate(v);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  });

  const updateAdv = (updater: (prev: ExtraAdvancedState) => ExtraAdvancedState) => {
    setAdv((prev) => updater(prev));
    setAdvDirty(true);
  };

  const s = q.data;
  const err = form.formState.errors;
  const isDirty = form.formState.isDirty || advDirty;

  const widgetSnippet = `<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/widget.js" data-voll-agent="${connectionId}" data-mode="voice"></script>`;

  const renderBasicGeneralFields = () => (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nome do agente" required error={err.name?.message}>
        {(f) => (
          <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('name')} placeholder="Agente cobrança D+5" />
        )}
      </Field>
      <Field label="Motor de voz" tooltip="A chave de API do motor fica no ambiente do gateway, nunca no Voll Plan.">
        {(f) => (
          <Select id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('engine')}>
            <option value="openai">OpenAI Realtime</option>
            <option value="elevenlabs">ElevenLabs</option>
          </Select>
        )}
      </Field>
      {engine === 'openai' ? (
        <>
          <Field label="Modelo" error={err.openaiModel?.message}>
            {(f) => (
              <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('openaiModel')} placeholder="gpt-realtime-mini" />
            )}
          </Field>
          <Field label="Voz" error={err.voice?.message}>
            {(f) => (
              <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('voice')} placeholder="marin" />
            )}
          </Field>
        </>
      ) : (
        <Field label="Voz (ElevenLabs voice ID)" className="md:col-span-2" error={err.elevenlabsVoiceId?.message}>
          {(f) => (
            <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('elevenlabsVoiceId')} />
          )}
        </Field>
      )}
      <Field
        label="Roteiro do agente"
        required
        className="md:col-span-2"
        error={err.instructions?.message}
        tooltip="Instruções que o agente segue na conversa: objetivo, tom, o que confirmar e quando tabular."
      >
        {(f) => (
          <Textarea id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} rows={6} {...form.register('instructions')} />
        )}
      </Field>
      <Field label="Saudação inicial" className="md:col-span-2" error={err.greeting?.message}>
        {(f) => (
          <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('greeting')} placeholder="Olá, aqui é da Voll Solutions." />
        )}
      </Field>
      {!isAdvanced && (
        <>
          <Field label="Caller ID padrão" required error={err.defaultCallerId?.message} tooltip="Número exibido para o cliente, com DDI e DDD.">
            {(f) => (
              <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('defaultCallerId')} placeholder="+551130001000" inputMode="tel" />
            )}
          </Field>
          <Field
            label="Caller IDs autorizados"
            className="md:col-span-2"
            error={err.allowedCallerIds?.message}
            tooltip="Um por linha. O gateway recusa ordens com caller ID fora desta lista. Vazio = só o padrão."
          >
            {(f) => (
              <Textarea id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} rows={3} {...form.register('allowedCallerIds')} placeholder={'+551130001000\n+551130001001'} />
            )}
          </Field>
        </>
      )}
      <Field label="Duração máxima (s)" error={err.maxDurationSec?.message}>
        {(f) => (
          <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} type="number" min={30} max={900} {...form.register('maxDurationSec')} />
        )}
      </Field>
      <Field label="Sensibilidade de interrupção (1 a 5)" error={err.bargeinLevel?.message}>
        {(f) => (
          <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} type="number" min={1} max={5} {...form.register('bargeinLevel')} />
        )}
      </Field>
      {!isAdvanced && (
        <div className="space-y-2 md:col-span-2">
          <Checkbox label="Detectar caixa postal (AMD)" {...form.register('amdEnabled')} />
          <Field label="Modo do AMD">
            {(f) => (
              <Select id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('amdMode')}>
                <option value="active">Ativo: encerra ao detectar máquina</option>
                <option value="shadow">Observação: só registra</option>
              </Select>
            )}
          </Field>
          <Checkbox label="Transcrever a conversa" {...form.register('sttEnabled')} />
        </div>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`Agente de voz · ${connectionName}`}
      description="Roteiro, voz e caller IDs usados pelo gateway de voz nas campanhas desta conexão."
      footer={
        canEdit ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              icon={<CloudUpload className="size-4" aria-hidden />}
              disabled={!s?.agent || sync.isPending || isDirty}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? 'Publicando…' : `Publicar v${s?.version ?? ''} no gateway`}
            </Button>
            <Button variant="primary" icon={<Save className="size-4" aria-hidden />} disabled={save.isPending} onClick={onSubmit}>
              {save.isPending ? 'Salvando…' : 'Salvar nova versão'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <Alert tone="error" title="Não foi possível carregar o agente">
          {errorMessage(q.error)}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <VoiceAgentStatus state={s} />
            {s?.syncedAt && <span>Publicado em {fmtDateTime(s.syncedAt)} (v{s.syncedVersion})</span>}
            {isDirty && <Badge tone="amber">Alterações não salvas</Badge>}
          </div>
          {s?.syncError && (
            <Alert tone="error" title="Última publicação falhou">
              {s.syncError}
            </Alert>
          )}
          {s && s.version > 0 && !s.inSync && !s.syncError && (
            <Alert tone="warn" title="Versão ainda não publicada">
              Enquanto a versão {s.version} não for publicada, as chamadas desta conexão ficam bloqueadas.
            </Alert>
          )}

          <fieldset disabled={!canEdit} className="space-y-4">
            {!isAdvanced ? (
              renderBasicGeneralFields()
            ) : (
              <Tabs
                value={tab}
                onValueChange={setTab}
                tabs={[
                  {
                    value: 'general',
                    label: '1. Geral & Fala',
                    content: (
                      <div className="space-y-5">
                        {renderBasicGeneralFields()}

                        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
                          <div className="md:col-span-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <span>Comportamento de Turno, Endpointing &amp; Silêncio</span>
                            <InfoTooltip content="Controla quem fala primeiro, tolerância a pausas do cliente (endpointing) e reengajamento em silêncio prolongado." />
                          </div>

                          <Field
                            label="Quem inicia a conversa"
                            tooltip="assistant-speaks-first envia a saudação imediatamente (outbound); assistant-waits-for-user espera o cliente falar."
                          >
                            {(f) => (
                              <Select id={f.id} {...form.register('firstMessageMode')}>
                                <option value="assistant-speaks-first">Agente fala primeiro (Outbound / Padrão)</option>
                                <option value="assistant-waits-for-user">Aguardar cliente falar (Inbound)</option>
                              </Select>
                            )}
                          </Field>

                          <Field
                            label="Espera de fim de fala (s)"
                            tooltip="Tempo em segundos que a IA aguarda após pausa do cliente antes de responder."
                            error={err.endpointWaitSeconds?.message}
                          >
                            {(f) => (
                              <Input id={f.id} type="number" step="0.1" min={0.1} max={3} {...form.register('endpointWaitSeconds')} />
                            )}
                          </Field>

                          <Field
                            label="Timeout de silêncio (s)"
                            tooltip="Se o cliente ficar mudo por N segundos, a IA envia uma das mensagens de reengajamento abaixo."
                            error={err.idleTimeoutSeconds?.message}
                          >
                            {(f) => <Input id={f.id} type="number" min={3} max={30} {...form.register('idleTimeoutSeconds')} />}
                          </Field>

                          <div className="flex flex-col justify-end gap-2">
                            <Checkbox label="Endpointing inteligente (Smart VAD)" {...form.register('smartEndpointing')} />
                            <Checkbox label="Transcrever a conversa (STT)" {...form.register('sttEnabled')} />
                          </div>

                          <Field
                            label="Mensagens de Idle (1 por linha, máx. 5)"
                            className="md:col-span-2"
                            tooltip="Frases curtas que a IA diz automaticamente quando o cliente fica em silêncio (ex.: Olá, ainda está na linha?)."
                          >
                            {(f) => (
                              <Textarea
                                id={f.id}
                                rows={3}
                                {...form.register('idleMessagesText')}
                                placeholder={'Olá, ainda consegue me ouvir?\nEstou aguardando sua confirmação.'}
                              />
                            )}
                          </Field>

                          <div className="md:col-span-2 border-t border-slate-200 pt-3">
                            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                              <span>Plano Anti-Interrupção Falsa (Barge-In Gate)</span>
                              <InfoTooltip content="Define mínimos de palavras e milissegundos de voz contínua antes de interromper a IA." />
                            </div>
                            <div className="grid gap-3 md:grid-cols-4">
                              <div className="flex items-center">
                                <Checkbox label="Barge-in ativo" {...form.register('interruptionEnabled')} />
                              </div>
                              <Field label="Mín. palavras">
                                {(f) => <Input id={f.id} type="number" min={1} max={10} {...form.register('interruptionMinWords')} />}
                              </Field>
                              <Field label="Voz contínua (ms)">
                                {(f) => <Input id={f.id} type="number" min={80} max={1500} {...form.register('interruptionMinVoiceMs')} />}
                              </Field>
                              <Field label="Backoff pós-corte (ms)">
                                {(f) => <Input id={f.id} type="number" min={0} max={3000} {...form.register('interruptionBackoffMs')} />}
                              </Field>
                            </div>
                          </div>
                        </div>

                        {/* Dicionário de Pronúncia */}
                        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                              <span>Dicionário de Pronúncia</span>
                              <InfoTooltip content="Regras aplicadas antes de enviar textos para a IA falar siglas, marcas ou termos técnicos corretamente." />
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Plus className="size-3.5" />}
                              onClick={() =>
                                updateAdv((p) => ({
                                  ...p,
                                  pronunciationRules: [...p.pronunciationRules, { pattern: '', replacement: '', matchType: 'exact' }],
                                }))
                              }
                            >
                              Adicionar regra
                            </Button>
                          </div>
                          {adv.pronunciationRules.length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhuma regra configurada (ex.: Voll → Vól).</p>
                          ) : (
                            <div className="space-y-2">
                              {adv.pronunciationRules.map((rule, idx) => (
                                <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_auto]">
                                  <Input
                                    value={rule.pattern}
                                    placeholder="Termo original (ex.: CNPJ)"
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        pronunciationRules: p.pronunciationRules.map((x, i) => (i === idx ? { ...x, pattern: e.target.value } : x)),
                                      }))
                                    }
                                  />
                                  <Input
                                    value={rule.replacement}
                                    placeholder="Como pronunciar (ex.: cê ene pê jota)"
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        pronunciationRules: p.pronunciationRules.map((x, i) => (i === idx ? { ...x, replacement: e.target.value } : x)),
                                      }))
                                    }
                                  />
                                  <Select
                                    value={rule.matchType}
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        pronunciationRules: p.pronunciationRules.map((x, i) =>
                                          i === idx ? { ...x, matchType: e.target.value as 'exact' | 'regex' } : x,
                                        ),
                                      }))
                                    }
                                  >
                                    <option value="exact">Exato</option>
                                    <option value="regex">Regex</option>
                                  </Select>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    icon={<Trash2 className="size-3.5" />}
                                    onClick={() =>
                                      updateAdv((p) => ({
                                        ...p,
                                        pronunciationRules: p.pronunciationRules.filter((_, i) => i !== idx),
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  },
                  {
                    value: 'telephony',
                    label: '2. BINA DDD, AMD & Transfer',
                    content: (
                      <div className="space-y-4">
                        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
                          <div className="md:col-span-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <span>BINA / Local Presence DDD</span>
                            <InfoTooltip content="Seleciona automaticamente um Caller ID do pool com o mesmo DDD do destino para aumentar a taxa de atendimento." />
                          </div>
                          <Field label="Caller ID padrão" required error={err.defaultCallerId?.message}>
                            {(f) => (
                              <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('defaultCallerId')} placeholder="+551130001000" inputMode="tel" />
                            )}
                          </Field>
                          <Field label="Estratégia de seleção de Caller ID">
                            {(f) => (
                              <Select id={f.id} {...form.register('callerIdStrategy')}>
                                <option value="FIXED">Fixo (usar Caller ID padrão)</option>
                                <option value="LOCAL_PRESENCE_DDD">Local Presence DDD (mesmo código de área)</option>
                                <option value="ROUND_ROBIN">Rodízio balanceado (Round-Robin)</option>
                              </Select>
                            )}
                          </Field>
                          <Field
                            label="Pool de Caller IDs autorizados (1 por linha)"
                            className="md:col-span-2"
                            error={err.allowedCallerIds?.message}
                          >
                            {(f) => (
                              <Textarea id={f.id} rows={3} {...form.register('allowedCallerIds')} placeholder={'+551130001000\n+552130002000\n+553130003000'} />
                            )}
                          </Field>
                        </div>

                        <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
                          <div className="md:col-span-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <span>AMD &amp; Voicemail Drop</span>
                            <InfoTooltip content="Ao detectar caixa postal ativa, escolhe desligar rápido ou deixar um recado personalizado antes de desconectar." />
                          </div>
                          <div className="md:col-span-2">
                            <Checkbox label="Detectar caixa postal (AMD com Whisper local)" {...form.register('amdEnabled')} />
                          </div>
                          <Field label="Modo do AMD">
                            {(f) => (
                              <Select id={f.id} {...form.register('amdMode')}>
                                <option value="active">Ativo: atua ao detectar máquina</option>
                                <option value="shadow">Observação: apenas registra no log</option>
                              </Select>
                            )}
                          </Field>
                          <Field label="Ação ao detectar Caixa Postal">
                            {(f) => (
                              <Select id={f.id} {...form.register('voicemailAction')}>
                                <option value="hangup">Desligar imediatamente</option>
                                <option value="leave_message">Deixar recado (Voicemail Drop)</option>
                              </Select>
                            )}
                          </Field>
                          {voicemailAction === 'leave_message' && (
                            <Field label="Mensagem do Voicemail Drop" className="md:col-span-2">
                              {(f) => (
                                <Textarea
                                  id={f.id}
                                  rows={2}
                                  {...form.register('voicemailMessage')}
                                  placeholder="Olá, aqui é da Voll Solutions. Tentamos contato e retornaremos em breve."
                                />
                              )}
                            </Field>
                          )}
                        </div>

                        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
                          <div className="md:col-span-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <span>Transferência SIP, DTMF &amp; Memória Cross-Call</span>
                            <InfoTooltip content="Warm Transfer anuncia o resumo antes de transferir; DTMF permite navegar URAs externas; Memória lembra ligações anteriores do mesmo cliente." />
                          </div>
                          <Field label="Modo de transferência">
                            {(f) => (
                              <Select id={f.id} {...form.register('transferMode')}>
                                <option value="blind">Transferência Cega (Blind SIP REFER)</option>
                                <option value="warm">Transferência Assistida (Warm Handoff)</option>
                              </Select>
                            )}
                          </Field>
                          <Field label="Destino / Ramal padrão de transferência">
                            {(f) => <Input id={f.id} {...form.register('transferDefaultTarget')} placeholder="sip:fila-comercial@sip.local ou 2001" />}
                          </Field>
                          <Field label="Headers SIP customizados (Chave: Valor por linha)" className="md:col-span-2">
                            {(f) => (
                              <Textarea
                                id={f.id}
                                rows={2}
                                value={adv.transferSipHeadersText}
                                onChange={(e) => updateAdv((p) => ({ ...p, transferSipHeadersText: e.target.value }))}
                                placeholder={'X-Queue: financeiro\nX-Origin: voll-ai'}
                              />
                            )}
                          </Field>
                          <div className="flex flex-col gap-2 md:col-span-2">
                            <div className="flex flex-wrap gap-4">
                              <Checkbox label="Enviar tons DTMF (URA)" {...form.register('dtmfSendEnabled')} />
                              <Checkbox label="Coletar dígitos DTMF do cliente" {...form.register('dtmfCollectEnabled')} />
                            </div>
                            <Checkbox label="Habilitar Memória Cross-Call (injetar resumo das últimas tentativas deste contato no prompt)" {...form.register('crossCallMemoryEnabled')} />
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  {
                    value: 'tools',
                    label: '3. Tools API & Outputs',
                    content: (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                              <Wrench className="size-3.5 text-brand-700" aria-hidden />
                              <span>Custom Function Calling (HTTP Tools)</span>
                              <InfoTooltip content="Permite à IA consultar CRMs/APIs em tempo real durante a chamada. Todas as URLs passam por proteção SSRF." />
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Plus className="size-3.5" />}
                              onClick={() =>
                                updateAdv((p) => ({
                                  ...p,
                                  tools: [
                                    ...p.tools,
                                    {
                                      name: `consultar_crm_${p.tools.length + 1}`,
                                      description: 'Consulta dados do cliente na API externa',
                                      method: 'POST',
                                      url: 'https://api.seu-sistema.com.br/webhook',
                                      headers: {},
                                      parameters: { type: 'object', properties: { cpf: { type: 'string' } } },
                                      fillerSpeech: 'Só um instante enquanto consulto aqui no sistema…',
                                      timeoutMs: 4000,
                                    },
                                  ],
                                }))
                              }
                            >
                              Nova Tool HTTP
                            </Button>
                          </div>

                          {adv.tools.length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhuma Tool HTTP configurada.</p>
                          ) : (
                            <div className="space-y-3">
                              {adv.tools.map((tool, idx) => (
                                <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-slate-800">Tool #{idx + 1}</span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      icon={<Trash2 className="size-3.5" />}
                                      onClick={() => updateAdv((p) => ({ ...p, tools: p.tools.filter((_, i) => i !== idx) }))}
                                    >
                                      Remover
                                    </Button>
                                  </div>
                                  <div className="grid gap-2 md:grid-cols-3">
                                    <Input
                                      value={tool.name}
                                      placeholder="nome_da_funcao"
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          tools: p.tools.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                                        }))
                                      }
                                    />
                                    <Select
                                      value={tool.method}
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          tools: p.tools.map((x, i) => (i === idx ? { ...x, method: e.target.value as 'GET' | 'POST' | 'PUT' } : x)),
                                        }))
                                      }
                                    >
                                      <option value="POST">POST</option>
                                      <option value="GET">GET</option>
                                      <option value="PUT">PUT</option>
                                    </Select>
                                    <Input
                                      type="number"
                                      min={500}
                                      max={10000}
                                      value={tool.timeoutMs}
                                      placeholder="Timeout (ms)"
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          tools: p.tools.map((x, i) => (i === idx ? { ...x, timeoutMs: Number(e.target.value) || 4000 } : x)),
                                        }))
                                      }
                                    />
                                  </div>
                                  <Input
                                    value={tool.url}
                                    placeholder="https://api.empresa.com.br/endpoint"
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        tools: p.tools.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)),
                                      }))
                                    }
                                  />
                                  <Input
                                    value={tool.description}
                                    placeholder="Quando o modelo deve chamar esta função..."
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        tools: p.tools.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)),
                                      }))
                                    }
                                  />
                                  <Input
                                    value={tool.fillerSpeech ?? ''}
                                    placeholder="Frase de preenchimento (Filler Speech enquanto executa a requisição)"
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        tools: p.tools.map((x, i) => (i === idx ? { ...x, fillerSpeech: e.target.value } : x)),
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                              <span>Structured Data Schema (Extração na Tabulação)</span>
                              <InfoTooltip content="Define campos estruturados (ex.: valor_acordo, data_promessa, motivo_recusa) que a IA extrai automaticamente ao encerrar a chamada." />
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                updateAdv((p) => ({
                                  ...p,
                                  structuredDataSchemaText: JSON.stringify(
                                    {
                                      type: 'object',
                                      properties: {
                                        interesse_confirmado: { type: 'boolean', description: 'Cliente demonstrou interesse' },
                                        melhor_horario_retorno: { type: 'string', description: 'Preferência de horário informada' },
                                        resumo_objetivo: { type: 'string', description: 'Resumo de 1 frase do atendimento' },
                                      },
                                    },
                                    null,
                                    2,
                                  ),
                                }))
                              }
                            >
                              Inserir exemplo JSON
                            </Button>
                          </div>
                          <Textarea
                            rows={6}
                            className="font-mono text-xs"
                            value={adv.structuredDataSchemaText}
                            onChange={(e) => updateAdv((p) => ({ ...p, structuredDataSchemaText: e.target.value }))}
                            placeholder='{"type":"object","properties":{"resumo":{"type":"string"}}}'
                          />
                        </div>
                      </div>
                    ),
                  },
                  {
                    value: 'flow',
                    label: '4. Pathways & Guardrails',
                    content: (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <Workflow className="size-3.5 text-brand-700" aria-hidden />
                            <span>Modo de Orquestração &amp; Conversational Pathways</span>
                            <InfoTooltip content="Use Prompt Único para fluxos abertos ou Pathway para roteiros determinísticos em múltiplos nós e nós globais." />
                          </div>

                          <Field label="Modo do agente">
                            {(f) => (
                              <Select id={f.id} {...form.register('agentMode')}>
                                <option value="prompt">Prompt Único Livre</option>
                                <option value="pathway">Pathway Estruturado (Nós + Nós Globais)</option>
                              </Select>
                            )}
                          </Field>

                          {agentMode === 'pathway' && (
                            <div className="space-y-3 border-t border-slate-200 pt-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-700">Nós do Fluxo ({adv.pathway.nodes.length})</span>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon={<Plus className="size-3.5" />}
                                  onClick={() =>
                                    updateAdv((p) => ({
                                      ...p,
                                      pathway: {
                                        ...p.pathway,
                                        startNodeId: p.pathway.startNodeId || 'node_1',
                                        nodes: [
                                          ...p.pathway.nodes,
                                          {
                                            id: `node_${p.pathway.nodes.length + 1}`,
                                            title: `Etapa ${p.pathway.nodes.length + 1}`,
                                            type: 'conversation',
                                            prompt: '',
                                            transitions: [],
                                          },
                                        ],
                                      },
                                    }))
                                  }
                                >
                                  Adicionar Nó
                                </Button>
                              </div>

                              {adv.pathway.nodes.map((node, idx) => (
                                <div key={node.id + idx} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                                  <div className="grid gap-2 sm:grid-cols-3">
                                    <Input
                                      value={node.id}
                                      placeholder="ID do nó"
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          pathway: {
                                            ...p.pathway,
                                            nodes: p.pathway.nodes.map((n, i) => (i === idx ? { ...n, id: e.target.value } : n)),
                                          },
                                        }))
                                      }
                                    />
                                    <Input
                                      value={node.title}
                                      placeholder="Título da etapa"
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          pathway: {
                                            ...p.pathway,
                                            nodes: p.pathway.nodes.map((n, i) => (i === idx ? { ...n, title: e.target.value } : n)),
                                          },
                                        }))
                                      }
                                    />
                                    <div className="flex gap-1">
                                      <Select
                                        value={node.type}
                                        onChange={(e) =>
                                          updateAdv((p) => ({
                                            ...p,
                                            pathway: {
                                              ...p.pathway,
                                              nodes: p.pathway.nodes.map((n, i) =>
                                                i === idx ? { ...n, type: e.target.value as typeof n.type } : n,
                                              ),
                                            },
                                          }))
                                        }
                                      >
                                        <option value="conversation">Conversa</option>
                                        <option value="tool">Tool</option>
                                        <option value="dtmf">DTMF</option>
                                        <option value="transfer">Transferir</option>
                                        <option value="end">Encerrar</option>
                                      </Select>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={<Trash2 className="size-3.5" />}
                                        onClick={() =>
                                          updateAdv((p) => ({
                                            ...p,
                                            pathway: {
                                              ...p.pathway,
                                              nodes: p.pathway.nodes.filter((_, i) => i !== idx),
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                  <Textarea
                                    rows={2}
                                    value={node.prompt}
                                    placeholder="Instruções específicas desta etapa..."
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        pathway: {
                                          ...p.pathway,
                                          nodes: p.pathway.nodes.map((n, i) => (i === idx ? { ...n, prompt: e.target.value } : n)),
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <ShieldCheck className="size-3.5 text-brand-700" aria-hidden />
                            <span>Guardrails de Compliance</span>
                            <InfoTooltip content="Garante menções obrigatórias, bloqueia tópicos proibidos e aciona escalonamento imediato se palavras-chave críticas forem ditas." />
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <Field label="Ação em violação">
                              {(f) => (
                                <Select id={f.id} {...form.register('guardrailsOnViolation')}>
                                  <option value="warn">Alertar e registrar log</option>
                                  <option value="block_and_rephrase">Bloquear e reformular resposta</option>
                                </Select>
                              )}
                            </Field>
                            <Field label="Palavras de escalonamento (1 por linha)">
                              {(f) => (
                                <Textarea id={f.id} rows={2} {...form.register('escalationKeywordsText')} placeholder={'procon\nadvogado\nfalar com gerente'} />
                              )}
                            </Field>
                            <Field label="Disclosures obrigatórios (1 por linha)">
                              {(f) => (
                                <Textarea id={f.id} rows={2} {...form.register('mandatoryDisclosuresText')} placeholder={'Esta ligação está sendo gravada para sua segurança.'} />
                              )}
                            </Field>
                            <Field label="Tópicos proibidos (1 por linha)">
                              {(f) => (
                                <Textarea id={f.id} rows={2} {...form.register('forbiddenTopicsText')} placeholder={'Não prometer descontos acima de 15%'} />
                              )}
                            </Field>
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  {
                    value: 'governance',
                    label: '5. Squads, PII & Evals',
                    content: (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                              <Users className="size-3.5 text-brand-700" aria-hidden />
                              <span>Squads (Sub-agentes Especialistas)</span>
                              <InfoTooltip content="Permite transferir o contexto da conversa entre sub-agentes (ex.: Recepção → Financeiro → Fechamento) dentro da mesma chamada." />
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Plus className="size-3.5" />}
                              onClick={() =>
                                updateAdv((p) => ({
                                  ...p,
                                  squadAgents: [
                                    ...p.squadAgents,
                                    {
                                      key: `especialista_${p.squadAgents.length + 1}`,
                                      name: `Especialista ${p.squadAgents.length + 1}`,
                                      instructions: 'Assuma o atendimento para concluir negociação.',
                                      voice: '',
                                      handoffHint: 'Quando o cliente concordar em prosseguir.',
                                    },
                                  ],
                                }))
                              }
                            >
                              Adicionar Especialista
                            </Button>
                          </div>
                          {adv.squadAgents.length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhum sub-agente no Squad (modo agente único).</p>
                          ) : (
                            <div className="space-y-2.5">
                              {adv.squadAgents.map((sa, idx) => (
                                <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                                  <div className="grid gap-2 sm:grid-cols-4">
                                    <Input
                                      value={sa.key}
                                      placeholder="chave_unica"
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          squadAgents: p.squadAgents.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)),
                                        }))
                                      }
                                    />
                                    <Input
                                      value={sa.name}
                                      placeholder="Nome do especialista"
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          squadAgents: p.squadAgents.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                                        }))
                                      }
                                    />
                                    <Input
                                      value={sa.voice ?? ''}
                                      placeholder="Voz (opcional)"
                                      onChange={(e) =>
                                        updateAdv((p) => ({
                                          ...p,
                                          squadAgents: p.squadAgents.map((x, i) => (i === idx ? { ...x, voice: e.target.value } : x)),
                                        }))
                                      }
                                    />
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      icon={<Trash2 className="size-3.5" />}
                                      onClick={() => updateAdv((p) => ({ ...p, squadAgents: p.squadAgents.filter((_, i) => i !== idx) }))}
                                    >
                                      Remover
                                    </Button>
                                  </div>
                                  <Input
                                    value={sa.handoffHint ?? ''}
                                    placeholder="Condição de handoff (quando transferir para este especialista)"
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        squadAgents: p.squadAgents.map((x, i) => (i === idx ? { ...x, handoffHint: e.target.value } : x)),
                                      }))
                                    }
                                  />
                                  <Textarea
                                    rows={2}
                                    value={sa.instructions}
                                    placeholder="Instruções do especialista..."
                                    onChange={(e) =>
                                      updateAdv((p) => ({
                                        ...p,
                                        squadAgents: p.squadAgents.map((x, i) => (i === idx ? { ...x, instructions: e.target.value } : x)),
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <span>Privacidade LGPD / PCI &amp; Web Widget</span>
                            <InfoTooltip content="Redação automática de CPF, cartões (Luhn) e e-mails na transcrição + código embed para chamadas WebRTC no seu site." />
                          </div>
                          <Checkbox
                            label="Mascaramento automático de PII / Cartão de Crédito (PCI/LGPD) nas transcrições em tempo real"
                            {...form.register('piiRedactionEnabled')}
                          />
                          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                            <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-700">
                              <span>Snippet Web Voice Widget</span>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                                onClick={() => {
                                  navigator.clipboard?.writeText(widgetSnippet);
                                  toast('info', 'Snippet copiado para a área de transferência.');
                                }}
                              >
                                <Copy className="size-3" /> Copiar
                              </button>
                            </div>
                            <pre className="overflow-x-auto text-[11px] font-mono text-slate-600">{widgetSnippet}</pre>
                          </div>
                        </div>

                        {/* Evals Pré-Publicação */}
                        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                              <FlaskConical className="size-3.5 text-brand-700" aria-hidden />
                              <span>Simulador Pré-Publicação (Evals &amp; Latência)</span>
                              <InfoTooltip content="Executa bateria automática validando roteiro, tools, guardrails, LGPD e latência estimada OpenAI vs ElevenLabs." />
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Play className="size-3.5" />}
                              loading={runEvals.isPending}
                              disabled={!s?.agent}
                              onClick={() => runEvals.mutate()}
                            >
                              Rodar Evals Agora
                            </Button>
                          </div>
                          {evalResult && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-xs">
                                <Badge tone={evalResult.passedCount === evalResult.totalCount ? 'green' : 'amber'}>
                                  {evalResult.passedCount}/{evalResult.totalCount} cenários aprovados (v{evalResult.agentVersion})
                                </Badge>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {evalResult.results.map((r) => (
                                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs">
                                    <div>
                                      <div className="font-semibold text-slate-800 flex items-center gap-1">
                                        <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                                        {r.name}
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        OpenAI ~{r.estimatedOpenAiMs}ms · Eleven ~{r.estimatedElevenMs}ms
                                      </div>
                                    </div>
                                    <Badge tone={r.status === 'PASS' ? 'green' : 'red'}>{r.status}</Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

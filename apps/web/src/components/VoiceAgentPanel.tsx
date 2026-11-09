/**
 * Agente de voz da conexão (cadastro único): roteiro, voz, AMD e caller IDs ficam no Voll Plan,
 * versionados, e são publicados no gateway de voz. Chamadas só saem com a versão publicada.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CloudUpload, Save } from 'lucide-react';
import { VoiceAgentSchema, type VoiceAgent } from '@voll/shared';
import { applyFieldErrors, errorMessage, get, post, put } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Alert, Badge, Button, Checkbox, Field, Input, Loading, Modal, Select, Textarea, useToast } from './ui';

type AgentState = {
  agent: VoiceAgent | null;
  version: number;
  syncedVersion: number | null;
  syncedAt: string | null;
  syncError: string | null;
  inSync: boolean;
  published?: boolean;
};

// No formulário a lista de caller IDs autorizados é um texto, um número por linha.
const FormSchema = z.object({
  name: z.string().min(1, 'Informe o nome do agente'),
  engine: z.enum(['openai', 'elevenlabs']),
  openaiModel: z.string().optional(),
  voice: z.string().optional(),
  elevenlabsVoiceId: z.string().optional(),
  instructions: z.string().min(20, 'Descreva o roteiro do agente (mínimo de 20 caracteres)'),
  greeting: z.string().optional(),
  maxDurationSec: z.coerce.number().int().min(30, 'Mínimo de 30 s').max(900, 'Máximo de 900 s'),
  amdEnabled: z.boolean(),
  amdMode: z.enum(['active', 'shadow']),
  sttEnabled: z.boolean(),
  bargeinLevel: z.coerce.number().int().min(1).max(5),
  defaultCallerId: z.string().min(8, 'Informe o caller ID com DDI e DDD'),
  allowedCallerIds: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

const empty: FormValues = {
  name: '',
  engine: 'openai',
  openaiModel: 'gpt-realtime-mini',
  voice: 'marin',
  elevenlabsVoiceId: '',
  instructions: '',
  greeting: '',
  maxDurationSec: 180,
  amdEnabled: true,
  amdMode: 'active',
  sttEnabled: true,
  bargeinLevel: 3,
  defaultCallerId: '',
  allowedCallerIds: '',
};

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
    maxDurationSec: a.maxDurationSec,
    amdEnabled: a.amd.enabled,
    amdMode: a.amd.mode,
    sttEnabled: a.stt.enabled,
    bargeinLevel: a.bargeinLevel,
    defaultCallerId: a.defaultCallerId,
    allowedCallerIds: a.allowedCallerIds.join('\n'),
  };
}

function toAgent(v: FormValues): VoiceAgent {
  const opt = (s?: string) => (s && s.trim() ? s.trim() : undefined);
  return VoiceAgentSchema.parse({
    name: v.name.trim(),
    engine: v.engine,
    openaiModel: v.engine === 'openai' ? opt(v.openaiModel) : undefined,
    voice: v.engine === 'openai' ? opt(v.voice) : undefined,
    elevenlabsVoiceId: v.engine === 'elevenlabs' ? opt(v.elevenlabsVoiceId) : undefined,
    instructions: v.instructions,
    greeting: opt(v.greeting),
    maxDurationSec: v.maxDurationSec,
    amd: { enabled: v.amdEnabled, mode: v.amdMode },
    stt: { enabled: v.sttEnabled },
    bargeinLevel: v.bargeinLevel,
    defaultCallerId: v.defaultCallerId.replace(/[^\d+]/g, ''),
    allowedCallerIds: v.allowedCallerIds
      .split(/[\s,;]+/)
      .map((s) => s.replace(/[^\d+]/g, ''))
      .filter(Boolean),
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
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['voice-agent', connectionId];
  const q = useQuery({ queryKey: key, queryFn: () => get<AgentState>(`/connections/${connectionId}/voice-agent`), enabled: open });
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: empty });
  const engine = form.watch('engine');

  useEffect(() => {
    if (q.data) form.reset(toForm(q.data.agent));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (v: FormValues) => put<AgentState>(`/connections/${connectionId}/voice-agent`, toAgent(v)),
    onSuccess: (s) => {
      qc.setQueryData(key, s);
      toast('success', `Agente salvo na versão ${s.version}. Publique para que as chamadas usem esta versão.`);
    },
    onError: (err) => applyFieldErrors(err, form.setError, { setFocus: form.setFocus }),
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

  const onSubmit = form.handleSubmit((v) => {
    try {
      save.mutate(v);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  });

  const s = q.data;
  const err = form.formState.errors;
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
              disabled={!s?.agent || sync.isPending || form.formState.isDirty}
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
            {form.formState.isDirty && <Badge tone="amber">Alterações não salvas</Badge>}
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
          <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
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
            <Field label="Roteiro do agente" required className="md:col-span-2" error={err.instructions?.message}
              tooltip="Instruções que o agente segue na conversa: objetivo, tom, o que confirmar e quando tabular.">
              {(f) => (
                <Textarea id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} rows={8} {...form.register('instructions')} />
              )}
            </Field>
            <Field label="Saudação inicial" className="md:col-span-2" error={err.greeting?.message}>
              {(f) => (
                <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('greeting')} placeholder="Olá, aqui é da Voll Solutions." />
              )}
            </Field>
            <Field label="Caller ID padrão" required error={err.defaultCallerId?.message} tooltip="Número exibido para o cliente, com DDI e DDD.">
              {(f) => (
                <Input id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} {...form.register('defaultCallerId')} placeholder="+551130001000" inputMode="tel" />
              )}
            </Field>
            <Field label="Caller IDs autorizados" className="md:col-span-2" error={err.allowedCallerIds?.message}
              tooltip="Um por linha. O gateway recusa ordens com caller ID fora desta lista. Vazio = só o padrão.">
              {(f) => (
                <Textarea id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} rows={3} {...form.register('allowedCallerIds')} placeholder={'+551130001000\n+551130001001'} />
              )}
            </Field>
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
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

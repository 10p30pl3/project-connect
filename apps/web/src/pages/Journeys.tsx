import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CHANNEL_LABEL, CHANNEL_TYPES, type ChannelType, type JourneyStep } from '@voll/shared';
import { ApiError, errorMessage, get, post } from '../lib/api';
import type { Connection, Journey } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { JourneySteps } from '../components/Summaries';

export function JourneysPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['journeys'], queryFn: () => get<{ items: Journey[] }>('/journeys') });
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Jornadas"
        subtitle="Ordem dos canais, conexões e prazos de feedback (sem política de retentativa local)"
        actions={
          can('journeys.write') && (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
              Nova jornada
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty title="Nenhuma jornada" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {q.data!.items.map((j) => (
            <Card key={j.id} title={`${j.name}${j.latestVersion ? ` · v${j.latestVersion.version}` : ''}`}>
              {j.latestVersion ? <JourneySteps steps={j.latestVersion.steps} /> : <p className="text-sm text-slate-500">Sem versão publicada.</p>}
            </Card>
          ))}
        </div>
      )}
      <NewJourneyDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewJourneyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const conns = useQuery({ queryKey: ['connections'], queryFn: () => get<{ items: Connection[] }>('/connections'), enabled: open });
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Partial<JourneyStep>[]>([{ channelType: 'VOICE', feedbackTimeoutMinutes: 30 }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => post('/journeys', { name, steps }),
    onSuccess: () => {
      toast('success', 'Jornada publicada.');
      qc.invalidateQueries({ queryKey: ['journeys'] });
      setName('');
      setSteps([{ channelType: 'VOICE', feedbackTimeoutMinutes: 30 }]);
      onOpenChange(false);
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fieldErrors).length ? e.fieldErrors : { form: errorMessage(e) }),
  });
  const connsFor = (c?: ChannelType) => conns.data?.items.filter((x) => x.channelType === c && x.active) ?? [];
  function submit() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Informe o nome';
    steps.forEach((s, i) => {
      if (!s.connectionId) e[`steps.${i}.connectionId`] = 'Escolha a conexão';
      if (!s.feedbackTimeoutMinutes || s.feedbackTimeoutMinutes < 1) e[`steps.${i}.feedbackTimeoutMinutes`] = 'Mínimo 1 minuto';
    });
    setErrors(e);
    if (Object.keys(e).length === 0) m.mutate();
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Nova jornada"
      description="Cada etapa referencia uma conexão compatível com o canal. Retentativas ficam na estratégia."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Publicar jornada
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <Field label="Nome" required error={errors.name}>
          {(p) => <Input id={p.id} value={name} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {steps.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_10rem_auto]">
            <Field label={`Etapa ${i + 1}: canal`}>
              {(p) => (
                <Select
                  id={p.id}
                  value={s.channelType}
                  onChange={(e) => setSteps((st) => st.map((x, j) => (j === i ? { ...x, channelType: e.target.value as ChannelType, connectionId: undefined } : x)))}
                >
                  {CHANNEL_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Conexão" error={errors[`steps.${i}.connectionId`]}>
              {(p) => (
                <Select
                  id={p.id}
                  aria-invalid={p.invalid}
                  value={s.connectionId ?? ''}
                  onChange={(e) => setSteps((st) => st.map((x, j) => (j === i ? { ...x, connectionId: e.target.value } : x)))}
                >
                  <option value="">Selecione…</option>
                  {connsFor(s.channelType).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Prazo de feedback (min)" error={errors[`steps.${i}.feedbackTimeoutMinutes`]}>
              {(p) => (
                <Input
                  id={p.id}
                  type="number"
                  min={1}
                  aria-invalid={p.invalid}
                  value={s.feedbackTimeoutMinutes ?? ''}
                  onChange={(e) => setSteps((st) => st.map((x, j) => (j === i ? { ...x, feedbackTimeoutMinutes: Number(e.target.value) } : x)))}
                />
              )}
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" aria-label={`Remover etapa ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps((st) => st.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setSteps((st) => [...st, { channelType: 'WHATSAPP', feedbackTimeoutMinutes: 60 }])}>
          Adicionar etapa
        </Button>
      </div>
    </Modal>
  );
}

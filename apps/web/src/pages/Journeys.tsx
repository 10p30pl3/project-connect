import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { CHANNEL_LABEL, CHANNEL_TYPES, type ChannelType, type JourneyStep } from '@voll/shared';
import { ApiError, errorMessage, get, post } from '../lib/api';
import type { Connection, Journey, JourneyStepView } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Card, Empty, ErrorState, Field, InfoTooltip, Input, Loading, Modal, PageHeader, Select, TableWrap, useToast, ViewModeToggle, type ViewMode } from '../components/ui';
import { JourneySteps } from '../components/Summaries';

function EditableJourneyCard({
  journey,
  canEdit,
  connections,
}: {
  journey: Journey;
  canEdit: boolean;
  connections: Connection[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialSteps: JourneyStepView[] = (journey.latestVersion?.steps ?? []).map((s) => ({
    channelType: s.channelType,
    connectionId: s.connectionId,
    connectionName: s.connectionName,
    feedbackTimeoutMinutes: s.feedbackTimeoutMinutes,
  }));

  const [draftName, setDraftName] = useState(journey.name);
  const [draftSteps, setDraftSteps] = useState<JourneyStepView[]>(initialSteps);

  // Sincroniza se a versão ou jornada for atualizada externamente
  const [lastJId, setLastJId] = useState(journey.id);
  const [lastVer, setLastVer] = useState(journey.latestVersion?.version);
  if (journey.id !== lastJId || journey.latestVersion?.version !== lastVer) {
    setLastJId(journey.id);
    setLastVer(journey.latestVersion?.version);
    setDraftName(journey.name);
    setDraftSteps(initialSteps);
    setIsEditing(false);
  }

  const isNameDirty = draftName.trim() !== journey.name.trim();
  const prevStepsPure = initialSteps.map((s) => ({
    channelType: s.channelType,
    connectionId: s.connectionId,
    feedbackTimeoutMinutes: s.feedbackTimeoutMinutes,
  }));
  const draftStepsPure = draftSteps.map((s) => ({
    channelType: s.channelType,
    connectionId: s.connectionId,
    feedbackTimeoutMinutes: s.feedbackTimeoutMinutes,
  }));
  const isStepsDirty = JSON.stringify(prevStepsPure) !== JSON.stringify(draftStepsPure);
  const isDirty = isNameDirty || isStepsDirty;

  const handleDiscard = () => {
    setDraftName(journey.name);
    setDraftSteps(initialSteps);
    setError(null);
    setIsEditing(false);
    toast('info', 'Alterações descartadas.');
  };

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setError(null);

    if (!draftName.trim()) {
      setError('O nome da jornada não pode ficar vazio.');
      return;
    }
    if (draftSteps.length === 0) {
      setError('A jornada deve conter pelo menos uma etapa.');
      return;
    }
    for (let i = 0; i < draftSteps.length; i++) {
      const s = draftSteps[i];
      if (!s.connectionId) {
        setError(`Escolha uma conexão para a etapa ${i + 1}.`);
        return;
      }
      if (!s.feedbackTimeoutMinutes || s.feedbackTimeoutMinutes < 1) {
        setError(`Informe um prazo de feedback válido para a etapa ${i + 1}.`);
        return;
      }
    }

    setSaving(true);
    try {
      await post(`/journeys/${journey.id}/versions`, {
        name: draftName.trim(),
        steps: draftSteps.map((s) => ({
          channelType: s.channelType,
          connectionId: s.connectionId,
          feedbackTimeoutMinutes: s.feedbackTimeoutMinutes,
        })),
      });
      await qc.invalidateQueries({ queryKey: ['journeys'] });
      setIsEditing(false);
      toast('success', `Jornada "${draftName.trim()}" atualizada para v${(journey.latestVersion?.version ?? 1) + 1}.`);
    } catch (err) {
      setError(errorMessage(err));
      toast('error', `Falha ao salvar jornada: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const connsFor = (c?: ChannelType) => connections.filter((x) => x.channelType === c && x.active);

  return (
    <Card padded={false} className="flex flex-col justify-between overflow-hidden">
      {/* Header do Card com ações SOMENTE NO TOPO */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-900 truncate">{journey.name}</span>
            <Badge tone="gray">v{journey.latestVersion?.version ?? 1}</Badge>
            {isDirty && (
              <span className="size-2 rounded-full bg-amber-500 shrink-0" title="Alterações pendentes" />
            )}
          </div>
          <span className="text-[11px] text-slate-500">
            {journey.latestVersion?.steps.length ?? 0} etapa(s) de acionamento
          </span>
        </div>

        {/* Botões de Ação: Manter SOMENTE NO TOPO */}
        <div className="flex items-center gap-2 shrink-0">
          {!isEditing ? (
            canEdit && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Pencil className="size-3.5" />}
                onClick={() => setIsEditing(true)}
              >
                Editar jornada
              </Button>
            )
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={handleDiscard} disabled={saving}>
                {isDirty ? 'Descartar' : 'Fechar'}
              </Button>
              {isDirty && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Save className="size-3.5" />}
                  loading={saving}
                  onClick={handleSave}
                >
                  Salvar e publicar v{(journey.latestVersion?.version ?? 1) + 1}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Conteúdo do Card */}
      <div className="p-4 space-y-3 flex-1">
        {error && <Alert tone="error">{error}</Alert>}

        {!isEditing ? (
          <div
            onClick={() => canEdit && setIsEditing(true)}
            className={canEdit ? 'cursor-pointer group/steps rounded-lg p-1 -m-1 hover:bg-slate-50/80 transition' : ''}
            title={canEdit ? 'Clique para editar a sequência de canais' : undefined}
          >
            {journey.latestVersion ? (
              <JourneySteps steps={journey.latestVersion.steps} />
            ) : (
              <p className="text-sm text-slate-500">Sem versão publicada.</p>
            )}
            {canEdit && (
              <div className="mt-2 text-[11px] text-slate-400 opacity-0 group-hover/steps:opacity-100 transition flex items-center gap-1 text-brand-600 font-medium">
                <Pencil className="size-3" /> Clique para editar esta jornada
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Nome da jornada" required>
              {(p) => (
                <Input
                  id={p.id}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Nome identificador da jornada"
                  className="text-xs"
                />
              )}
            </Field>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700">Etapas do Acionamento Multicanal:</div>
              {draftSteps.map((s, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 sm:grid-cols-[120px_1fr_120px_auto] items-end"
                >
                  <Field label={`Etapa ${i + 1}: canal`}>
                    {(p) => (
                      <Select
                        id={p.id}
                        value={s.channelType}
                        onChange={(e) => {
                          const nextChan = e.target.value as ChannelType;
                          const availConns = connsFor(nextChan);
                          setDraftSteps((st) =>
                            st.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    channelType: nextChan,
                                    connectionId: availConns[0]?.id ?? '',
                                    connectionName: availConns[0]?.name,
                                  }
                                : x,
                            ),
                          );
                        }}
                        className="text-xs py-1 h-8"
                      >
                        {CHANNEL_TYPES.map((c) => (
                          <option key={c} value={c}>
                            {CHANNEL_LABEL[c]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label="Conexão">
                    {(p) => (
                      <Select
                        id={p.id}
                        value={s.connectionId ?? ''}
                        onChange={(e) => {
                          const cId = e.target.value;
                          const cName = connections.find((c) => c.id === cId)?.name;
                          setDraftSteps((st) =>
                            st.map((x, j) =>
                              j === i ? { ...x, connectionId: cId, connectionName: cName } : x,
                            ),
                          );
                        }}
                        className="text-xs py-1 h-8"
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

                  <Field label="Feedback (min)">
                    {(p) => (
                      <Input
                        id={p.id}
                        type="number"
                        min={1}
                        value={s.feedbackTimeoutMinutes ?? ''}
                        onChange={(e) =>
                          setDraftSteps((st) =>
                            st.map((x, j) =>
                              j === i ? { ...x, feedbackTimeoutMinutes: Math.max(1, Number(e.target.value)) } : x,
                            ),
                          )
                        }
                        className="text-xs py-1 h-8"
                      />
                    )}
                  </Field>

                  <div className="pb-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remover etapa ${i + 1}`}
                      disabled={draftSteps.length === 1}
                      onClick={() => setDraftSteps((st) => st.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-rose-600 h-8 px-2"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="size-3.5" />}
                onClick={() => {
                  const defaultChan: ChannelType = 'WHATSAPP';
                  const avail = connsFor(defaultChan);
                  setDraftSteps((st) => [
                    ...st,
                    {
                      channelType: defaultChan,
                      connectionId: avail[0]?.id ?? '',
                      connectionName: avail[0]?.name,
                      feedbackTimeoutMinutes: 60,
                    },
                  ]);
                }}
              >
                Adicionar etapa
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function JourneysSection({
  open: extOpen,
  onOpenChange: extOnOpenChange,
  viewMode: extViewMode,
  onViewModeChange: extOnViewModeChange,
}: {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (v: ViewMode) => void;
} = {}) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['journeys'], queryFn: () => get<{ items: Journey[] }>('/journeys') });
  const conns = useQuery({ queryKey: ['connections'], queryFn: () => get<{ items: Connection[] }>('/connections') });

  const [localOpen, setLocalOpen] = useState(false);
  const open = extOpen !== undefined ? extOpen : localOpen;
  const setOpen = extOnOpenChange !== undefined ? extOnOpenChange : setLocalOpen;

  const [localViewMode, setLocalViewMode] = useState<ViewMode>('cards');
  const viewMode = extViewMode !== undefined ? extViewMode : localViewMode;
  const setViewMode = extOnViewModeChange !== undefined ? extOnViewModeChange : setLocalViewMode;

  const [editJourneyInModal, setEditJourneyInModal] = useState<Journey | null>(null);

  const canEdit = can('journeys.write');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-slate-800">Jornadas de Acionamento (Sequência de Canais)</h2>
          <InfoTooltip content="Ordem dos canais, conexões e prazos de feedback (sem política de retentativa local)." />
          <span className="text-xs text-slate-400 italic ml-2">
            Clique em &quot;Editar jornada&quot; para ajustar os canais ou publicar nova versão
          </span>
        </div>
        {extViewMode === undefined && <ViewModeToggle value={viewMode} onChange={setViewMode} />}
      </div>

      {q.isLoading || conns.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty title="Nenhuma jornada cadastrada" />
      ) : viewMode === 'cards' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data!.items.map((j) => (
            <EditableJourneyCard
              key={j.id}
              journey={j}
              canEdit={canEdit}
              connections={conns.data?.items ?? []}
            />
          ))}
        </div>
      ) : (
        <Card padded={false}>
          <TableWrap label="Jornadas">
            <table className="data">
              <thead>
                <tr>
                  <th>Jornada</th>
                  <th>Versão</th>
                  <th>Etapas</th>
                  <th>Sequência de Canais</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((j) => {
                  const steps = j.latestVersion?.steps ?? [];
                  return (
                    <tr key={j.id} className="hover:bg-slate-50/80 transition">
                      <td className="font-semibold text-slate-800">{j.name}</td>
                      <td>
                        <Badge tone="gray">v{j.latestVersion?.version ?? 1}</Badge>
                      </td>
                      <td className="text-xs text-slate-600 tabular">{steps.length} etapa(s)</td>
                      <td>
                        {steps.length > 0 ? (
                          <JourneySteps steps={steps} />
                        ) : (
                          <span className="text-xs text-slate-400">Sem versão publicada</span>
                        )}
                      </td>
                      <td className="text-right">
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Pencil className="size-3.5" />}
                            onClick={() => setEditJourneyInModal(j)}
                          >
                            Editar jornada
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {editJourneyInModal && (
        <Modal
          open
          onOpenChange={(o) => !o && setEditJourneyInModal(null)}
          wide
          title={`Editar Jornada: ${editJourneyInModal.name}`}
          description="Ajuste a sequência de canais e salve no topo do card para publicar uma nova versão."
        >
          <EditableJourneyCard
            journey={q.data?.items.find((x) => x.id === editJourneyInModal.id) ?? editJourneyInModal}
            canEdit={canEdit}
            connections={conns.data?.items ?? []}
          />
        </Modal>
      )}

      <NewJourneyDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function JourneysPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Jornadas de Canal"
        tooltip="Sequência e ordem dos canais, conexões e prazos de feedback para acionamento multicanal."
        actions={
          <div className="flex items-center gap-2.5">
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
            {can('journeys.write') && (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
                Nova jornada
              </Button>
            )}
          </div>
        }
      />
      <JourneysSection open={open} onOpenChange={setOpen} viewMode={viewMode} onViewModeChange={setViewMode} />
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

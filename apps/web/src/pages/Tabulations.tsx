import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AlertCircle, Check, Pencil, Plus, RotateCcw, Save } from 'lucide-react';
import { CHANNEL_LABEL, type ChannelType } from '@voll/shared';
import { clsx } from 'clsx';

import { errorMessage, get, patch, post } from '../lib/api';
import type { Tabulation } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, Checkbox, ErrorState, Field, InfoTooltip, Input, Loading, Modal, PageHeader, TableWrap, useToast, ViewModeToggle, type ViewMode } from '../components/ui';

/** Aceita array ou literal de array do Postgres ("{VOICE,SMS}"). */
function channelList(v: unknown): ChannelType[] {
  if (Array.isArray(v)) return v as ChannelType[];
  if (typeof v === 'string') return v.replace(/[{}]/g, '').split(',').filter(Boolean) as ChannelType[];
  return [];
}

const INDICATORS = [
  {
    key: 'isCpc' as const,
    label: 'CPC',
    activeClass: 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 ring-1 ring-blue-200',
    hoverClass: 'hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50/50',
    tooltip: 'Conta como Contato Efetivo / Pessoa Certa',
  },
  {
    key: 'isConversion' as const,
    label: 'Conversão',
    activeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 ring-1 ring-emerald-200',
    hoverClass: 'hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50/50',
    tooltip: 'Conta como Conversão / Sucesso da Operação',
  },
  {
    key: 'invalidatesDestination' as const,
    label: 'Invalida destino',
    activeClass: 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 ring-1 ring-amber-200',
    hoverClass: 'hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50/50',
    tooltip: 'Invalida telefone ou e-mail de destino',
  },
  {
    key: 'isOptOut' as const,
    label: 'Opt-out (DNC)',
    activeClass: 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100 ring-1 ring-rose-200',
    hoverClass: 'hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50/50',
    tooltip: 'Gera bloqueio permanente na lista Não Perturbe',
  },
] as const;

const CHANNELS: { type: ChannelType; label: string; activeClass: string }[] = [
  { type: 'VOICE', label: 'Discador', activeClass: 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200 font-semibold' },
  { type: 'WHATSAPP', label: 'WhatsApp', activeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 font-semibold' },
  { type: 'SMS', label: 'SMS', activeClass: 'bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100 font-semibold' },
  { type: 'EMAIL', label: 'E-mail', activeClass: 'bg-sky-50 text-sky-700 border-sky-300 hover:bg-sky-100 font-semibold' },
];

export function TabulationsSection({
  viewMode: extViewMode,
  onViewModeChange: extOnViewModeChange,
}: {
  viewMode?: ViewMode;
  onViewModeChange?: (v: ViewMode) => void;
} = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });

  const [localViewMode, setLocalViewMode] = useState<ViewMode>('cards');
  const viewMode = extViewMode !== undefined ? extViewMode : localViewMode;
  const setViewMode = extOnViewModeChange !== undefined ? extOnViewModeChange : setLocalViewMode;

  const [edits, setEdits] = useState<Record<string, Partial<Tabulation>>>({});
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Calcula itens com alterações reais em relação ao catálogo original
  const dirtyItems = useMemo(() => {
    if (!q.data?.items) return [];
    return q.data.items.filter((item) => {
      const edit = edits[item.id];
      if (!edit) return false;
      const nextName = edit.name !== undefined ? edit.name.trim() : item.name.trim();
      const nextCpc = edit.isCpc !== undefined ? edit.isCpc : item.isCpc;
      const nextConv = edit.isConversion !== undefined ? edit.isConversion : item.isConversion;
      const nextOpt = edit.isOptOut !== undefined ? edit.isOptOut : item.isOptOut;
      const nextInv = edit.invalidatesDestination !== undefined ? edit.invalidatesDestination : item.invalidatesDestination;
      const nextChan = edit.channelTypes !== undefined ? edit.channelTypes : channelList(item.channelTypes);
      const origChan = channelList(item.channelTypes);

      return (
        nextName !== item.name.trim() ||
        nextCpc !== item.isCpc ||
        nextConv !== item.isConversion ||
        nextOpt !== item.isOptOut ||
        nextInv !== item.invalidatesDestination ||
        JSON.stringify(nextChan.slice().sort()) !== JSON.stringify(origChan.slice().sort())
      );
    });
  }, [q.data?.items, edits]);

  const isDirty = dirtyItems.length > 0;

  const updateItem = (id: string, patchObj: Partial<Tabulation>) => {
    setEdits((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        ...patchObj,
      },
    }));
  };

  const toggleIndicator = (
    item: Tabulation,
    key: 'isCpc' | 'isConversion' | 'invalidatesDestination' | 'isOptOut',
    currentVal: boolean,
  ) => {
    updateItem(item.id, { [key]: !currentVal });
  };

  const toggleChannel = (item: Tabulation, currentChannels: ChannelType[], ch: ChannelType) => {
    const nextChannels = currentChannels.includes(ch)
      ? currentChannels.filter((c) => c !== ch)
      : [...currentChannels, ch];
    updateItem(item.id, { channelTypes: nextChannels });
  };

  const handleDiscard = () => {
    setEdits({});
    setEditingNameId(null);
    toast('info', 'Alterações descartadas.');
  };

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      for (const item of dirtyItems) {
        const edit = edits[item.id];
        const payload: Partial<Tabulation> = {};
        if (edit.name !== undefined && edit.name.trim() !== item.name.trim()) {
          payload.name = edit.name.trim();
        }
        if (edit.isCpc !== undefined && edit.isCpc !== item.isCpc) {
          payload.isCpc = edit.isCpc;
        }
        if (edit.isConversion !== undefined && edit.isConversion !== item.isConversion) {
          payload.isConversion = edit.isConversion;
        }
        if (edit.isOptOut !== undefined && edit.isOptOut !== item.isOptOut) {
          payload.isOptOut = edit.isOptOut;
        }
        if (edit.invalidatesDestination !== undefined && edit.invalidatesDestination !== item.invalidatesDestination) {
          payload.invalidatesDestination = edit.invalidatesDestination;
        }
        if (
          edit.channelTypes !== undefined &&
          JSON.stringify(edit.channelTypes.slice().sort()) !== JSON.stringify(channelList(item.channelTypes).slice().sort())
        ) {
          payload.channelTypes = edit.channelTypes;
        }

        if (Object.keys(payload).length > 0) {
          await patch(`/tabulations/${item.id}`, payload);
        }
      }
      await qc.invalidateQueries({ queryKey: ['tabulations'] });
      setEdits({});
      setEditingNameId(null);
      toast('success', `${dirtyItems.length} tabulação(ões) salva(s) com sucesso.`);
    } catch (err) {
      toast('error', `Falha ao salvar tabulações: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-slate-800">Catálogo de Tabulações</h2>
          <InfoTooltip content="Resultados normalizados de máquina ou humano. A ação de cada tabulação é definida no template de estratégia." />
          <span className="text-xs text-slate-400 italic ml-2">
            {!isDirty ? 'Clique em cima de qualquer opção (nome, indicadores ou canais) para editar' : '● Alterações pendentes'}
          </span>
        </div>

        {/* Botão de Salvar no Topo: exibido somente se houver alteração (isDirty) */}
        {isDirty && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <Button size="sm" variant="secondary" onClick={handleDiscard} disabled={saving}>
              Descartar
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Save className="size-3.5" />}
              loading={saving}
              onClick={handleSave}
            >
              Salvar {dirtyItems.length} alteração(ões)
            </Button>
          </div>
        )}
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : viewMode === 'cards' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data!.items.map((t) => {
            const edit = edits[t.id] || {};
            const currentName = edit.name !== undefined ? edit.name : t.name;
            const currentChannels = edit.channelTypes !== undefined ? edit.channelTypes : channelList(t.channelTypes);
            const isItemDirty = dirtyItems.some((d) => d.id === t.id);

            return (
              <Card
                key={t.id}
                padded={false}
                className={clsx(
                  'group/row flex flex-col justify-between overflow-hidden transition',
                  isItemDirty && 'ring-1 ring-amber-300 bg-amber-50/10',
                )}
              >
                {/* Header do Card idêntico ao padrão de Jornadas */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
                  <div className="min-w-0 flex-1">
                    {editingNameId === t.id ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          autoFocus
                          value={currentName}
                          onChange={(e) => updateItem(t.id, { name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') setEditingNameId(null);
                          }}
                          onBlur={() => setEditingNameId(null)}
                          className="w-full max-w-xs rounded-lg border border-brand-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                          placeholder="Nome da tabulação"
                        />
                        <Badge tone="gray">{t.code}</Badge>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => setEditingNameId(t.id)}
                          className="font-bold text-sm text-slate-900 hover:text-brand-700 truncate cursor-pointer transition-colors"
                          title="Clique para editar o nome da tabulação"
                        >
                          {currentName}
                        </span>
                        <Badge tone="gray">{t.code}</Badge>
                        {isItemDirty && (
                          <span className="size-2 rounded-full bg-amber-500 shrink-0" title="Alterações pendentes" />
                        )}
                      </div>
                    )}
                    <span className="text-[11px] text-slate-500">
                      {currentChannels.length} canal(is) habilitado(s) · clique nos indicadores abaixo para alterar
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Pencil className="size-3.5" />}
                      onClick={() => setEditingNameId(t.id)}
                    >
                      Editar nome
                    </Button>
                  </div>
                </div>

                {/* Corpo do Card com Indicadores e Canais interativos */}
                <div className="p-4 space-y-3 flex-1">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs space-y-1.5">
                    <strong className="block text-slate-700">1. Indicadores de Resultado</strong>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {INDICATORS.map((ind) => {
                        const val = edit[ind.key] !== undefined ? !!edit[ind.key] : !!t[ind.key];
                        const isMod = edit[ind.key] !== undefined && edit[ind.key] !== t[ind.key];
                        return (
                          <button
                            key={ind.key}
                            type="button"
                            onClick={() => toggleIndicator(t, ind.key, val)}
                            title={`Clique para ${val ? 'desativar' : 'ativar'} ${ind.label} (${ind.tooltip})`}
                            className={clsx(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition cursor-pointer border shadow-2xs select-none',
                              val
                                ? ind.activeClass
                                : clsx(
                                    'text-slate-400 border-dashed border-slate-200 opacity-50 hover:!opacity-100 focus:opacity-100',
                                    ind.hoverClass,
                                  ),
                            )}
                          >
                            <span>{ind.label}</span>
                            {val && <Check className="size-2.5 text-current shrink-0 stroke-[2.5]" />}
                            {isMod && <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Modificado" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs space-y-1.5">
                    <strong className="block text-slate-700">2. Canais Compatíveis</strong>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {CHANNELS.map((ch) => {
                        const isSelected = currentChannels.includes(ch.type);
                        const origChannels = channelList(t.channelTypes);
                        const wasOrigSelected = origChannels.includes(ch.type);
                        const isMod = isSelected !== wasOrigSelected;
                        return (
                          <button
                            key={ch.type}
                            type="button"
                            onClick={() => toggleChannel(t, currentChannels, ch.type)}
                            title={`Clique para ${isSelected ? 'remover' : 'adicionar'} canal ${ch.label}`}
                            className={clsx(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition cursor-pointer border shadow-2xs select-none',
                              isSelected
                                ? ch.activeClass
                                : 'text-slate-400 border-dashed border-slate-200 opacity-50 hover:!opacity-100 focus:opacity-100 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50',
                            )}
                          >
                            <span>{ch.label}</span>
                            {isSelected && <Check className="size-2.5 text-current shrink-0 stroke-[2.5]" />}
                            {isMod && <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Canal modificado" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card padded={false}>
          <TableWrap label="Tabulações">
            <table className="data">
              <thead>
                <tr>
                  <th className="w-44">Código</th>
                  <th className="w-64">Nome</th>
                  <th>Indicadores</th>
                  <th>Canais</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((t) => {
                  const edit = edits[t.id] || {};
                  const currentName = edit.name !== undefined ? edit.name : t.name;
                  const currentChannels = edit.channelTypes !== undefined ? edit.channelTypes : channelList(t.channelTypes);
                  const isItemDirty = dirtyItems.some((d) => d.id === t.id);

                  return (
                    <tr
                      key={t.id}
                      className={clsx(
                        'group/row transition',
                        isItemDirty ? 'bg-amber-50/40 hover:bg-amber-50/60' : 'hover:bg-slate-50/80',
                      )}
                    >
                      {/* Código */}
                      <td className="font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-700">{t.code}</span>
                          {isItemDirty && (
                            <span
                              className="size-1.5 rounded-full bg-amber-500 shrink-0"
                              title="Tabulação modificada"
                            />
                          )}
                        </div>
                      </td>

                      {/* Nome: Clique direto para editar inline */}
                      <td>
                        {editingNameId === t.id ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              autoFocus
                              value={currentName}
                              onChange={(e) => updateItem(t.id, { name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') setEditingNameId(null);
                              }}
                              onBlur={() => setEditingNameId(null)}
                              className="w-full max-w-xs rounded-lg border border-brand-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                              placeholder="Nome da tabulação"
                            />
                          </div>
                        ) : (
                          <div
                            onClick={() => setEditingNameId(t.id)}
                            className="group/name inline-flex items-center gap-1.5 cursor-pointer py-1 px-1.5 -mx-1.5 rounded-md hover:bg-slate-200/60 transition"
                            title="Clique para editar o nome"
                          >
                            <span className="font-medium text-slate-800 group-hover/name:text-brand-700 text-xs">
                              {currentName}
                            </span>
                            <Pencil className="size-3 text-slate-300 opacity-0 group-hover/name:opacity-100 transition text-brand-600 shrink-0" />
                            {edit.name !== undefined && edit.name.trim() !== t.name.trim() && (
                              <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Nome modificado" />
                            )}
                          </div>
                        )}
                      </td>

                      {/* Indicadores: Pílulas interativas clicáveis */}
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                          {INDICATORS.map((ind) => {
                            const val = edit[ind.key] !== undefined ? !!edit[ind.key] : !!t[ind.key];
                            const isMod = edit[ind.key] !== undefined && edit[ind.key] !== t[ind.key];

                            return (
                              <button
                                key={ind.key}
                                type="button"
                                onClick={() => toggleIndicator(t, ind.key, val)}
                                title={`Clique para ${val ? 'desativar' : 'ativar'} ${ind.label} (${ind.tooltip})`}
                                className={clsx(
                                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition cursor-pointer border shadow-2xs select-none',
                                  val
                                    ? ind.activeClass
                                    : clsx(
                                        'text-slate-400 border-dashed border-slate-200 opacity-25 group-hover/row:opacity-100 hover:!opacity-100 focus:opacity-100',
                                        ind.hoverClass,
                                      ),
                                )}
                              >
                                <span>{ind.label}</span>
                                {val && <Check className="size-2.5 text-current shrink-0 stroke-[2.5]" />}
                                {isMod && (
                                  <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Modificado" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      {/* Canais: Pílulas interativas clicáveis */}
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                          {CHANNELS.map((ch) => {
                            const isSelected = currentChannels.includes(ch.type);
                            const origChannels = channelList(t.channelTypes);
                            const wasOrigSelected = origChannels.includes(ch.type);
                            const isMod = isSelected !== wasOrigSelected;

                            return (
                              <button
                                key={ch.type}
                                type="button"
                                onClick={() => toggleChannel(t, currentChannels, ch.type)}
                                title={`Clique para ${isSelected ? 'remover' : 'adicionar'} canal ${ch.label}`}
                                className={clsx(
                                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition cursor-pointer border shadow-2xs select-none',
                                  isSelected
                                    ? ch.activeClass
                                    : 'text-slate-400 border-dashed border-slate-200 opacity-25 group-hover/row:opacity-100 hover:!opacity-100 focus:opacity-100 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50',
                                )}
                              >
                                <span>{ch.label}</span>
                                {isSelected && <Check className="size-2.5 text-current shrink-0 stroke-[2.5]" />}
                                {isMod && (
                                  <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Canal modificado" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}

function NewTabulationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isCpc, setIsCpc] = useState(false);
  const [isConversion, setIsConversion] = useState(false);
  const [isOptOut, setIsOptOut] = useState(false);
  const [invalidatesDestination, setInvalidatesDestination] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      post<{ id: string }>('/tabulations', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        isCpc,
        isConversion,
        isOptOut,
        invalidatesDestination,
        channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tabulations'] });
      toast('success', `Tabulação "${name}" criada com sucesso.`);
      setCode('');
      setName('');
      setIsCpc(false);
      setIsConversion(false);
      setIsOptOut(false);
      setInvalidatesDestination(false);
      setErr(null);
      onOpenChange(false);
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nova Tabulação"
      description="Cadastre um resultado padronizado de atendimento humano ou automação."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              if (!code.trim() || !name.trim()) return setErr('Código e Nome são obrigatórios');
              m.mutate();
            }}
          >
            Cadastrar tabulação
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">{err}</div>}
        <Field label="Código identificador (SNAKE_CASE)" required tooltip="Identificador único utilizado nas integrações e logs (ex: ACORDO_PROMETIDO).">
          {(p) => (
            <Input
              id={p.id}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ex: ACORDO_PROMETIDO"
            />
          )}
        </Field>
        <Field label="Nome de exibição" required>
          {(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Acordo prometido para amanhã" />}
        </Field>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2 text-xs">
          <div className="font-semibold text-slate-800 mb-1">Classificação do Indicador:</div>
          <Checkbox label="Conta como Contato Efetivo / Pessoa Certa (CPC)" checked={isCpc} onChange={(e) => setIsCpc(e.target.checked)} />
          <Checkbox label="Conta como Conversão / Sucesso da Operação" checked={isConversion} onChange={(e) => setIsConversion(e.target.checked)} />
          <Checkbox label="Gera Opt-out permanente (Lista Não Perturbe / DNC)" checked={isOptOut} onChange={(e) => setIsOptOut(e.target.checked)} />
          <Checkbox label="Invalida o telefone / e-mail de destino (número inexistente)" checked={invalidatesDestination} onChange={(e) => setInvalidatesDestination(e.target.checked)} />
        </div>
      </div>
    </Modal>
  );
}

export function TabulationsPage() {
  const { can } = useAuth();
  const [openNew, setOpenNew] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Dicionário de Tabulações"
        tooltip="Resultados normalizados de máquina ou humano e parametrização de CPC, conversão e DNC."
        actions={
          <div className="flex items-center gap-2.5">
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
            {can('strategies.write') && (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpenNew(true)}>
                Nova tabulação
              </Button>
            )}
          </div>
        }
      />
      <TabulationsSection viewMode={viewMode} onViewModeChange={setViewMode} />
      <NewTabulationDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  );
}

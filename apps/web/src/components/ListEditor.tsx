import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { FILTER_OPS, REASON_LABEL, type ListFilter } from '@voll/shared';
import { ApiError, errorMessage, post } from '../lib/api';
import type { ListPreview, ListPublishResult } from '../lib/types';
import { fmtNumber } from '../lib/format';
import { Alert, Badge, Button, Field, Input, Loading, RadioCard, Select, Stat, TableWrap } from './ui';

const OP_LABEL: Record<(typeof FILTER_OPS)[number], string> = {
  eq: 'igual a',
  neq: 'diferente de',
  gt: 'maior que',
  gte: 'maior ou igual a',
  lt: 'menor que',
  lte: 'menor ou igual a',
  contains: 'contém',
  empty: 'está vazio',
  not_empty: 'está preenchido',
};

type Sort = { field: string; dir: 'asc' | 'desc' };
export type ListEditorState = { name: string; filters: ListFilter[]; sort: Sort[]; membershipMode: 'SNAPSHOT' | 'DYNAMIC' };

export function ListEditor({
  mailingId,
  initial,
  listId,
  publishLabel = 'Publicar lista',
  publishNote,
  onPublished,
  onChange,
  hidePublish,
  publishRef,
}: {
  mailingId: string;
  initial?: Partial<ListEditorState>;
  listId?: string;
  publishLabel?: string;
  publishNote?: string;
  onPublished: (r: ListPublishResult, s: ListEditorState) => void;
  onChange?: (s: ListEditorState, meta: { pending: boolean; selected: number | null }) => void;
  hidePublish?: boolean;
  /** permite ao pai disparar a publicação (rodapé do assistente) */
  publishRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [filters, setFilters] = useState<ListFilter[]>(initial?.filters ?? []);
  const [sort, setSort] = useState<Sort[]>(initial?.sort ?? []);
  const [mode, setMode] = useState<'SNAPSHOT' | 'DYNAMIC'>(initial?.membershipMode ?? 'SNAPSHOT');
  const [applied, setApplied] = useState<{ filters: ListFilter[]; sort: Sort[] }>({ filters: initial?.filters ?? [], sort: initial?.sort ?? [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showManual, setShowManual] = useState(true);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const baseFields = useQuery({
    queryKey: ['list-fields', mailingId],
    queryFn: () => post<ListPreview>('/lists/preview', { mailingId, filters: [], sort: [] }),
  });
  const preview = useQuery({
    queryKey: ['list-preview', mailingId, applied],
    queryFn: () => post<ListPreview>('/lists/preview', { mailingId, filters: applied.filters, sort: applied.sort }),
  });
  const fields = baseFields.data?.fields ?? [];
  const pending = JSON.stringify({ filters, sort }) !== JSON.stringify(applied);
  const invalidFilter = filters.findIndex((f) => !f.field || (!['empty', 'not_empty'].includes(f.op) && (f.value === undefined || f.value === '')));

  useEffect(() => {
    onChange?.({ name, filters: applied.filters, sort: applied.sort, membershipMode: mode }, { pending, selected: preview.data?.selected ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, applied, mode, pending, preview.data?.selected]);

  const publishM = useMutation({
    mutationFn: () =>
      post<ListPublishResult>('/lists', { mailingId, name, filters: applied.filters, sort: applied.sort, membershipMode: mode, listId }),
  });

  async function publish(): Promise<boolean> {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Informe o nome da lista';
    if (pending) e.pending = 'Há alterações de filtros não aplicadas. Aplique-as na prévia antes de continuar.';
    else if ((preview.data?.selected ?? 0) === 0) e.pending = 'A prévia não tem contatos disponíveis. Ajuste os filtros.';
    setErrors(e);
    if (e.name) {
      nameRef.current?.focus();
      return false;
    }
    if (e.pending) return false;
    try {
      const r = await publishM.mutateAsync();
      onPublished(r, { name, filters: applied.filters, sort: applied.sort, membershipMode: mode });
      return true;
    } catch (err) {
      const fe = err instanceof ApiError ? err.fieldErrors : {};
      setErrors({ name: fe.name ?? '', pending: fe.name ? '' : errorMessage(err) });
      if (fe.name) nameRef.current?.focus();
      return false;
    }
  }
  if (publishRef) publishRef.current = publish;

  const fieldType = (k: string) => fields.find((f) => f.key === k)?.type ?? 'text';
  const sampleCols = useMemo(() => fields.slice(0, 5).map((f) => f.key), [fields]);

  function toggleColumnSort(fieldKey: string) {
    const existingIndex = sort.findIndex((s) => s.field === fieldKey);
    let nextSort: Sort[];

    if (existingIndex === -1) {
      // Adiciona como primeira ou nova ordenação (até 3 no total)
      const newEntry: Sort = { field: fieldKey, dir: 'asc' };
      nextSort = [newEntry, ...sort].slice(0, 3);
    } else {
      const current = sort[existingIndex];
      if (current.dir === 'asc') {
        // asc -> desc
        nextSort = sort.map((s, idx) => (idx === existingIndex ? { ...s, dir: 'desc' as const } : s));
      } else {
        // desc -> remove
        nextSort = sort.filter((_, idx) => idx !== existingIndex);
      }
    }

    setSort(nextSort);
    // Aplica diretamente na prévia para resposta interativa instantânea
    setApplied((prev) => ({ ...prev, sort: nextSort }));
  }

  function getSortInfo(fieldKey: string) {
    const idx = applied.sort.findIndex((s) => s.field === fieldKey);
    if (idx === -1) return null;
    return { priority: idx + 1, dir: applied.sort[idx].dir, total: applied.sort.length };
  }

  function moveSortItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= applied.sort.length || to >= applied.sort.length) return;
    const nextSort = [...applied.sort];
    const [moved] = nextSort.splice(from, 1);
    nextSort.splice(to, 0, moved);
    setSort(nextSort);
    setApplied((prev) => ({ ...prev, sort: nextSort }));
  }

  function removeSortItem(idx: number) {
    const nextSort = applied.sort.filter((_, i) => i !== idx);
    setSort(nextSort);
    setApplied((prev) => ({ ...prev, sort: nextSort }));
  }

  return (
    <div className="space-y-4" data-testid="list-editor">
      <Field label="Nome da lista" required error={errors.name || undefined}>
        {(p) => (
          <Input id={p.id} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={p.describedBy} aria-invalid={p.invalid} />
        )}
      </Field>

      <fieldset>
        <legend className="mb-1 text-[13px] font-medium text-slate-800">Atualização dos membros</legend>
        <div className="grid gap-2 md:grid-cols-2">
          <RadioCard
            name="mode"
            value="SNAPSHOT"
            checked={mode === 'SNAPSHOT'}
            onChange={() => setMode('SNAPSHOT')}
            title="Fotografia da base"
            description="Congela os membros no momento da publicação. Novos registros do mailing não entram."
          />
          <RadioCard
            name="mode"
            value="DYNAMIC"
            checked={mode === 'DYNAMIC'}
            onChange={() => setMode('DYNAMIC')}
            title="Dinâmica"
            description="Reavalia os filtros publicados contra os dados atuais do mailing. Quem passar a atender entra; quem já foi acionado mantém o histórico."
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">DNC, limites e calendário continuam sendo revalidados a cada tentativa em ambas as modalidades.</p>
      </fieldset>

      <section className="rounded-lg border border-slate-200">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
          aria-expanded={showManual}
          aria-controls="manual-filters"
          onClick={() => setShowManual((s) => !s)}
        >
          Filtros e ordenação ({applied.filters.length} filtro{applied.filters.length === 1 ? '' : 's'} aplicado{applied.filters.length === 1 ? '' : 's'})
          <span className="text-xs text-brand-700">{showManual ? 'Recolher' : 'Expandir'}</span>
        </button>
        {showManual && (
          <div id="manual-filters" className="space-y-3 border-t border-slate-100 p-3">
            {filters.length === 0 && <p className="text-sm text-slate-500">Sem filtros: todos os contatos válidos do mailing.</p>}
            {filters.map((f, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" data-testid="filter-row">
                <Select
                  aria-label={`Campo do filtro ${i + 1}`}
                  value={f.field}
                  aria-invalid={invalidFilter === i && !f.field}
                  onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                >
                  <option value="">Campo…</option>
                  {fields.map((fl) => (
                    <option key={fl.key} value={fl.key}>
                      {fl.key}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={`Operador do filtro ${i + 1}`}
                  value={f.op}
                  onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, op: e.target.value as ListFilter['op'] } : x)))}
                >
                  {FILTER_OPS.map((o) => (
                    <option key={o} value={o}>
                      {OP_LABEL[o]}
                    </option>
                  ))}
                </Select>
                {['empty', 'not_empty'].includes(f.op) ? (
                  <span />
                ) : (
                  <Input
                    aria-label={`Valor do filtro ${i + 1}`}
                    type={fieldType(f.field) === 'number' ? 'number' : 'text'}
                    value={f.value === undefined ? '' : String(f.value)}
                    aria-invalid={invalidFilter === i && !!f.field}
                    onChange={(e) =>
                      setFilters((fs) =>
                        fs.map((x, j) =>
                          j === i
                            ? { ...x, value: fieldType(f.field) === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                )}
                <Button variant="ghost" aria-label={`Remover filtro ${i + 1}`} onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setFilters((fs) => [...fs, { field: '', op: 'eq', value: '' }])}>
                Adicionar filtro
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                disabled={!pending || invalidFilter >= 0}
                onClick={() => {
                  setApplied({ filters, sort });
                  setErrors((e) => ({ ...e, pending: '' }));
                }}
              >
                Aplicar filtros na prévia
              </Button>
              {pending && (
                <Badge tone="amber">Prévia pendente</Badge>
              )}
              {invalidFilter >= 0 && <span className="text-xs text-red-700">Complete o filtro {invalidFilter + 1}.</span>}
            </div>
          </div>
        )}
      </section>

      {errors.pending && <Alert tone="error">{errors.pending}</Alert>}

      <section aria-labelledby="preview-title" className="space-y-3">
        <h3 id="preview-title" className="text-sm font-semibold">
          Prévia
        </h3>
        {preview.isLoading ? (
          <Loading />
        ) : preview.error ? (
          <Alert tone="error">{errorMessage(preview.error)}</Alert>
        ) : (
          preview.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
                <Stat
                  label="Contatos disponíveis após filtros, validação e DNC"
                  value={<span data-testid="preview-selected">{fmtNumber(preview.data.selected)}</span>}
                  hint="Calendário, limites e capacidade são avaliados a cada tentativa."
                />
                <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                  <div className="mb-1 text-xs font-medium text-slate-600">Excluídos por motivo</div>
                  {preview.data.excluded.length === 0 ? (
                    <span className="text-slate-500">Nenhuma exclusão.</span>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {preview.data.excluded.map((x) => (
                        <li key={x.reason}>
                          <Badge tone="amber">
                            {REASON_LABEL[x.reason] ?? x.reason}: {fmtNumber(x.count)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-slate-500">
                  Clique no título da coluna para ordenar (crescente / decrescente / remover). Até 3 níveis simultâneos — arraste os cartões para reordenar a prioridade.
                </span>
                {applied.sort.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-700">Ordenação ativa:</span>
                    {applied.sort.map((s, idx) => {
                      const isDragging = dragIdx === idx;
                      const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx;
                      return (
                        <div
                          key={s.field}
                          draggable
                          onDragStart={(e) => {
                            setDragIdx(idx);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(idx));
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (overIdx !== idx) setOverIdx(idx);
                          }}
                          onDragLeave={() => {
                            if (overIdx === idx) setOverIdx(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const from = dragIdx ?? Number(e.dataTransfer.getData('text/plain'));
                            moveSortItem(from, idx);
                            setDragIdx(null);
                            setOverIdx(null);
                          }}
                          onDragEnd={() => {
                            setDragIdx(null);
                            setOverIdx(null);
                          }}
                          title="Clique e arraste para alterar a prioridade da ordenação"
                          className={`inline-flex cursor-grab active:cursor-grabbing items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset transition-all select-none ${
                            isDragging
                              ? 'opacity-50 ring-brand-400 scale-95'
                              : isOver
                                ? 'ring-2 ring-brand-600 bg-brand-100/80 shadow-xs'
                                : 'ring-brand-200 hover:bg-brand-100/50'
                          }`}
                        >
                          <GripVertical className="size-3.5 text-brand-600/80 shrink-0" aria-hidden />
                          {applied.sort.length > 1 && idx > 0 && (
                            <button
                              type="button"
                              aria-label={`Mover ${s.field} para trás`}
                              title="Mover para a esquerda (maior prioridade)"
                              onClick={() => moveSortItem(idx, idx - 1)}
                              className="rounded p-0.5 text-brand-700 hover:bg-brand-200/60"
                            >
                              <ChevronLeft className="size-3" aria-hidden />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleColumnSort(s.field)}
                            title="Clique para alternar crescente / decrescente"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <span className="font-bold">{idx + 1}º</span>
                            <span>{s.field}</span>
                            <span className="text-brand-700">({s.dir === 'asc' ? '↑ crescente' : '↓ decrescente'})</span>
                          </button>
                          {applied.sort.length > 1 && idx < applied.sort.length - 1 && (
                            <button
                              type="button"
                              aria-label={`Mover ${s.field} para frente`}
                              title="Mover para a direita (menor prioridade)"
                              onClick={() => moveSortItem(idx, idx + 1)}
                              className="rounded p-0.5 text-brand-700 hover:bg-brand-200/60"
                            >
                              <ChevronRight className="size-3" aria-hidden />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Remover ordenação ${s.field}`}
                            title="Remover esta ordenação"
                            onClick={() => removeSortItem(idx)}
                            className="ml-0.5 rounded-full p-0.5 text-brand-700/70 hover:bg-brand-200/70 hover:text-brand-900"
                          >
                            <X className="size-3" aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="ml-1 text-xs text-brand-700 underline hover:text-brand-900"
                      onClick={() => {
                        setSort([]);
                        setApplied((prev) => ({ ...prev, sort: [] }));
                      }}
                    >
                      Limpar
                    </button>
                  </div>
                )}
              </div>
              <TableWrap label="Amostra de contatos">
                <table className="data">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-brand-800"
                          onClick={() => toggleColumnSort('external_id')}
                        >
                          ID
                          <SortIcon info={getSortInfo('external_id')} />
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-brand-800"
                          onClick={() => toggleColumnSort('name')}
                        >
                          Nome
                          <SortIcon info={getSortInfo('name')} />
                        </button>
                      </th>
                      {sampleCols.map((c) => {
                        const sInfo = getSortInfo(c);
                        return (
                          <th key={c}>
                            <button
                              type="button"
                              className="group inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-brand-800"
                              onClick={() => toggleColumnSort(c)}
                            >
                              <span className="uppercase">{c}</span>
                              <SortIcon info={sInfo} />
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.sample.map((s) => (
                      <tr key={s.contactId}>
                        <td className="font-mono text-xs">{s.externalId}</td>
                        <td>{s.name ?? '—'}</td>
                        {sampleCols.map((c) => (
                          <td key={c} className="max-w-40 truncate">
                            {formatCell(s.fields[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          )
        )}
      </section>

      {!hidePublish && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {publishNote && <span className="text-xs text-slate-600">{publishNote}</span>}
          <Button variant="primary" loading={publishM.isPending} onClick={publish}>
            {publishLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

function SortIcon({ info }: { info: { priority: number; dir: 'asc' | 'desc'; total: number } | null }) {
  if (!info) {
    return <ArrowUpDown className="size-3 text-slate-400 opacity-40 group-hover:opacity-100" aria-hidden />;
  }
  return (
    <span className="inline-flex items-center text-brand-700 font-bold text-xs" title={`Ordenação ${info.priority}ª: ${info.dir === 'asc' ? 'crescente' : 'decrescente'}`}>
      {info.dir === 'asc' ? <ArrowUp className="size-3.5 stroke-[2.5]" aria-hidden /> : <ArrowDown className="size-3.5 stroke-[2.5]" aria-hidden />}
      {info.total > 1 && <span className="text-[10px] ml-0.5">{info.priority}</span>}
    </span>
  );
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
              <Field label="Ordenar por">
                {(p) => (
                  <Select
                    id={p.id}
                    value={sort[0]?.field ?? ''}
                    onChange={(e) => setSort(e.target.value ? [{ field: e.target.value, dir: sort[0]?.dir ?? 'asc' }] : [])}
                  >
                    <option value="">Ordem do mailing</option>
                    {fields.map((fl) => (
                      <option key={fl.key} value={fl.key}>
                        {fl.key}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Direção">
                {(p) => (
                  <Select
                    id={p.id}
                    disabled={!sort[0]}
                    value={sort[0]?.dir ?? 'asc'}
                    onChange={(e) => sort[0] && setSort([{ field: sort[0].field, dir: e.target.value as 'asc' | 'desc' }])}
                  >
                    <option value="asc">Crescente</option>
                    <option value="desc">Decrescente</option>
                  </Select>
                )}
              </Field>
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
              <TableWrap label="Amostra de contatos">
                <table className="data">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Nome</th>
                      {sampleCols.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
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

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

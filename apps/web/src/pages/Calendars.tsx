import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CalendarDays,
  CalendarPlus,
  Clock,
  Edit2,
  Globe,
  Plus,
  RotateCcw,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { del, errorMessage, get, patch, post } from '../lib/api';
import type { CalendarWindow, OperationCalendar } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Textarea,
  useToast,
} from '../components/ui';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (Brasília · Padrão)' },
  { value: 'America/Fortaleza', label: 'America/Fortaleza (Nordeste)' },
  { value: 'America/Belem', label: 'America/Belem (Pará)' },
  { value: 'America/Manaus', label: 'America/Manaus (Amazonas)' },
  { value: 'America/Cuiaba', label: 'America/Cuiaba (Mato Grosso)' },
  { value: 'America/Rio_Branco', label: 'America/Rio_Branco (Acre)' },
];

const NATIONAL_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: 'Confraternização Universal' },
  { date: '2026-04-03', name: 'Sexta-feira Santa' },
  { date: '2026-04-21', name: 'Tiradentes' },
  { date: '2026-05-01', name: 'Dia do Trabalho' },
  { date: '2026-09-07', name: 'Independência do Brasil' },
  { date: '2026-10-12', name: 'Nossa Senhora Aparecida' },
  { date: '2026-11-02', name: 'Finados' },
  { date: '2026-11-15', name: 'Proclamação da República' },
  { date: '2026-11-20', name: 'Dia da Consciência Negra' },
  { date: '2026-12-25', name: 'Natal' },
];

function formatWindowDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Todos os dias';
  if (JSON.stringify(sorted) === '[1,2,3,4,5]') return 'Seg a Sex';
  if (JSON.stringify(sorted) === '[1,2,3,4,5,6]') return 'Seg a Sáb';
  return sorted.map((d) => DAY_LABELS[d]).join(', ');
}

export function CalendarsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OperationCalendar | null>(null);
  const [holidayDraft, setHolidayDraft] = useState<Record<string, { date: string; name: string; action: 'BLOCK' | 'ALLOW' }>>({});

  const q = useQuery({
    queryKey: ['calendars', showArchived],
    queryFn: () => get<{ items: OperationCalendar[] }>(`/calendars${showArchived ? '?includeArchived=true' : ''}`),
  });

  const toggleActiveM = useMutation({
    mutationFn: (cal: OperationCalendar) => patch<OperationCalendar>(`/calendars/${cal.id}`, { active: !cal.active }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['calendars'] });
      toast('success', 'Status do calendário atualizado.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const archiveM = useMutation({
    mutationFn: (cal: OperationCalendar) =>
      post(`/calendars/${cal.id}/${cal.archivedAt ? 'restore' : 'archive'}`),
    onSuccess: async (_, cal) => {
      await qc.invalidateQueries({ queryKey: ['calendars'] });
      toast('success', cal.archivedAt ? 'Calendário restaurado.' : 'Calendário arquivado.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => del(`/calendars/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['calendars'] });
      toast('success', 'Calendário excluído.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const addHolidayM = useMutation({
    mutationFn: ({ calendarId, date, name, action }: { calendarId: string; date: string; name: string; action: 'BLOCK' | 'ALLOW' }) =>
      post(`/calendars/${calendarId}/holidays`, { date, name, action }),
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: ['calendars'] });
      setHolidayDraft((prev) => ({ ...prev, [vars.calendarId]: { date: '', name: '', action: 'BLOCK' } }));
      toast('success', 'Exceção registrada no calendário.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const importNationalM = useMutation({
    mutationFn: async (calendarId: string) => {
      for (const h of NATIONAL_HOLIDAYS_2026) {
        await post(`/calendars/${calendarId}/holidays`, { date: h.date, name: h.name, action: 'BLOCK' });
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['calendars'] });
      toast('success', 'Feriados nacionais de 2026 importados.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const removeHolidayM = useMutation({
    mutationFn: ({ calendarId, holidayId }: { calendarId: string; holidayId: string }) =>
      del(`/calendars/${calendarId}/holidays/${holidayId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['calendars'] });
      toast('success', 'Feriado removido.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendários"
        subtitle="Defina os dias da semana, janelas de horários, fuso e feriados em que as campanhas podem operar."
        tooltip="O calendário determina quando a campanha está autorizada a disparar. Disponível nos modos Básico e Avançado."
        actions={
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-slate-300 text-brand-700 focus:ring-brand-500"
              />
              Mostrar arquivados
            </label>
            <Button
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Novo calendário
            </Button>
          </div>
        }
      />

      {q.isLoading ? (
        <Loading rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Empty
          title="Nenhum calendário cadastrado"
          action={
            <Button
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Criar primeiro calendário
            </Button>
          }
        >
          Configure dias, horários e feriados permitidos para o disparo das suas campanhas.
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((cal) => {
            const draft = holidayDraft[cal.id] ?? { date: '', name: '', action: 'BLOCK' as const };
            return (
              <Card key={cal.id} className={clsx(cal.archivedAt && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CalendarDays className="size-4 shrink-0 text-brand-700" />
                      <h2 className="text-sm font-semibold text-slate-900">{cal.name}</h2>
                      {cal.archivedAt ? (
                        <Badge tone="gray">Arquivado</Badge>
                      ) : (
                        <Badge tone={cal.active ? 'green' : 'amber'}>{cal.active ? 'Ativo' : 'Inativo'}</Badge>
                      )}
                    </div>
                    {cal.description && <p className="text-xs text-slate-500">{cal.description}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Edit2 className="size-3" />}
                      onClick={() => {
                        setEditing(cal);
                        setModalOpen(true);
                      }}
                      title="Editar calendário"
                    >
                      Editar
                    </Button>
                    {!cal.archivedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActiveM.mutate(cal)}
                        title={cal.active ? 'Desativar' : 'Ativar'}
                      >
                        {cal.active ? 'Pausar' : 'Ativar'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={cal.archivedAt ? <RotateCcw className="size-3" /> : <Archive className="size-3" />}
                      onClick={() => archiveM.mutate(cal)}
                      title={cal.archivedAt ? 'Restaurar' : 'Arquivar'}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-700 hover:bg-red-50"
                      icon={<Trash2 className="size-3" />}
                      onClick={() => deleteM.mutate(cal.id)}
                      title="Excluir"
                    />
                  </div>
                </div>

                {/* Resumo de Janelas & Fuso */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
                    <Globe className="size-3 text-slate-500" />
                    {cal.timezone}
                  </span>
                  {cal.windows.map((w, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-2 py-1 font-medium text-brand-800"
                    >
                      <Clock className="size-3 text-brand-600" />
                      {formatWindowDays(w.days)} · {w.start}–{w.end}
                    </span>
                  ))}
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium',
                      cal.holidayPolicy === 'BLOCK' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800',
                    )}
                  >
                    {cal.holidayPolicy === 'BLOCK' ? (
                      <>
                        <ShieldBan className="size-3" /> Bloqueia feriados
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="size-3" /> Opera em feriados
                      </>
                    )}
                  </span>
                </div>

                {/* Feriados e Exceções */}
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Feriados e exceções ({cal.holidays.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => importNationalM.mutate(cal.id)}
                      disabled={importNationalM.isPending}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-900 hover:underline disabled:opacity-50"
                    >
                      <Sparkles className="size-3" />
                      Importar feriados nacionais 2026
                    </button>
                  </div>

                  {cal.holidays.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhuma exceção cadastrada neste calendário.</p>
                  ) : (
                    <ul className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                      {cal.holidays.map((h) => (
                        <li
                          key={h.id}
                          className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-medium text-slate-600">
                              {h.date.slice(0, 10).split('-').reverse().join('/')}
                            </span>
                            <span className="text-slate-800">{h.name}</span>
                            <Badge tone={h.action === 'BLOCK' ? 'amber' : 'green'}>
                              {h.action === 'BLOCK' ? 'Bloqueado' : 'Liberado'}
                            </Badge>
                          </div>
                          <button
                            type="button"
                            aria-label="Remover feriado"
                            onClick={() => removeHolidayM.mutate({ calendarId: cal.id, holidayId: h.id })}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Adicionar exceção rápida */}
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[130px_1fr_auto]">
                    <input
                      aria-label="Data do feriado"
                      type="date"
                      value={draft.date}
                      onChange={(e) =>
                        setHolidayDraft((prev) => ({
                          ...prev,
                          [cal.id]: { ...draft, date: e.target.value },
                        }))
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-brand-500 focus:outline-hidden"
                    />
                    <input
                      aria-label="Nome do feriado"
                      type="text"
                      placeholder="Ex: Feriado municipal / Aniversário da cidade"
                      value={draft.name}
                      onChange={(e) =>
                        setHolidayDraft((prev) => ({
                          ...prev,
                          [cal.id]: { ...draft, name: e.target.value },
                        }))
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-brand-500 focus:outline-hidden"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!draft.date || !draft.name.trim() || addHolidayM.isPending}
                      onClick={() =>
                        addHolidayM.mutate({
                          calendarId: cal.id,
                          date: draft.date,
                          name: draft.name.trim(),
                          action: draft.action,
                        })
                      }
                      icon={<CalendarPlus className="size-3.5" />}
                    >
                      Adicionar
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <CalendarFormModal
          open={modalOpen}
          target={editing}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setModalOpen(false);
            setEditing(null);
            await qc.invalidateQueries({ queryKey: ['calendars'] });
          }}
        />
      )}
    </div>
  );
}

function CalendarFormModal({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: OperationCalendar | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [timezone, setTimezone] = useState(target?.timezone ?? 'America/Sao_Paulo');
  const [holidayPolicy, setHolidayPolicy] = useState<'BLOCK' | 'ALLOW'>(target?.holidayPolicy ?? 'BLOCK');
  const [windows, setWindows] = useState<CalendarWindow[]>(
    target?.windows?.length
      ? target.windows
      : [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' }],
  );

  const saveM = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Informe o nome do calendário.');
      if (windows.length === 0 || windows.some((w) => w.days.length === 0)) {
        throw new Error('Selecione ao menos um dia em cada janela de funcionamento.');
      }
      if (windows.some((w) => w.end <= w.start)) {
        throw new Error('O horário final de todas as janelas deve ser posterior ao horário inicial.');
      }
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        timezone,
        windows,
        holidayPolicy,
        active: target ? target.active : true,
      };
      if (target) return patch(`/calendars/${target.id}`, payload);
      return post('/calendars', payload);
    },
    onSuccess: () => {
      toast('success', target ? 'Calendário atualizado!' : 'Calendário criado com sucesso!');
      onSaved();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const toggleDay = (winIdx: number, day: number) => {
    setWindows((prev) =>
      prev.map((w, idx) => {
        if (idx !== winIdx) return w;
        const has = w.days.includes(day);
        const days = has ? w.days.filter((d) => d !== day) : [...w.days, day].sort((a, b) => a - b);
        return { ...w, days };
      }),
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={target ? 'Editar calendário de funcionamento' : 'Novo calendário de funcionamento'}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome do calendário" required>
            {(f) => (
              <Input
                id={f.id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Comercial Brasil"
                autoFocus
              />
            )}
          </Field>

          <Field label="Fuso horário" required>
            {(f) => (
              <select
                id={f.id}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-brand-500 focus:outline-hidden"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field label="Descrição (opcional)">
          {(f) => (
            <Textarea
              id={f.id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Quando e para quais campanhas este calendário deve ser usado..."
            />
          )}
        </Field>

        {/* Janelas de dias e horários */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Janelas de funcionamento</span>
            <button
              type="button"
              onClick={() => setWindows((prev) => [...prev, { days: [6], start: '08:00', end: '14:00' }])}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
            >
              <Plus className="size-3.5" />
              Adicionar janela
            </button>
          </div>

          <div className="space-y-2.5">
            {windows.map((win, winIdx) => (
              <div key={winIdx} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Janela {winIdx + 1}
                  </span>
                  {windows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setWindows((prev) => prev.filter((_, idx) => idx !== winIdx))}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Remover
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS.map((label, dayIdx) => {
                    const active = win.days.includes(dayIdx);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleDay(winIdx, dayIdx)}
                        className={clsx(
                          'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                          active
                            ? 'border-brand-600 bg-brand-700 text-white'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100',
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-slate-600">
                    Início
                    <input
                      type="time"
                      value={win.start}
                      onChange={(e) =>
                        setWindows((prev) =>
                          prev.map((w, idx) => (idx === winIdx ? { ...w, start: e.target.value } : w)),
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Fim
                    <input
                      type="time"
                      value={win.end}
                      onChange={(e) =>
                        setWindows((prev) =>
                          prev.map((w, idx) => (idx === winIdx ? { ...w, end: e.target.value } : w)),
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Política de Feriados */}
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-700">Comportamento em feriados</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setHolidayPolicy('BLOCK')}
              className={clsx(
                'flex items-start gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors',
                holidayPolicy === 'BLOCK'
                  ? 'border-brand-600 bg-brand-50 text-brand-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <ShieldBan className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div>
                <div className="font-semibold">Bloquear feriados</div>
                <div className="text-[11px] text-slate-500">Pausa automaticamente nas datas cadastradas.</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setHolidayPolicy('ALLOW')}
              className={clsx(
                'flex items-start gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors',
                holidayPolicy === 'ALLOW'
                  ? 'border-brand-600 bg-brand-50 text-brand-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div>
                <div className="font-semibold">Permitir em feriados</div>
                <div className="text-[11px] text-slate-500">Operação contínua mesmo em feriados (24x7).</div>
              </div>
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={saveM.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => saveM.mutate()} disabled={saveM.isPending || !name.trim()}>
            {saveM.isPending ? 'Salvando...' : target ? 'Salvar alterações' : 'Criar calendário'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

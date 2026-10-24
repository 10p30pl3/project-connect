import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { StrategyConfigSchema, TABULATION_ACTIONS, TABULATION_ACTION_LABEL, type StrategyConfig } from '@voll/shared';
import { applyFieldErrors, get } from '../lib/api';
import type { Tabulation } from '../lib/types';
import { WEEKDAYS } from '../lib/format';
import { Alert, Button, Field, Input, Select } from './ui';

type Form = z.input<typeof StrategyConfigSchema>;

const firstError = (e: FieldErrors<Form>): string | null => {
  for (const v of Object.values(e)) {
    if (!v) continue;
    if (typeof (v as { message?: unknown }).message === 'string') return (v as { message: string }).message;
    const n = firstError(v as FieldErrors<Form>);
    if (n) return n;
  }
  return null;
};

/** Formulário completo da estratégia (configurações avançadas). Validação idêntica ao servidor (StrategyConfigSchema). */
export function StrategyForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  extraTop,
}: {
  initial: StrategyConfig;
  submitLabel: string;
  onSubmit: (c: StrategyConfig) => Promise<unknown>;
  onCancel?: () => void;
  extraTop?: React.ReactNode;
}) {
  const tabs = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });
  const [serverErr, setServerErr] = useState<string | null>(null);
  const form = useForm<Form>({ resolver: zodResolver(StrategyConfigSchema) as unknown as Resolver<Form>, defaultValues: initial, shouldFocusError: true });
  const { register, formState, watch, setValue } = form;
  const e = formState.errors;
  const days = watch('calendar.days') ?? [];

  const submit = form.handleSubmit(
    async (v) => {
      setServerErr(null);
      try {
        await onSubmit(StrategyConfigSchema.parse(v));
      } catch (err) {
        if (!applyFieldErrors(err, form.setError, { setFocus: form.setFocus, prefix: 'config.' })) setServerErr(err instanceof Error ? err.message : 'Erro');
        else setServerErr('Corrija os campos destacados. Nenhuma versão foi publicada.');
      }
    },
    () => setServerErr('Corrija os campos destacados. Nenhuma versão foi publicada.'),
  );
  const num = { valueAsNumber: true } as const;
  const anyErr = firstError(e);

  return (
    <form onSubmit={submit} noValidate className="space-y-5" data-testid="strategy-form">
      {extraTop}
      {(serverErr || anyErr) && formState.submitCount > 0 && (
        <Alert tone="error" title="Não foi possível publicar">
          {serverErr ?? anyErr}
        </Alert>
      )}
      <fieldset className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4">
        <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Calendário Operacional</legend>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-slate-700" id="days-label">
            Dias permitidos
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="days-label">
            {WEEKDAYS.map((d, i) => {
              const on = days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setValue(
                      'calendar.days',
                      on ? days.filter((x) => x !== i) : [...days, i].sort(),
                      { shouldDirty: true, shouldValidate: formState.submitCount > 0 },
                    )
                  }
                  className={`h-8 w-11 rounded-lg text-xs font-semibold transition-colors ring-1 ring-inset ${on ? 'bg-brand-700 text-white ring-brand-700 shadow-2xs' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          {e.calendar?.days && <p className="mt-1 text-xs font-medium text-red-700">{e.calendar.days.message}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Início da janela" required error={e.calendar?.start?.message}>
            {(p) => <Input id={p.id} type="time" aria-invalid={p.invalid} aria-describedby={p.describedBy} {...register('calendar.start')} />}
          </Field>
          <Field label="Fim da janela" required error={e.calendar?.end?.message}>
            {(p) => <Input id={p.id} type="time" aria-invalid={p.invalid} aria-describedby={p.describedBy} {...register('calendar.end')} />}
          </Field>
          <Field label="Fuso horário" error={e.calendar?.timezone?.message}>
            {(p) => (
              <Select id={p.id} {...register('calendar.timezone')}>
                <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                <option value="America/Manaus">America/Manaus</option>
                <option value="America/Fortaleza">America/Fortaleza</option>
                <option value="America/Cuiaba">America/Cuiaba</option>
                <option value="America/Rio_Branco">America/Rio_Branco</option>
                <option value="America/Noronha">America/Noronha</option>
              </Select>
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4">
        <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Tentativas, Limites e Retentativa</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Limite total por cliente" required error={e.limits?.total?.message}>
            {(p) => <Input id={p.id} type="number" min={1} aria-invalid={p.invalid} aria-describedby={p.describedBy} {...register('limits.total', num)} />}
          </Field>
          <Field label="Limite diário por cliente" required error={e.limits?.daily?.message}>
            {(p) => <Input id={p.id} type="number" min={1} aria-invalid={p.invalid} aria-describedby={p.describedBy} {...register('limits.daily', num)} />}
          </Field>
          <Field label="Escopo dos limites" error={e.limits?.scope?.message}>
            {(p) => (
              <Select id={p.id} {...register('limits.scope')}>
                <option value="WORKSPACE">Cliente no workspace</option>
                <option value="CAMPAIGN">Cliente nesta campanha</option>
              </Select>
            )}
          </Field>
          <Field label="Histórico incompleto" error={e.limits?.incompleteHistory?.message}>
            {(p) => (
              <Select id={p.id} {...register('limits.incompleteHistory')}>
                <option value="BLOCK">Aguardar revisão (bloquear)</option>
                <option value="USE_KNOWN">Usar somente o conhecido</option>
              </Select>
            )}
          </Field>
          <Field label="Intervalo de retentativa (min)" required error={e.retry?.intervalMinutes?.message}>
            {(p) => <Input id={p.id} type="number" min={1} aria-invalid={p.invalid} aria-describedby={p.describedBy} {...register('retry.intervalMinutes', num)} />}
          </Field>
          <Field label="Máximo por destino" required error={e.retry?.maxPerDestination?.message}>
            {(p) => <Input id={p.id} type="number" min={1} aria-invalid={p.invalid} aria-describedby={p.describedBy} {...register('retry.maxPerDestination', num)} />}
          </Field>
        </div>
        <p className="text-xs text-slate-500">Limites institucionais do Controle central prevalecem e não podem ser afrouxados pelo template.</p>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4">
        <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Distribuição e Integração</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tamanho do lote" error={e.distribution?.batchSize?.message}>
            {(p) => <Input id={p.id} type="number" min={1} max={500} aria-invalid={p.invalid} {...register('distribution.batchSize', num)} />}
          </Field>
          <Field label="Máximo pendente" error={e.distribution?.maxPending?.message}>
            {(p) => <Input id={p.id} type="number" min={1} aria-invalid={p.invalid} {...register('distribution.maxPending', num)} />}
          </Field>
          <Field label="Validade da reserva (s)" error={e.distribution?.leaseSeconds?.message}>
            {(p) => <Input id={p.id} type="number" min={10} max={3600} aria-invalid={p.invalid} {...register('distribution.leaseSeconds', num)} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4">
        <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Regras por Tabulação</legend>
        {!tabs.data ? (
          <p className="text-sm text-slate-500">Carregando tabulações…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {tabs.data.items.map((t) => (
              <Field key={t.code} label={`${t.name} (${t.code})`}>
                {(p) => (
                  <Select id={p.id} {...register(`tabulationRules.${t.code}` as const)} defaultValue={initial.tabulationRules[t.code] ?? (t.isConversion ? 'FINISH_SUCCESS' : 'RETRY')}>
                    {TABULATION_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {TABULATION_ACTION_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
        )}
        {tabs.data?.items.some((t) => t.isOptOut) && <p className="text-xs text-slate-500">Opt-out sempre aplica DNC, independentemente da ação configurada.</p>}
      </fieldset>

      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" variant="primary" loading={formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

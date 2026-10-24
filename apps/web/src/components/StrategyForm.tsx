import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import {
  OPTIMIZATION_POLICIES,
  OPTIMIZATION_POLICY_LABEL,
  StrategyConfigSchema,
  TABULATION_ACTIONS,
  TABULATION_ACTION_LABEL,
  type StrategyConfig,
} from '@voll/shared';
import { applyFieldErrors, get } from '../lib/api';
import type { Tabulation } from '../lib/types';
import { WEEKDAYS } from '../lib/format';
import { Alert, Button, Checkbox, Field, Input, Select } from './ui';

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

  function applyPreset(preset: 'PREVENTIVA' | 'PADRAO' | 'INTENSIVA') {
    if (preset === 'PREVENTIVA') {
      setValue('calendar.days', [1, 2, 3, 4, 5], { shouldDirty: true });
      setValue('calendar.start', '09:00', { shouldDirty: true });
      setValue('calendar.end', '18:00', { shouldDirty: true });
      setValue('limits.total', 6, { shouldDirty: true });
      setValue('limits.daily', 2, { shouldDirty: true });
      setValue('retry.intervalMinutes', 60, { shouldDirty: true });
      setValue('retry.maxPerDestination', 2, { shouldDirty: true });
    } else if (preset === 'PADRAO') {
      setValue('calendar.days', [1, 2, 3, 4, 5], { shouldDirty: true });
      setValue('calendar.start', '08:00', { shouldDirty: true });
      setValue('calendar.end', '20:00', { shouldDirty: true });
      setValue('limits.total', 10, { shouldDirty: true });
      setValue('limits.daily', 3, { shouldDirty: true });
      setValue('retry.intervalMinutes', 30, { shouldDirty: true });
      setValue('retry.maxPerDestination', 3, { shouldDirty: true });
    } else if (preset === 'INTENSIVA') {
      setValue('calendar.days', [1, 2, 3, 4, 5, 6], { shouldDirty: true });
      setValue('calendar.start', '08:00', { shouldDirty: true });
      setValue('calendar.end', '21:00', { shouldDirty: true });
      setValue('limits.total', 15, { shouldDirty: true });
      setValue('limits.daily', 5, { shouldDirty: true });
      setValue('retry.intervalMinutes', 15, { shouldDirty: true });
      setValue('retry.maxPerDestination', 5, { shouldDirty: true });
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" data-testid="strategy-form">
      {extraTop}
      {(serverErr || anyErr) && formState.submitCount > 0 && (
        <Alert tone="error" title="Não foi possível publicar">
          {serverErr ?? anyErr}
        </Alert>
      )}

      {/* Barra de Presets Rápidos de Cobrança */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">Perfis Rápidos de Cobrança</div>
          <div className="text-xs text-slate-500">Preencha rapidamente os parâmetros recomendados por faixa de atraso e ajuste se necessário:</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => applyPreset('PREVENTIVA')}>
            Preventiva Leve (1–15d)
          </Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset('PADRAO')}>
            Cobrança Padrão (16–60d)
          </Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset('INTENSIVA')}>
            Recuperação Intensiva (60d+)
          </Button>
        </div>
      </div>
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

      <fieldset className="space-y-3 rounded-xl border border-brand-200/80 bg-brand-50/20 p-4">
        <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-brand-800">Otimização Consultiva (§22)</legend>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
          <div>
            <div className="text-sm font-medium text-slate-900">Habilitar avaliação consultiva neste template</div>
            <div className="text-xs text-slate-500">Calcula propensão, melhor janela horária e menor custo por CPC na Central de Decisão sem sobrescrever DNC ou limites.</div>
          </div>
          <Checkbox
            label="Otimização ativa"
            defaultChecked={initial.optimization?.enabled ?? true}
            {...register('optimization.enabled')}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Política de recomendação" error={e.optimization?.policy?.message}>
            {(p) => (
              <Select id={p.id} defaultValue={initial.optimization?.policy ?? 'LOWEST_COST_PER_CPC'} {...register('optimization.policy')}>
                {OPTIMIZATION_POLICIES.map((pol) => (
                  <option key={pol} value={pol}>
                    {OPTIMIZATION_POLICY_LABEL[pol]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Mínimo de evidências históricas exigidas"
            hint="Abaixo desse volume, mantém a ordem padrão do template"
            error={e.optimization?.minEvidences?.message}
          >
            {(p) => (
              <Input
                id={p.id}
                type="number"
                min={1}
                max={50}
                defaultValue={initial.optimization?.minEvidences ?? 3}
                aria-invalid={p.invalid}
                {...register('optimization.minEvidences', num)}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <details className="group rounded-xl border border-slate-200/90 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          <span>Configurações Avançadas (Matriz de Tabulações e Lote de Distribuição)</span>
          <span className="text-xs font-normal text-brand-700 group-open:hidden">Expandir ajustes finos ↓</span>
          <span className="hidden text-xs font-normal text-slate-500 group-open:inline">Recolher ↑</span>
        </summary>
        <div className="space-y-4 border-t border-slate-100 p-4">
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
        </div>
      </details>

      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" variant="primary" loading={formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

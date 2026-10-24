import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { InstitutionalLimitsSchema } from '@voll/shared';
import { ApiError, errorMessage, get, put, qs } from '../lib/api';
import type { AuditRow, Control, Paginated } from '../lib/types';
import { fmtDateTimeSec } from '../lib/format';
import { useCursorPager } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Checkbox, ErrorState, Field, Input, Loading, PageHeader, Pager, TableWrap, useToast } from '../components/ui';

export function ControlPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['control'], queryFn: () => get<Control>('/control') });
  const [daily, setDaily] = useState('');
  const [total, setTotal] = useState('');
  const [susp, setSusp] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) {
      setDaily(q.data.dailyLimit === null ? '' : String(q.data.dailyLimit));
      setTotal(q.data.totalLimit === null ? '' : String(q.data.totalLimit));
      setSusp(q.data.globalSuspension);
    }
  }, [q.data]);
  const m = useMutation({
    mutationFn: (b: unknown) => put<Control>('/control', b),
    onSuccess: () => {
      toast('success', 'Controle central atualizado e auditado.');
      setReason('');
      qc.invalidateQueries({ queryKey: ['control'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fieldErrors).length ? e.fieldErrors : { form: errorMessage(e) }),
  });
  function save() {
    const body = {
      dailyLimit: daily.trim() === '' ? null : Number(daily),
      totalLimit: total.trim() === '' ? null : Number(total),
      globalSuspension: susp,
      reason,
    };
    const r = InstitutionalLimitsSchema.safeParse(body);
    if (!r.success) {
      const e: Record<string, string> = {};
      for (const i of r.error.issues) e[i.path.join('.')] ??= i.message;
      setErrors(e);
      document.getElementById(Object.keys(e)[0] === 'reason' ? 'ctl-reason' : Object.keys(e)[0] === 'totalLimit' ? 'ctl-total' : 'ctl-daily')?.focus();
      return;
    }
    setErrors({});
    m.mutate(body);
  }
  const readOnly = !can('control.write');
  return (
    <div>
      <PageHeader title="Controle central" subtitle="Limites institucionais e suspensão global — prevalecem sobre qualquer estratégia" />
      <div className="grid gap-4 lg:grid-cols-[28rem_1fr]">
        <Card title="Limites institucionais por cliente">
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            <div className="space-y-3">
              {errors.form && <Alert tone="error">{errors.form}</Alert>}
              <p className="text-xs text-slate-600">Vazio = usa o limite do template. Um limite preenchido pode restringir, nunca ampliar, a estratégia.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Máximo diário" error={errors.dailyLimit}>
                  {(p) => (
                    <Input id="ctl-daily" type="number" min={1} disabled={readOnly} value={daily} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setDaily(e.target.value)} />
                  )}
                </Field>
                <Field label="Máximo total" error={errors.totalLimit}>
                  {(p) => (
                    <Input id="ctl-total" type="number" min={1} disabled={readOnly} value={total} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setTotal(e.target.value)} />
                  )}
                </Field>
              </div>
              <Checkbox
                label={<span>Suspensão global (impede novas reservas e envios em todas as campanhas)</span>}
                checked={susp}
                disabled={readOnly}
                onChange={(e) => setSusp(e.target.checked)}
              />
              {susp && <Alert tone="warn">Com a suspensão ativa, retornos de tentativas já enviadas continuam sendo processados.</Alert>}
              {!readOnly && (
                <>
                  <Field label="Motivo da alteração" required error={errors.reason}>
                    {(p) => <Input id="ctl-reason" value={reason} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setReason(e.target.value)} />}
                  </Field>
                  <div className="flex justify-end">
                    <Button variant="primary" loading={m.isPending} onClick={save}>
                      Salvar
                    </Button>
                  </div>
                </>
              )}
              <p className="text-xs text-slate-500">Bloqueios de cliente ou destino são aplicados no cadastro do contato.</p>
            </div>
          )}
        </Card>
        <AuditCard />
      </div>
    </div>
  );
}

function AuditCard() {
  const pager = useCursorPager();
  const q = useQuery({
    queryKey: ['audit', pager.cursor],
    queryFn: () => get<Paginated<AuditRow>>(`/audit${qs({ cursor: pager.cursor })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <Card title="Trilha de auditoria" padded={false}>
      {q.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : q.error ? (
        <div className="p-4">
          <ErrorState error={q.error} />
        </div>
      ) : (
        <>
          <TableWrap label="Auditoria">
            <table className="data">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Ação</th>
                  <th>Entidade</th>
                  <th>Motivo</th>
                  <th>Antes → depois</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      Nenhum registro.
                    </td>
                  </tr>
                )}
                {q.data!.items.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTimeSec(a.at)}</td>
                    <td>{a.user?.name ?? 'Sistema'}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td className="text-xs">
                      {a.entity}
                      {a.entityId && <div className="font-mono text-[11px] text-slate-500">{a.entityId.slice(0, 8)}</div>}
                    </td>
                    <td className="text-xs">{a.reason ?? '—'}</td>
                    <td className="max-w-72 text-[11px]">
                      <details>
                        <summary className="cursor-pointer text-brand-700">ver</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify({ antes: a.before, depois: a.after }, null, 1)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pager page={pager.page} hasNext={!!q.data!.nextCursor} onPrev={pager.prev} onNext={() => pager.next(q.data!.nextCursor)} />
        </>
      )}
    </Card>
  );
}

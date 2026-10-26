import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { InstitutionalLimitsSchema } from '@voll/shared';
import { ApiError, errorMessage, get, put } from '../lib/api';
import type { Control } from '../lib/types';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Input,
  Loading,
  PageHeader,
  useToast,
} from '../components/ui';

export function LimitsPage() {
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
      toast('success', 'Limites institucionais atualizados e registrados na trilha de governança.');
      setReason('');
      qc.invalidateQueries({ queryKey: ['control'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? e.fieldErrors
          : { form: errorMessage(e) },
      ),
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
      document
        .getElementById(
          Object.keys(e)[0] === 'reason'
            ? 'ctl-reason'
            : Object.keys(e)[0] === 'totalLimit'
            ? 'ctl-total'
            : 'ctl-daily',
        )
        ?.focus();
      return;
    }
    setErrors({});
    m.mutate(body);
  }

  const readOnly = !can('control.write');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Limites Institucionais"
        tooltip="Tetos de volume e suspensão global preventiva — prevalecem sobre qualquer campanha ou estratégia."
        actions={
          <Link
            to="/observabilidade"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
          >
            <FileText className="size-3.5 text-brand-700" aria-hidden />
            Ver Trilha de Observabilidade →
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Card
            title="Parâmetros de Proteção Institucional"
            tooltip="Estes limites são as travas máximas da organização. Um valor preenchido aqui pode restringir, mas nunca ser superado por templates de estratégia ou jornadas. Deixe em branco para respeitar o limite individual de cada estratégia."
          >
            {q.isLoading ? (
              <Loading />
            ) : q.error ? (
              <ErrorState error={q.error} />
            ) : (
              <div className="space-y-4">
                {errors.form && <Alert tone="error">{errors.form}</Alert>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Máximo de tentativas diárias"
                    error={errors.dailyLimit}
                    tooltip="Teto de tentativas por dia para todo o cliente."
                  >
                    {(p) => (
                      <Input
                        id="ctl-daily"
                        type="number"
                        min={1}
                        disabled={readOnly}
                        value={daily}
                        placeholder="Ilimitado (usa template)"
                        aria-invalid={p.invalid}
                        aria-describedby={p.describedBy}
                        onChange={(e) => setDaily(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    label="Máximo de tentativas totais"
                    error={errors.totalLimit}
                    tooltip="Teto acumulado por contato durante o ciclo."
                  >
                    {(p) => (
                      <Input
                        id="ctl-total"
                        type="number"
                        min={1}
                        disabled={readOnly}
                        value={total}
                        placeholder="Ilimitado (usa template)"
                        aria-invalid={p.invalid}
                        aria-describedby={p.describedBy}
                        onChange={(e) => setTotal(e.target.value)}
                      />
                    )}
                  </Field>
                </div>

                <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-4">
                  <Checkbox
                    label={
                      <span className="font-semibold text-amber-950">
                        Suspensão Global Emergencial (Kill-Switch)
                      </span>
                    }
                    checked={susp}
                    disabled={readOnly}
                    onChange={(e) => setSusp(e.target.checked)}
                  />
                  <p className="mt-1 text-xs text-amber-800 ml-6">
                    Quando ativado, novas reservas e envios de todas as campanhas são congelados imediatamente.
                    Retornos de tentativas já enviadas continuam sendo processados normalmente.
                  </p>
                </div>

                {susp && (
                  <Alert tone="warn">
                    <strong>ATENÇÃO:</strong> A suspensão global está ATIVA. Nenhuma campanha em andamento disparará novas tentativas até o desbloqueio.
                  </Alert>
                )}

                {!readOnly && (
                  <div className="border-t border-slate-200/80 pt-4 space-y-3">
                    <Field label="Motivo da alteração (obrigatório para auditoria)" required error={errors.reason}>
                      {(p) => (
                        <Input
                          id="ctl-reason"
                          placeholder="Ex: Ajuste de política mensal, conformidade ou solicitação de compliance"
                          value={reason}
                          aria-invalid={p.invalid}
                          aria-describedby={p.describedBy}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      )}
                    </Field>
                    <div className="flex justify-end">
                      <Button variant="primary" loading={m.isPending} onClick={save}>
                        Salvar e Auditar Limites
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <Card title="Status de Governança">
            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-slate-500">Operação Global:</span>
                {susp ? (
                  <Badge tone="red">Suspensão Ativa</Badge>
                ) : (
                  <Badge tone="green">Normal / Liberada</Badge>
                )}
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-slate-500">Teto Diário:</span>
                <span className="font-semibold text-slate-900">{daily ? `${daily} tentativas` : 'Sem teto fixo'}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-slate-500">Teto Total:</span>
                <span className="font-semibold text-slate-900">{total ? `${total} tentativas` : 'Sem teto fixo'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Conformidade LGPD:</span>
                <span className="font-semibold text-emerald-700">Auditável 100%</span>
              </div>
            </div>
          </Card>

          <Card title="Proteções Complementares">
            <ul className="space-y-2.5 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <ShieldCheck className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>Não Perturbe (DNC/Procon):</strong> Bloqueios automáticos no cadastro antes do envio.</span>
              </li>
              <li className="flex items-start gap-2">
                <Lock className="size-4 text-brand-600 shrink-0 mt-0.5" />
                <span><strong>Bloqueios de Destino:</strong> Aplicados diretamente na ficha de cada contato.</span>
              </li>
              <li className="flex items-start gap-2">
                <FileText className="size-4 text-blue-600 shrink-0 mt-0.5" />
                <span><strong>Trilha Imutável:</strong> Toda alteração exige justificativa e gera log de auditoria.</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { CHANNEL_LABEL, ResolveReconciliationSchema } from '@voll/shared';
import type { z } from 'zod';
import { applyFieldErrors, errorMessage, get, post } from '../lib/api';
import type { AttemptDetail, Tabulation } from '../lib/types';
import { fmtDateTimeSec, fmtMoney } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, AttemptStateBadge, Badge, Button, ErrorState, Field, KeyValue, Loading, Modal, Select, Input, useToast } from './ui';
import { Link } from 'react-router-dom';
import { Copy, Repeat, Wrench } from 'lucide-react';

/** Abre o detalhe de uma tentativa em qualquer tela via ?tentativa=<id> (§26.7). */
export function useOpenAttempt() {
  const [sp, setSp] = useSearchParams();
  return (id: string) => {
    const n = new URLSearchParams(sp);
    n.set('tentativa', id);
    setSp(n);
  };
}

export function AttemptDrawer() {
  const [sp, setSp] = useSearchParams();
  const id = sp.get('tentativa');
  const close = () => {
    const n = new URLSearchParams(sp);
    n.delete('tentativa');
    setSp(n);
  };
  return (
    <Modal open={!!id} onOpenChange={(o) => !o && close()} title="Detalhe da tentativa" side>
      {id && <AttemptBody id={id} />}
    </Modal>
  );
}

function AttemptBody({ id }: { id: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => get<AttemptDetail>(`/attempts/${id}`), refetchInterval: 3000 });
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const [showTech, setShowTech] = useState(false);

  const repeat = useMutation({
    mutationFn: () => post(`/sim/attempts/${id}/repeat-last-event`),
    onSuccess: () => {
      toast('info', 'Último evento reenviado. Ele deve aparecer como duplicado, sem novo efeito.');
      qc.invalidateQueries({ queryKey: ['attempt', id] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isLoading) return <Loading rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const a = d.attempt;
  const canSim = can('sim.use') && ['SENT', 'AWAITING_FEEDBACK', 'RECONCILIATION', 'FINALIZED'].includes(a.state);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs text-slate-500">Cliente</div>
          <Link to={`/contatos/${a.contact.id}`} className="text-base font-semibold text-brand-800 hover:underline">
            {a.contact.name ?? '(sem nome)'}
          </Link>
          <div className="text-xs text-slate-500">ID {a.contact.externalId}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <AttemptStateBadge state={a.state} label={a.stateLabel} />
          <span className="text-xs text-slate-600">
            {CHANNEL_LABEL[a.channelType]} · {a.connectionName} · {a.destinationMasked}
          </span>
          {a.campaign && (
            <Link to={`/campanhas/${a.campaign.id}`} className="text-xs text-brand-700 hover:underline">
              {a.campaign.name}
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        <Explain title="O que aconteceu" text={d.explanation.whatHappened} />
        <Explain title="Por que está assim" text={d.explanation.why} />
        <Explain title="Próxima ação" text={d.explanation.nextAction} strong />
      </div>

      {a.state === 'RECONCILIATION' && (
        <Alert tone="warn" title="Novo envio bloqueado">
          O envio foi aceito pelo canal, mas o resultado não chegou de forma confiável. Nenhuma nova tentativa é feita para este cliente até a
          reconciliação.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {a.state === 'RECONCILIATION' && can('attempts.reconcile') && (
          <Button variant="primary" onClick={() => setReconcileOpen(true)}>
            Resolver reconciliação
          </Button>
        )}
        {canSim && (
          <>
            <Button icon={<Repeat className="size-4" aria-hidden />} loading={repeat.isPending} onClick={() => repeat.mutate()}>
              Repetir último evento
            </Button>
            {a.state !== 'FINALIZED' && (
              <Button icon={<Wrench className="size-4" aria-hidden />} onClick={() => setForceOpen(true)}>
                Forçar resultado (simulador)
              </Button>
            )}
          </>
        )}
      </div>

      <section aria-labelledby="tl-title">
        <h3 id="tl-title" className="mb-2 text-sm font-semibold">
          Linha do tempo
        </h3>
        {d.timeline.length === 0 ? (
          <p className="text-sm text-slate-500">Sem eventos registrados (histórico parcial).</p>
        ) : (
          <ol className="relative space-y-3 border-l border-slate-200 pl-4">
            {d.timeline.map((ev) => (
              <li key={ev.id} className="relative">
                <span
                  className={`absolute -left-[21px] top-1 size-2.5 rounded-full ${ev.duplicate ? 'bg-slate-300' : 'bg-brand-600'}`}
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={ev.duplicate ? 'text-slate-500 line-through decoration-slate-300' : 'font-medium'}>{ev.label || ev.eventType}</span>
                  {ev.duplicate && <Badge tone="gray">Duplicado — ignorado, sem novo efeito</Badge>}
                  {ev.reasonCode && <Badge tone="amber">{ev.reasonCode}</Badge>}
                </div>
                <div className="text-xs text-slate-500">
                  {fmtDateTimeSec(ev.occurredAt)}
                  {ev.receivedAt && ev.receivedAt !== ev.occurredAt && <> · recebido {fmtDateTimeSec(ev.receivedAt)}</>}
                  {ev.fromState && ev.toState && ev.fromState !== ev.toState && (
                    <>
                      {' '}
                      · {ev.fromState} → {ev.toState}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <button
          type="button"
          className="text-sm font-medium text-brand-800 hover:underline"
          aria-expanded={showTech}
          aria-controls="tech-details"
          onClick={() => setShowTech((s) => !s)}
        >
          {showTech ? 'Ocultar detalhes técnicos' : 'Detalhes técnicos'}
        </button>
        {showTech && (
          <div id="tech-details" className="mt-3 space-y-3">
            <KeyValue
              items={[
                ['attempt_id', <Mono v={a.id} />],
                ['trace_id', <Mono v={a.traceId} />],
                ['ID no provedor', a.providerAttemptId ? <Mono v={a.providerAttemptId} /> : '—'],
                ['Versão da estratégia', <Mono v={a.strategyVersionId} />],
                ['Versão da jornada', <Mono v={a.journeyVersionId} />],
                ['Etapa', a.stage + 1],
                ['Tarifa preservada', a.tariffSnapshot === null ? 'não informada' : fmtMoney(a.tariffSnapshot, 4)],
                ['Custo confirmado', a.costConfirmed === null ? '—' : fmtMoney(a.costConfirmed, 4)],
                ['Reserva válida até', fmtDateTimeSec(a.leaseUntil)],
                ['Prazo de feedback', fmtDateTimeSec(a.feedbackDeadline)],
                ['Criada', fmtDateTimeSec(a.createdAt)],
                ['Enviada', fmtDateTimeSec(a.sentAt)],
                ['Finalizada', fmtDateTimeSec(a.finalizedAt)],
              ]}
            />
            <details>
              <summary className="cursor-pointer text-sm text-slate-700">Registro estruturado (JSON)</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-900 p-3 text-[11px] text-slate-100">{JSON.stringify(d, null, 2)}</pre>
            </details>
          </div>
        )}
      </section>

      <ReconcileDialog id={id} open={reconcileOpen} onOpenChange={setReconcileOpen} />
      <ForceResultDialog id={id} open={forceOpen} onOpenChange={setForceOpen} />
    </div>
  );
}

function Mono({ v }: { v: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      {v}
      <button type="button" aria-label="Copiar" className="text-slate-400 hover:text-slate-700" onClick={() => navigator.clipboard?.writeText(v)}>
        <Copy className="size-3" aria-hidden />
      </button>
    </span>
  );
}

function Explain({ title, text, strong }: { title: string; text: string; strong?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${strong ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-0.5 text-sm text-slate-900">{text || '—'}</div>
    </div>
  );
}

type ReconcileForm = z.infer<typeof ResolveReconciliationSchema>;
function ReconcileDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tabs = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations'), enabled: open });
  const form = useForm<ReconcileForm>({ resolver: zodResolver(ResolveReconciliationSchema), defaultValues: { resolution: 'CONFIRM_FAILED', reason: '' } });
  const resolution = form.watch('resolution');
  const m = useMutation({
    mutationFn: (v: ReconcileForm) => post(`/attempts/${id}/reconcile`, v),
    onSuccess: () => {
      toast('success', 'Reconciliação resolvida e registrada na auditoria.');
      qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError, { setFocus: form.setFocus })) toast('error', errorMessage(e));
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Resolver reconciliação"
      description="Registre o que foi confirmado com o canal. A ação é auditada."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={form.handleSubmit((v) => m.mutate(v))}>
            Confirmar resolução
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="Resolução" required error={form.formState.errors.resolution?.message}>
          {(p) => (
            <Select id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} {...form.register('resolution')}>
              <option value="CONFIRM_FAILED">Falha confirmada com o canal (sem contato)</option>
              <option value="TABULATE">Registrar resultado conhecido</option>
            </Select>
          )}
        </Field>
        {resolution === 'TABULATE' && (
          <Field label="Tabulação" required error={form.formState.errors.tabulationCode?.message}>
            {(p) => (
              <Select id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} {...form.register('tabulationCode')}>
                <option value="">Selecione…</option>
                {tabs.data?.items.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Motivo" required error={form.formState.errors.reason?.message}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} {...form.register('reason')} />}
        </Field>
      </form>
    </Modal>
  );
}

function ForceResultDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState('');
  const tabs = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations'), enabled: open });
  const m = useMutation({
    mutationFn: () => post(`/sim/attempts/${id}/result`, { tabulationCode: code }),
    onSuccess: () => {
      toast('success', 'Resultado enviado pelo conector simulado.');
      qc.invalidateQueries({ queryKey: ['attempt', id] });
      onOpenChange(false);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Forçar resultado (simulador)"
      description="Envia um webhook do conector simulado com a tabulação escolhida. Disponível só em ambiente de demonstração."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" disabled={!code} loading={m.isPending} onClick={() => m.mutate()}>
            Enviar resultado
          </Button>
        </>
      }
    >
      <Field label="Tabulação" required>
        {(p) => (
          <Select id={p.id} value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">Selecione…</option>
            {tabs.data?.items.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name} ({t.code})
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}

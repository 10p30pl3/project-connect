import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CHANNEL_LABEL } from '@voll/shared';
import { ApiError, errorMessage, get, patch } from '../lib/api';
import type { Connection, Simulation, Tabulation } from '../lib/types';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Card, Checkbox, ErrorState, Field, Input, Loading, Modal, PageHeader, TableWrap, useToast } from '../components/ui';

export function ChannelsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['connections'], queryFn: () => get<{ items: Connection[] }>('/connections') });
  const [edit, setEdit] = useState<Connection | null>(null);
  return (
    <div>
      <PageHeader title="Canais" subtitle="Conexões por tipo de canal, tarifa de referência e parâmetros do conector simulado" />
      <Alert tone="info" className="mb-4">
        Tarifa vazia significa <strong>desconhecida</strong>; zero significa <strong>gratuito</strong>. Cada envio preserva a tarifa vigente no momento —
        alterar a tarifa não muda o custo de envios anteriores.
      </Alert>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card padded={false}>
          <TableWrap label="Conexões">
            <table className="data">
              <thead>
                <tr>
                  <th>Conexão</th>
                  <th>Canal</th>
                  <th>Provedor</th>
                  <th>Tarifa por tentativa</th>
                  <th>Situação</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td>
                    <td>{CHANNEL_LABEL[c.channelType]}</td>
                    <td>{c.provider === 'SIMULATED' ? <Badge tone="brand">Simulado</Badge> : c.provider}</td>
                    <td>
                      {c.tariff === null ? <span className="text-slate-500">desconhecida</span> : fmtMoney(c.tariff, 4)}
                      {c.tariffUpdatedAt && <div className="text-xs text-slate-500">desde {fmtDateTime(c.tariffUpdatedAt)}</div>}
                    </td>
                    <td>{c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>}</td>
                    <td className="text-right">
                      {can('connections.write') && (
                        <Button size="sm" onClick={() => setEdit(c)}>
                          Configurar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      {edit && <EditConnection c={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditConnection({ c, onClose }: { c: Connection; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tabs = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });
  const [name, setName] = useState(c.name);
  const [tariff, setTariff] = useState(c.tariff === null ? '' : String(c.tariff).replace('.', ','));
  const [active, setActive] = useState(c.active);
  const [sim, setSim] = useState<Simulation | null>(c.simulation ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => patch(`/connections/${c.id}`, body),
    onSuccess: () => {
      toast('success', 'Conexão atualizada.');
      qc.invalidateQueries({ queryKey: ['connections'] });
      onClose();
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fieldErrors).length ? e.fieldErrors : { form: errorMessage(e) }),
  });
  function save() {
    const e: Record<string, string> = {};
    let t: number | null = null;
    if (tariff.trim() !== '') {
      const norm = tariff.replace(/\./g, '').replace(',', '.');
      if (!/^\d+(\.\d{1,4})?$/.test(norm)) e.tariff = 'Valor não negativo com até 4 casas decimais (ex.: 0,0850)';
      else t = Number(norm);
    }
    if (!name.trim()) e.name = 'Informe o nome';
    if (sim && sim.minDelaySeconds > sim.maxDelaySeconds) e['simulation.maxDelaySeconds'] = 'Deve ser maior ou igual ao mínimo';
    setErrors(e);
    if (Object.keys(e).length) return;
    m.mutate({ name, tariff: t, active, ...(sim ? { simulation: sim } : {}) });
  }
  const outcomeCodes = sim ? Object.keys(sim.outcomes) : [];
  const tabName = (code: string) => tabs.data?.items.find((t) => t.code === code)?.name ?? code;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={`Configurar ${c.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" required error={errors.name}>
            {(p) => <Input id={p.id} value={name} aria-invalid={p.invalid} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Tarifa por tentativa enviada (R$)" error={errors.tariff} hint="Vazio = desconhecida · 0 = gratuita · até 4 casas decimais">
            {(p) => (
              <Input id={p.id} inputMode="decimal" placeholder="desconhecida" value={tariff} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setTariff(e.target.value)} />
            )}
          </Field>
        </div>
        <Checkbox label="Conexão ativa" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {sim && (
          <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">Conector simulado</legend>
            <p className="text-xs text-slate-600">Pesos relativos de cada resultado devolvido por webhook. Somente para demonstração.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {outcomeCodes.map((code) => (
                <Field key={code} label={tabName(code)}>
                  {(p) => (
                    <Input
                      id={p.id}
                      type="number"
                      min={0}
                      value={sim.outcomes[code]}
                      onChange={(e) => setSim({ ...sim, outcomes: { ...sim.outcomes, [code]: Math.max(0, Number(e.target.value)) } })}
                    />
                  )}
                </Field>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Atraso mínimo (s)">
                {(p) => <Input id={p.id} type="number" min={0} value={sim.minDelaySeconds} onChange={(e) => setSim({ ...sim, minDelaySeconds: Number(e.target.value) })} />}
              </Field>
              <Field label="Atraso máximo (s)" error={errors['simulation.maxDelaySeconds']}>
                {(p) => <Input id={p.id} type="number" min={0} aria-invalid={p.invalid} value={sim.maxDelaySeconds} onChange={(e) => setSim({ ...sim, maxDelaySeconds: Number(e.target.value) })} />}
              </Field>
              <Field label="Taxa de webhook duplicado (0–1)">
                {(p) => (
                  <Input id={p.id} type="number" step="0.05" min={0} max={1} value={sim.duplicateRate} onChange={(e) => setSim({ ...sim, duplicateRate: Number(e.target.value) })} />
                )}
              </Field>
              <Field label="Taxa sem retorno (0–1)">
                {(p) => (
                  <Input id={p.id} type="number" step="0.05" min={0} max={1} value={sim.noReturnRate} onChange={(e) => setSim({ ...sim, noReturnRate: Number(e.target.value) })} />
                )}
              </Field>
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

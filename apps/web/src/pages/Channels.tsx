import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowRight, Pencil, Plus } from 'lucide-react';
import { CHANNEL_LABEL, type ChannelType } from '@voll/shared';
import { ApiError, errorMessage, get, patch, post } from '../lib/api';
import type { Connection, Simulation, Tabulation } from '../lib/types';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Card, Checkbox, Empty, ErrorState, Field, InfoTooltip, Input, Loading, Modal, PageHeader, Select, TableWrap, useToast, ViewModeToggle, type ViewMode } from '../components/ui';

export function ChannelsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['connections'], queryFn: () => get<{ items: Connection[] }>('/connections') });
  const [edit, setEdit] = useState<Connection | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const canEdit = can('connections.write');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Canais"
        tooltip="Tarifa vazia significa desconhecida; zero significa gratuito. Cada envio preserva a tarifa vigente no momento — alterar a tarifa não recalcula envios anteriores."
        actions={
          <div className="flex items-center gap-2.5">
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
            {canEdit && (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpenNew(true)}>
                Novo canal
              </Button>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-slate-800">Conexões e Conectores de Canal</h2>
        <InfoTooltip content="Integrações configuradas para envio de mensagens, discagem e simulação de webhooks." />
        <span className="text-xs text-slate-400 italic ml-2">
          Clique em &quot;Editar canal&quot; para configurar tarifas, disponibilidade e parâmetros de simulação
        </span>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty title="Nenhum canal cadastrado" />
      ) : viewMode === 'cards' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data!.items.map((c) => {
            const sim = c.simulation;
            return (
              <Card key={c.id} padded={false} className="flex flex-col justify-between overflow-hidden">
                {/* Header do Card idêntico ao padrão de Jornadas */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 truncate">{c.name}</span>
                      <Badge tone="gray">{CHANNEL_LABEL[c.channelType]}</Badge>
                      {c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Provedor {c.provider === 'SIMULATED' ? 'Simulado' : c.provider}
                      {c.tariffUpdatedAt ? ` · atualizado em ${fmtDateTime(c.tariffUpdatedAt)}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Pencil className="size-3.5" />}
                        onClick={() => setEdit(c)}
                      >
                        Editar canal
                      </Button>
                    )}
                  </div>
                </div>

                {/* Corpo do Card com blocos encadeados igual ao JourneySteps */}
                <div className="p-4 space-y-3 flex-1">
                  <div
                    onClick={() => canEdit && setEdit(c)}
                    className={canEdit ? 'cursor-pointer group/steps rounded-lg p-1 -m-1 hover:bg-slate-50/80 transition' : ''}
                    title={canEdit ? 'Clique para configurar este canal' : undefined}
                  >
                    <ol className="flex flex-wrap items-center gap-2" aria-label="Parâmetros do canal">
                      <li className="flex items-center gap-2">
                        <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                          <strong>1. Canal &amp; Conector</strong>
                          <span className="text-slate-500"> · {CHANNEL_LABEL[c.channelType]}</span>
                          <span className="block text-slate-500">
                            Provedor: {c.provider === 'SIMULATED' ? 'Simulado (Demo)' : c.provider}
                          </span>
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <ArrowRight className="size-4 text-slate-400" aria-hidden />
                        <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                          <strong>2. Tarifa por Tentativa</strong>
                          <span className="text-slate-500">
                            {' '}
                            · {c.tariff === null ? 'Desconhecida' : fmtMoney(c.tariff, 4)}
                          </span>
                          <span className="block text-slate-500">
                            {c.tariffUpdatedAt ? `Desde ${fmtDateTime(c.tariffUpdatedAt)}` : 'Valor de referência'}
                          </span>
                        </span>
                      </li>
                      {sim && (
                        <li className="flex items-center gap-2">
                          <ArrowRight className="size-4 text-slate-400" aria-hidden />
                          <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                            <strong>3. Simulação de Entrega</strong>
                            <span className="text-slate-500">
                              {' '}
                              · {sim.minDelaySeconds}s–{sim.maxDelaySeconds}s
                            </span>
                            <span className="block text-slate-500">
                              Sem retorno: {Math.round(sim.noReturnRate * 100)}% · Duplicado: {Math.round(sim.duplicateRate * 100)}%
                            </span>
                          </span>
                        </li>
                      )}
                    </ol>
                    {canEdit && (
                      <div className="mt-2 text-[11px] text-slate-400 opacity-0 group-hover/steps:opacity-100 transition flex items-center gap-1 text-brand-600 font-medium">
                        <Pencil className="size-3" /> Clique para configurar este canal
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
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
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition">
                    <td className="font-medium">{c.name}</td>
                    <td>{CHANNEL_LABEL[c.channelType]}</td>
                    <td>{c.provider === 'SIMULATED' ? <Badge tone="brand">Simulado</Badge> : c.provider}</td>
                    <td>
                      {c.tariff === null ? <span className="text-slate-500">desconhecida</span> : fmtMoney(c.tariff, 4)}
                      {c.tariffUpdatedAt && <div className="text-xs text-slate-500">desde {fmtDateTime(c.tariffUpdatedAt)}</div>}
                    </td>
                    <td>{c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>}</td>
                    <td className="text-right">
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Pencil className="size-3.5" />}
                          onClick={() => setEdit(c)}
                        >
                          Editar canal
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
      <NewConnectionDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  );
}

function NewConnectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [channelType, setChannelType] = useState<ChannelType>('WHATSAPP');
  const [provider, setProvider] = useState('SIMULATED');
  const [tariff, setTariff] = useState('0.05');
  const [err, setErr] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      post<Connection>('/connections', {
        name: name.trim(),
        channelType,
        provider: provider.trim() || 'SIMULATED',
        tariff: tariff === '' ? null : Number(tariff),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      toast('success', `Canal "${res.name}" criado com sucesso.`);
      setName('');
      setChannelType('WHATSAPP');
      setTariff('0.05');
      setErr(null);
      onOpenChange(false);
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Novo Canal de Comunicação"
      description="Cadastre uma nova conexão ou conector simulado para envio de mensagens e chamadas."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              if (!name.trim()) return setErr('Informe o nome da conexão');
              m.mutate();
            }}
          >
            Cadastrar canal
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">{err}</div>}
        <Field label="Nome da conexão" required>
          {(p) => <Input id={p.id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: WhatsApp Oficial Meta Cloud" />}
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tipo do canal" required>
            {(p) => (
              <Select id={p.id} value={channelType} onChange={(e) => setChannelType(e.target.value as ChannelType)}>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="VOICE">Discador (Voz)</option>
                <option value="SMS">SMS / RCS</option>
                <option value="EMAIL">E-mail</option>
              </Select>
            )}
          </Field>
          <Field label="Provedor do conector" required>
            {(p) => (
              <Select id={p.id} value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="SIMULATED">Simulado (Ambiente de Testes)</option>
                <option value="META_CLOUD">Meta Cloud API (Oficial)</option>
                <option value="TWILIO">Twilio Voice / SMS</option>
                <option value="SENDGRID">SendGrid E-mail</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Tarifa de referência por tentativa (R$)" tooltip="Custo estimado por envio para fins de cálculo de CPC. Deixe em branco se for desconhecido ou 0 para gratuito.">
          {(p) => (
            <Input
              id={p.id}
              type="number"
              step="0.0001"
              min="0"
              value={tariff}
              onChange={(e) => setTariff(e.target.value)}
              placeholder="0,0500"
            />
          )}
        </Field>
      </div>
    </Modal>
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
  const tabName = (code: string) => {
    if (code === 'RESULT_UNKNOWN') return 'Resultado inconclusivo';
    return tabs.data?.items.find((t) => t.code === code)?.name ?? code;
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={`Configurar ${c.name}`}
      description={`Canal ${CHANNEL_LABEL[c.channelType]} · Provedor ${c.provider === 'SIMULATED' ? 'Simulado' : c.provider}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={save}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}

        <fieldset className="space-y-3.5 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4">
          <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Identificação e Tarifação</legend>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label="Nome da conexão" required error={errors.name}>
              {(p) => <Input id={p.id} value={name} aria-invalid={p.invalid} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Tarifa por tentativa enviada (R$)" error={errors.tariff} hint="Vazio = desconhecida · 0 = gratuita · até 4 casas decimais">
              {(p) => (
                <Input
                  id={p.id}
                  inputMode="decimal"
                  placeholder="desconhecida"
                  value={tariff}
                  aria-invalid={p.invalid}
                  aria-describedby={p.describedBy}
                  onChange={(e) => setTariff(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
            <div>
              <div className="text-sm font-medium text-slate-800">Disponibilidade da conexão</div>
              <div className="text-xs text-slate-500">Permite que novas tentativas sejam despachadas por esta conexão nas jornadas ativas.</div>
            </div>
            <Checkbox label="Conexão ativa" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </div>
        </fieldset>

        {sim && (
          <fieldset className="space-y-4 rounded-xl border border-slate-200/90 bg-white p-4">
            <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Parâmetros do Conector Simulado</legend>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Pesos relativos de resultado (Webhooks)</span>
                <span className="text-[11px] text-slate-500">Distribuição de probabilidade na demonstração</span>
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-3">
                {outcomeCodes.map((code) => (
                  <Field key={code} label={tabName(code)}>
                    {(p) => (
                      <Input
                        id={p.id}
                        type="number"
                        step="0.1"
                        min={0}
                        value={sim.outcomes[code]}
                        onChange={(e) => setSim({ ...sim, outcomes: { ...sim.outcomes, [code]: Math.max(0, Number(e.target.value)) } })}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Latência e confiabilidade de entrega</span>
                <span className="text-[11px] text-slate-500">Simulação de atrasos, duplicidades e timeouts</span>
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Atraso mínimo (s)">
                  {(p) => <Input id={p.id} type="number" min={0} value={sim.minDelaySeconds} onChange={(e) => setSim({ ...sim, minDelaySeconds: Number(e.target.value) })} />}
                </Field>
                <Field label="Atraso máximo (s)" error={errors['simulation.maxDelaySeconds']}>
                  {(p) => (
                    <Input
                      id={p.id}
                      type="number"
                      min={0}
                      aria-invalid={p.invalid}
                      value={sim.maxDelaySeconds}
                      onChange={(e) => setSim({ ...sim, maxDelaySeconds: Number(e.target.value) })}
                    />
                  )}
                </Field>
                <Field label="Webhook duplicado (0–1)">
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
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

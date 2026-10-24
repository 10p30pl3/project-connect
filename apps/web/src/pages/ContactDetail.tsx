import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { ArrowLeft, Ban, Eye, EyeOff, Plus } from 'lucide-react';
import { BlockCreateSchema, CHANNEL_LABEL, CHANNEL_TYPES, DestinationCreateSchema, ENROLLMENT_STATE_LABEL } from '@voll/shared';
import { applyFieldErrors, errorMessage, get, patch, post } from '../lib/api';
import type { ContactDetail, Destination } from '../lib/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  KeyValue,
  Loading,
  Modal,
  PageHeader,
  Select,
  TableWrap,
  useToast,
} from '../components/ui';
import { AttemptsTable } from '../components/AttemptsTable';
import { formatCell } from '../components/ListEditor';

export function ContactDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['contact', id], queryFn: () => get<ContactDetail>(`/contacts/${id}`) });
  const [addOpen, setAddOpen] = useState(false);
  const [block, setBlock] = useState<null | { scope: 'CONTACT' | 'DESTINATION'; destination?: Destination }>(null);

  if (q.isLoading) return <Loading rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const contactBlock = d.blocks.find((b) => b.scope === 'CONTACT' && !b.revokedAt);

  return (
    <div>
      <PageHeader
        back={
          <Link to="/contatos" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-3.5" aria-hidden /> Contatos
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.contact.name ?? '(sem nome)'}
            {contactBlock && (
              <Badge tone="red" icon={<Ban className="size-3.5" aria-hidden />}>
                Bloqueado (DNC)
              </Badge>
            )}
          </span>
        }
        subtitle={<span className="font-mono">ID {d.contact.externalId}</span>}
        actions={
          can('blocks.write') &&
          !contactBlock && (
            <Button variant="danger" icon={<Ban className="size-4" aria-hidden />} onClick={() => setBlock({ scope: 'CONTACT' })}>
              Bloquear cliente
            </Button>
          )
        }
      />
      {contactBlock && (
        <Alert tone="error" className="mb-4" title="Cliente bloqueado em todos os canais">
          Motivo: {contactBlock.reason} · origem {contactBlock.origin} · desde {fmtDateTime(contactBlock.createdAt)}. Reservas e retornos futuros foram
          cancelados.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Destinos"
          padded={false}
          actions={
            can('contacts.write') && (
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAddOpen(true)}>
                Adicionar destino
              </Button>
            )
          }
        >
          <DestinationsTable contactId={id} items={d.destinations} onBlock={(dest) => setBlock({ scope: 'DESTINATION', destination: dest })} />
        </Card>
        <Card title="Contadores">
          <KeyValue
            items={[
              ['Histórico importado', d.counters.historyTotal === null ? <span className="text-slate-500">desconhecido</span> : fmtNumber(d.counters.historyTotal)],
              ['Novas tentativas', fmtNumber(d.counters.newTotal)],
              ['Hoje', fmtNumber(d.counters.today)],
              ...d.counters.byChannel.map((c) => [CHANNEL_LABEL[c.channelType], fmtNumber(c.count)] as [string, string]),
            ]}
          />
          {d.contact.historyReferenceDate && <p className="mt-2 text-xs text-slate-500">Histórico com referência em {d.contact.historyReferenceDate}.</p>}
        </Card>
        <Card title="Inscrições em campanhas" className="lg:col-span-1">
          {d.enrollments.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma inscrição.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.enrollments.map((e) => (
                <li key={e.campaign.id} className="flex justify-between gap-2">
                  <Link to={`/campanhas/${e.campaign.id}`} className="text-brand-800 hover:underline">
                    {e.campaign.name}
                  </Link>
                  <span className="text-xs text-slate-600">
                    {ENROLLMENT_STATE_LABEL[e.state]} · etapa {e.stage + 1}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Campos do cadastro" className="lg:col-span-2">
          {Object.keys(d.contact.attributes).length === 0 ? (
            <p className="text-sm text-slate-500">Sem campos adicionais.</p>
          ) : (
            <KeyValue items={Object.entries(d.contact.attributes).map(([k, v]) => [k, formatCell(v)])} />
          )}
        </Card>
        <Card title="Últimas tentativas" className="lg:col-span-3" padded={false}>
          <AttemptsTable items={d.attempts} showCampaign emptyText="Este contato ainda não foi acionado." />
        </Card>
        {d.blocks.length > 0 && (
          <Card title="Histórico de bloqueios" className="lg:col-span-3" padded={false}>
            <BlocksTable blocks={d.blocks} destinations={d.destinations} contactId={id} />
          </Card>
        )}
      </div>
      <AddDestinationDialog contactId={id} open={addOpen} onOpenChange={setAddOpen} />
      <BlockDialog contactId={id} state={block} onClose={() => setBlock(null)} />
    </div>
  );
}

function DestinationsTable({ contactId, items, onBlock }: { contactId: string; items: Destination[]; onBlock: (d: Destination) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const m = useMutation({
    mutationFn: (v: { id: string; valid: boolean }) => patch(`/contacts/${contactId}/destinations/${v.id}`, { valid: v.valid }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contact', contactId] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (items.length === 0) return <p className="p-4 text-sm text-slate-500">Sem destinos cadastrados.</p>;
  return (
    <TableWrap label="Destinos">
      <table className="data">
        <thead>
          <tr>
            <th>Canal</th>
            <th>Endereço</th>
            <th>Rótulo</th>
            <th>Prioridade</th>
            <th>Situação</th>
            <th>
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              <td>{CHANNEL_LABEL[d.channelType]}</td>
              <td className="font-mono text-xs">
                {revealed[d.id] ? d.address : d.addressMasked}{' '}
                <button
                  type="button"
                  className="ml-1 align-middle text-slate-400 hover:text-slate-700"
                  aria-label={revealed[d.id] ? 'Ocultar endereço' : 'Revelar endereço'}
                  onClick={() => setRevealed((r) => ({ ...r, [d.id]: !r[d.id] }))}
                >
                  {revealed[d.id] ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                </button>
              </td>
              <td>{d.label ?? '—'}</td>
              <td className="tabular">{d.priority}</td>
              <td className="space-x-1">
                {d.blocked ? <Badge tone="red">Bloqueado</Badge> : d.valid ? <Badge tone="green">Válido</Badge> : <Badge tone="amber">Inválido</Badge>}
              </td>
              <td className="whitespace-nowrap text-right">
                {can('contacts.write') && (
                  <Button size="sm" variant="ghost" onClick={() => m.mutate({ id: d.id, valid: !d.valid })}>
                    {d.valid ? 'Marcar inválido' : 'Marcar válido'}
                  </Button>
                )}
                {can('blocks.write') && !d.blocked && (
                  <Button size="sm" variant="ghost" onClick={() => onBlock(d)}>
                    Bloquear
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function BlocksTable({ blocks, destinations, contactId }: { blocks: ContactDetail['blocks']; destinations: Destination[]; contactId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [revoke, setRevoke] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post(`/blocks/${revoke}/revoke`, { reason }),
    onSuccess: () => {
      toast('success', 'Bloqueio revogado e auditado.');
      setRevoke(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <>
      <TableWrap label="Bloqueios">
        <table className="data">
          <thead>
            <tr>
              <th>Abrangência</th>
              <th>Motivo</th>
              <th>Origem</th>
              <th>Desde</th>
              <th>Revogado</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.scope === 'CONTACT' ? 'Cliente em todos os canais' : `Destino ${destinations.find((x) => x.id === b.destinationId)?.addressMasked ?? ''}`}
                </td>
                <td>{b.reason}</td>
                <td>{b.origin}</td>
                <td className="text-xs">{fmtDateTime(b.createdAt)}</td>
                <td className="text-xs">{fmtDateTime(b.revokedAt)}</td>
                <td className="text-right">
                  {!b.revokedAt && can('blocks.revoke') && (
                    <Button size="sm" variant="ghost" onClick={() => setRevoke(b.id)}>
                      Revogar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Modal
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revogar bloqueio"
        description="Revise a origem da restrição antes de revogar. A ação é auditada."
        footer={
          <>
            <Button onClick={() => setRevoke(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={m.isPending}
              onClick={() => (reason.trim().length < 3 ? setErr('Informe o motivo') : m.mutate())}
            >
              Revogar
            </Button>
          </>
        }
      >
        <Field label="Motivo" required error={err ?? undefined}>
          {(p) => <Input id={p.id} value={reason} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}

type DestForm = z.input<typeof DestinationCreateSchema>;
function AddDestinationDialog({ contactId, open, onOpenChange }: { contactId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<DestForm>({ resolver: zodResolver(DestinationCreateSchema), defaultValues: { channelType: 'VOICE', address: '', label: '', priority: 1 } });
  const m = useMutation({
    mutationFn: (v: DestForm) => post(`/contacts/${contactId}/destinations`, v),
    onSuccess: () => {
      toast('success', 'Destino adicionado.');
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      form.reset();
      onOpenChange(false);
    },
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError, { setFocus: form.setFocus })) form.setError('address', { message: errorMessage(e) });
    },
  });
  const submit = form.handleSubmit((v) => m.mutate(v));
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar destino"
      description="Telefones com DDI e DDD (10 a 15 dígitos). O mesmo número não pode se repetir no mesmo canal."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Adicionar
          </Button>
        </>
      }
    >
      <form className="grid gap-3" onSubmit={submit}>
        <Field label="Canal" required error={e.channelType?.message}>
          {(p) => (
            <Select id={p.id} {...form.register('channelType')}>
              {CHANNEL_TYPES.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Endereço (telefone ou e-mail)" required error={e.address?.message}>
          {(p) => <Input id={p.id} aria-invalid={p.invalid} aria-describedby={p.describedBy} {...form.register('address')} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rótulo" error={e.label?.message}>
            {(p) => <Input id={p.id} placeholder="Ex.: celular" {...form.register('label')} />}
          </Field>
          <Field label="Prioridade" error={e.priority?.message}>
            {(p) => <Input id={p.id} type="number" min={1} max={99} aria-invalid={p.invalid} {...form.register('priority', { valueAsNumber: true })} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

type BlockForm = z.infer<typeof BlockCreateSchema>;
function BlockDialog({
  contactId,
  state,
  onClose,
}: {
  contactId: string;
  state: null | { scope: 'CONTACT' | 'DESTINATION'; destination?: Destination };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (v: BlockForm) => post('/blocks', v),
    onSuccess: () => {
      toast('success', 'Bloqueio aplicado. Reservas não enviadas foram canceladas.');
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      setReason('');
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Modal
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={state?.scope === 'CONTACT' ? 'Bloquear cliente em todos os canais' : `Bloquear destino ${state?.destination?.addressMasked ?? ''}`}
      description="Impede novos envios no escopo definido e cancela reservas e retornos ainda não enviados. Tentativas já enviadas permanecem no histórico."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            loading={m.isPending}
            onClick={() => {
              if (reason.trim().length < 3) return setErr('Informe o motivo (mínimo 3 caracteres)');
              m.mutate({ scope: state!.scope, contactId, destinationId: state?.destination?.id, reason });
            }}
          >
            Aplicar bloqueio
          </Button>
        </>
      }
    >
      <Field label="Motivo" required error={err ?? undefined}>
        {(p) => (
          <Input
            id={p.id}
            autoFocus
            value={reason}
            aria-invalid={p.invalid}
            aria-describedby={p.describedBy}
            onChange={(e) => {
              setReason(e.target.value);
              setErr(null);
            }}
          />
        )}
      </Field>
    </Modal>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CHANNEL_LABEL, type ChannelType } from '@voll/shared';

import { errorMessage, get, post } from '../lib/api';
import type { Tabulation } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, Checkbox, ErrorState, Field, InfoTooltip, Input, Loading, Modal, PageHeader, TableWrap, useToast } from '../components/ui';

/** Aceita array ou literal de array do Postgres ("{VOICE,SMS}"). */
function channelList(v: unknown): ChannelType[] {
  if (Array.isArray(v)) return v as ChannelType[];
  if (typeof v === 'string') return v.replace(/[{}]/g, '').split(',').filter(Boolean) as ChannelType[];
  return [];
}

export function TabulationsSection() {
  const q = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-slate-800">Catálogo de Tabulações</h2>
        <InfoTooltip content="Resultados normalizados de máquina ou humano. A ação de cada tabulação é definida no template de estratégia." />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card padded={false}>
          <TableWrap label="Tabulações">
            <table className="data">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nome</th>
                  <th>Indicadores</th>
                  <th>Canais</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((t) => (
                  <tr key={t.id}>
                    <td className="font-mono text-xs">{t.code}</td>
                    <td>{t.name}</td>
                    <td className="space-x-1">
                      {t.isCpc && <Badge tone="blue">CPC</Badge>}
                      {t.isConversion && <Badge tone="green">Conversão</Badge>}
                      {t.isOptOut && <Badge tone="red">Opt-out (DNC)</Badge>}
                      {t.invalidatesDestination && <Badge tone="amber">Invalida destino</Badge>}
                      {!t.isCpc && !t.isConversion && !t.isOptOut && !t.invalidatesDestination && <span className="text-slate-400">—</span>}
                    </td>
                    <td className="text-xs">{channelList(t.channelTypes).map((c) => CHANNEL_LABEL[c] ?? c).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}

function NewTabulationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isCpc, setIsCpc] = useState(false);
  const [isConversion, setIsConversion] = useState(false);
  const [isOptOut, setIsOptOut] = useState(false);
  const [invalidatesDestination, setInvalidatesDestination] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      post<{ id: string }>('/tabulations', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        isCpc,
        isConversion,
        isOptOut,
        invalidatesDestination,
        channelTypes: ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tabulations'] });
      toast('success', `Tabulação "${name}" criada com sucesso.`);
      setCode('');
      setName('');
      setIsCpc(false);
      setIsConversion(false);
      setIsOptOut(false);
      setInvalidatesDestination(false);
      setErr(null);
      onOpenChange(false);
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nova Tabulação"
      description="Cadastre um resultado padronizado de atendimento humano ou automação."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              if (!code.trim() || !name.trim()) return setErr('Código e Nome são obrigatórios');
              m.mutate();
            }}
          >
            Cadastrar tabulação
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">{err}</div>}
        <Field label="Código identificador (SNAKE_CASE)" required tooltip="Identificador único utilizado nas integrações e logs (ex: ACORDO_PROMETIDO).">
          {(p) => (
            <Input
              id={p.id}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ex: ACORDO_PROMETIDO"
            />
          )}
        </Field>
        <Field label="Nome de exibição" required>
          {(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Acordo prometido para amanhã" />}
        </Field>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2 text-xs">
          <div className="font-semibold text-slate-800 mb-1">Classificação do Indicador:</div>
          <Checkbox label="Conta como Contato Efetivo / Pessoa Certa (CPC)" checked={isCpc} onChange={(e) => setIsCpc(e.target.checked)} />
          <Checkbox label="Conta como Conversão / Sucesso da Operação" checked={isConversion} onChange={(e) => setIsConversion(e.target.checked)} />
          <Checkbox label="Gera Opt-out permanente (Lista Não Perturbe / DNC)" checked={isOptOut} onChange={(e) => setIsOptOut(e.target.checked)} />
          <Checkbox label="Invalida o telefone / e-mail de destino (número inexistente)" checked={invalidatesDestination} onChange={(e) => setInvalidatesDestination(e.target.checked)} />
        </div>
      </div>
    </Modal>
  );
}

export function TabulationsPage() {
  const { can } = useAuth();
  const [openNew, setOpenNew] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Dicionário de Tabulações"
        tooltip="Resultados normalizados de máquina ou humano e parametrização de CPC, conversão e DNC."
        actions={
          can('strategies.write') && (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpenNew(true)}>
              Nova tabulação
            </Button>
          )
        }
      />
      <TabulationsSection />
      <NewTabulationDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  );
}

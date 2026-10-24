import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FlaskConical, Play, Sparkles } from 'lucide-react';
import { get, post } from '../lib/api';
import type { Journey, ListSummary, Strategy } from '../lib/types';
import { fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  useToast,
} from '../components/ui';

export type ExperimentItem = {
  id: string;
  name: string;
  status: 'RUNNING' | 'PAUSED' | 'CONCLUDED';
  list: { id: string; name: string };
  groupA: {
    name: string;
    strategyName: string;
    journeyName: string;
    evaluated: number;
    conversions: number;
    rate: number;
    wilsonInterval: [number, number];
    costPerConversion: number | null;
  };
  groupB: {
    name: string;
    strategyName: string;
    journeyName: string;
    evaluated: number;
    conversions: number;
    rate: number;
    wilsonInterval: [number, number];
    costPerConversion: number | null;
  };
  winner: 'A' | 'B' | null;
  conclusionNote: string;
  createdAt: string;
};

export function ExperimentsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['experiments'], queryFn: () => get<{ items: ExperimentItem[] }>('/experiments') });
  const [createOpen, setCreateOpen] = useState(false);

  const simulateBatch = useMutation({
    mutationFn: (id: string) => post(`/experiments/${id}/simulate-batch`),
    onSuccess: () => {
      toast('info', 'Lote de 20 clientes simulado determinísticamente para este experimento.');
      qc.invalidateQueries({ queryKey: ['experiments'] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Central de Decisão · Experimentos A/B"
        subtitle="Divisão estrita e determinística por cliente (50/50). Registros isolados sem contaminar indicadores da produção."
        actions={
          can('campaigns.create') && (
            <Button variant="primary" icon={<FlaskConical className="size-4" aria-hidden />} onClick={() => setCreateOpen(true)}>
              Novo experimento
            </Button>
          )
        }
      />

      <Alert tone="info" className="mb-4">
        <strong>Conforme §21 do Plano Funcional:</strong> A unidade de atribuição é o cliente (incluindo todos os seus destinos). Amostras pequenas ou intervalos de Wilson sobrepostos exibem resultado <em>inconclusivo</em>.
      </Alert>

      {q.isLoading ? (
        <Loading rows={4} />
      ) : (
        <div className="space-y-6">
          {q.data?.items.map((exp) => (
            <Card key={exp.id} title={exp.name} padded={false}>
              <div className="border-b border-slate-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={exp.status === 'RUNNING' ? 'green' : 'gray'}>
                      {exp.status === 'RUNNING' ? 'Em andamento' : 'Pausado'}
                    </Badge>
                    <span className="text-xs text-slate-500">Lista base: <strong>{exp.list.name}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Play className="size-3.5" aria-hidden />}
                      loading={simulateBatch.isPending && simulateBatch.variables === exp.id}
                      onClick={() => simulateBatch.mutate(exp.id)}
                    >
                      Simular lote (+20)
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
                {/* Grupo A */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-900">Grupo A: {exp.groupA.name}</span>
                    <span className="text-xs text-slate-500">{exp.groupA.journeyName} · {exp.groupA.strategyName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Avaliados" value={fmtNumber(exp.groupA.evaluated)} />
                    <Stat label="Conversões" value={fmtNumber(exp.groupA.conversions)} tone="good" />
                    <Stat label="Taxa de Conversão" value={fmtPercent(exp.groupA.rate)} />
                    <Stat
                      label="Custo por Conversão"
                      value={exp.groupA.costPerConversion !== null ? fmtMoney(exp.groupA.costPerConversion) : '—'}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Intervalo de Wilson 95%: [{fmtPercent(exp.groupA.wilsonInterval[0])} – {fmtPercent(exp.groupA.wilsonInterval[1])}]
                  </p>
                </div>

                {/* Grupo B */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-900">Grupo B: {exp.groupB.name}</span>
                    <span className="text-xs text-slate-500">{exp.groupB.journeyName} · {exp.groupB.strategyName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Avaliados" value={fmtNumber(exp.groupB.evaluated)} />
                    <Stat label="Conversões" value={fmtNumber(exp.groupB.conversions)} tone="good" />
                    <Stat label="Taxa de Conversão" value={fmtPercent(exp.groupB.rate)} />
                    <Stat
                      label="Custo por Conversão"
                      value={exp.groupB.costPerConversion !== null ? fmtMoney(exp.groupB.costPerConversion) : '—'}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Intervalo de Wilson 95%: [{fmtPercent(exp.groupB.wilsonInterval[0])} – {fmtPercent(exp.groupB.wilsonInterval[1])}]
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-600">
                  <strong>Conclusão estatística:</strong> {exp.conclusionNote}
                </span>
                {exp.winner && (
                  <Badge tone="brand" icon={<Sparkles className="size-3.5" aria-hidden />}>
                    Vencedor sugerido: Grupo {exp.winner}
                  </Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewExperimentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function NewExperimentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lists = useQuery({ queryKey: ['lists'], queryFn: () => get<{ items: ListSummary[] }>('/lists') });
  const journeys = useQuery({ queryKey: ['journeys'], queryFn: () => get<{ items: Journey[] }>('/journeys') });
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: () => get<{ items: Strategy[] }>('/strategies') });

  const [name, setName] = useState('');
  const [listId, setListId] = useState('');
  const [jA, setJA] = useState('');
  const [sA, setSA] = useState('');
  const [jB, setJB] = useState('');
  const [sB, setSB] = useState('');
  const [err, setErr] = useState('');

  const m = useMutation({
    mutationFn: (body: any) => post('/experiments', body),
    onSuccess: () => {
      toast('success', 'Experimento A/B criado e atribuído.');
      qc.invalidateQueries({ queryKey: ['experiments'] });
      onClose();
    },
    onError: (e: any) => setErr(e.message || 'Erro ao criar experimento'),
  });

  function submit() {
    if (!name.trim()) return setErr('Informe o nome do experimento');
    if (!listId) return setErr('Selecione a lista base');
    if (!jA || !sA || !jB || !sB) return setErr('Selecione jornada e estratégia para ambos os grupos');
    if (jA === jB && sA === sB) return setErr('Os grupos A e B devem diferir em pelo menos uma estratégia ou jornada');
    setErr('');
    m.mutate({ name, listId, journeyA: jA, strategyA: sA, journeyB: jB, strategyB: sB });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      wide
      title="Novo Experimento A/B"
      description="Atribuição 50/50 determinística por cliente. Grupos mutuamente exclusivos (§21)."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Criar experimento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Nome do experimento" required>
          {(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Lista base publicada" required>
          {(p) => (
            <Select id={p.id} value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">Selecione…</option>
              {lists.data?.items.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="rounded border border-slate-200 p-3 space-y-2">
            <legend className="text-xs font-semibold px-1">Grupo A (Controle)</legend>
            <Field label="Jornada A" required>
              {(p) => (
                <Select id={p.id} value={jA} onChange={(e) => setJA(e.target.value)}>
                  <option value="">Selecione…</option>
                  {journeys.data?.items.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Estratégia A" required>
              {(p) => (
                <Select id={p.id} value={sA} onChange={(e) => setSA(e.target.value)}>
                  <option value="">Selecione…</option>
                  {strategies.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          </fieldset>

          <fieldset className="rounded border border-slate-200 p-3 space-y-2">
            <legend className="text-xs font-semibold px-1">Grupo B (Desafiante)</legend>
            <Field label="Jornada B" required>
              {(p) => (
                <Select id={p.id} value={jB} onChange={(e) => setJB(e.target.value)}>
                  <option value="">Selecione…</option>
                  {journeys.data?.items.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Estratégia B" required>
              {(p) => (
                <Select id={p.id} value={sB} onChange={(e) => setSB(e.target.value)}>
                  <option value="">Selecione…</option>
                  {strategies.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          </fieldset>
        </div>
      </div>
    </Modal>
  );
}

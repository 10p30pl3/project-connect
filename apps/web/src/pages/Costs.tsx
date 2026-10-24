import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DollarSign, UploadCloud, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { get, post } from '../lib/api';
import { fmtMoney, fmtNumber } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Loading,
  Modal,
  PageHeader,
  Stat,
  TableWrap,
  useToast,
} from '../components/ui';

export type CostItem = {
  attemptId: string;
  campaignName: string;
  contactName: string;
  channel: string;
  connectionName: string;
  tariffPreserved: number | null;
  estimatedCost: number | null;
  confirmedCost: number | null;
  status: 'ESTIMATED' | 'CONFIRMED';
  invoiceRef: string | null;
  createdAt: string;
};

export function CostsPage() {
  const toast = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const q = useQuery({ queryKey: ['costs-summary'], queryFn: () => get<{ items: CostItem[]; summary: { totalEstimated: number; totalConfirmed: number; coverageCount: number; pendingCount: number } }>('/costs') });

  return (
    <div>
      <PageHeader
        title="Central de Decisão · Custos & Conciliação"
        subtitle="Tarifas preservadas por tentativa, conciliação de faturas de conectores e custo efetivo (§20)."
        actions={
          <Button variant="primary" icon={<UploadCloud className="size-4" aria-hidden />} onClick={() => setImportOpen(true)}>
            Importar extrato / fatura
          </Button>
        }
      />

      <Alert tone="info" className="mb-4">
        <strong>Conforme §20 do Plano Funcional:</strong> Cada tentativa enviada preserva a fotografia da tarifa vigente no momento da reserva. A importação de fatura líquida substitui a estimativa pelo valor confirmado, sem somar os dois.
      </Alert>

      {q.isLoading ? (
        <Loading rows={4} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total confirmado" value={fmtMoney(q.data?.summary.totalConfirmed ?? 0)} tone="good" />
            <Stat label="Total estimado (pendente)" value={fmtMoney(q.data?.summary.totalEstimated ?? 0)} />
            <Stat label="Tentativas conciliadas" value={fmtNumber(q.data?.summary.coverageCount ?? 0)} />
            <Stat label="Aguardando conciliação" value={fmtNumber(q.data?.summary.pendingCount ?? 0)} tone="warn" />
          </div>

          <Card padded={false} title="Tentativas e Status de Conciliação">
            <TableWrap label="Extrato de custos">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tentativa</th>
                    <th>Campanha</th>
                    <th>Cliente</th>
                    <th>Canal / Conexão</th>
                    <th>Tarifa Preservada</th>
                    <th>Custo Confirmado</th>
                    <th>Situação</th>
                    <th>Referência de Fatura</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((c) => (
                    <tr key={c.attemptId}>
                      <td className="font-mono text-xs">{c.attemptId.slice(0, 8)}</td>
                      <td className="text-sm font-medium">{c.campaignName}</td>
                      <td>{c.contactName}</td>
                      <td className="text-xs">
                        {c.channel} · <span className="text-slate-500">{c.connectionName}</span>
                      </td>
                      <td className="tabular text-xs">
                        {c.tariffPreserved !== null ? fmtMoney(c.tariffPreserved, 4) : 'não informada'}
                      </td>
                      <td className="tabular font-medium text-xs">
                        {c.confirmedCost !== null ? fmtMoney(c.confirmedCost, 4) : fmtMoney(c.estimatedCost ?? 0, 4)}
                      </td>
                      <td>
                        {c.status === 'CONFIRMED' ? (
                          <Badge tone="green" icon={<CheckCircle2 className="size-3" />}>Conciliado</Badge>
                        ) : (
                          <Badge tone="amber" icon={<AlertTriangle className="size-3" />}>Estimado</Badge>
                        )}
                      </td>
                      <td className="text-xs font-mono text-slate-500">{c.invoiceRef ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      )}

      <ImportInvoiceModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function ImportInvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [content, setContent] = useState('');
  const [refName, setRefName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    if (!refName.trim()) {
      toast('error', 'Informe o identificador da fatura/lote.');
      return;
    }
    setLoading(true);
    await post('/costs/reconcile-batch', { invoiceRef: refName, content });
    setLoading(false);
    toast('success', `Fatura "${refName}" processada e tentativas conciliadas com sucesso.`);
    onClose();
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      wide
      title="Importar extrato / fatura de conector"
      description="Faça a conciliação em lote para substituir custos estimados por valores liquidados pelo provedor."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={loading} onClick={handleImport}>
            Processar conciliação
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Referência da Fatura / Lote (ex.: FAT-2026-10-VOICE)" required>
          {(p) => <input id={p.id} className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" value={refName} onChange={(e) => setRefName(e.target.value)} />}
        </Field>
        <Field label="Arquivo ou linhas de faturamento (attempt_id;custo_real)">
          {(p) => (
            <textarea
              id={p.id}
              rows={6}
              className="w-full rounded border border-slate-300 p-2 font-mono text-xs"
              placeholder={'00000000-0000-4000-8000-000000000401;0.0480\n00000000-0000-4000-8000-000000000402;0.1150'}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

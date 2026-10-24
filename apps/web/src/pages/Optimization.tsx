import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Compass, Lightbulb, Clock, Phone, AlertCircle } from 'lucide-react';
import { get } from '../lib/api';
import type { CampaignSummary } from '../lib/types';
import { fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import {
  Alert,
  Badge,
  Card,
  Field,
  Loading,
  PageHeader,
  Select,
  Stat,
  TableWrap,
} from '../components/ui';

export type RecommendationRow = {
  contactId: string;
  externalId: string;
  name: string;
  channel: string;
  destinationMasked: string;
  bestTimeWindow: string;
  evidencesCount: number;
  historicRate: number;
  estimatedCostPerSuccess: number | null;
  policyUsed: string;
};

export function OptimizationPage() {
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => get<{ items: CampaignSummary[] }>('/campaigns') });
  const [selectedCampaignId, setSelectedCampaignId] = useState('');

  const q = useQuery({
    queryKey: ['optimization-recommendations', selectedCampaignId],
    queryFn: () => get<{ items: RecommendationRow[]; policy: string; notes: string[] }>(`/optimization?campaignId=${selectedCampaignId}`),
    enabled: !!selectedCampaignId,
  });

  return (
    <div>
      <PageHeader
        title="Central de Decisão · Otimização & Recomendações"
        subtitle="Painel consultivo de propensão de contato, evidências históricas e melhor janela horária (§22)."
      />

      <Alert tone="info" className="mb-4">
        <strong>Modo Consultivo:</strong> As recomendações abaixo apoiam a tomada de decisão do gestor. Elas não alteram a execução da campanha sem ação humana explícita. Bloqueios de DNC e calendários sempre prevalecem.
      </Alert>

      <Card className="mb-6">
        <Field label="Selecione a campanha para avaliar" className="max-w-md">
          {(p) => (
            <Select
              id={p.id}
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
            >
              <option value="">Selecione uma campanha…</option>
              {campaigns.data?.items.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.statusLabel})</option>
              ))}
            </Select>
          )}
        </Field>
      </Card>

      {!selectedCampaignId ? (
        <Card>
          <div className="py-8 text-center text-slate-500 text-sm">
            <Compass className="size-8 mx-auto mb-2 text-slate-400" />
            Selecione uma campanha acima para visualizar as recomendações consultivas e o ranking de propensão.
          </div>
        </Card>
      ) : q.isLoading ? (
        <Loading rows={5} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Política vigente no template" value={q.data?.policy ?? 'Menor custo por CPC'} />
            <Stat label="Mínimo de evidências exigidas" value="3 tentativas" hint="Abaixo disso, aplica a ordem do template" />
            <Stat label="Candidatos com recomendação" value={fmtNumber(q.data?.items.length ?? 0)} tone="good" />
          </div>

          <Card padded={false} title="Candidatos Classificados para Acionamento">
            <TableWrap label="Recomendações">
              <table className="data">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Canal Recomendado</th>
                    <th>Melhor Destino</th>
                    <th>Janela Horária Sugerida</th>
                    <th>Evidências</th>
                    <th>Taxa Histórica</th>
                    <th>Custo Est. / Sucesso</th>
                    <th>Regra Aplicada</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((r) => (
                    <tr key={r.contactId}>
                      <td>
                        <span className="font-medium text-slate-900">{r.name}</span>
                        <div className="font-mono text-xs text-slate-500">{r.externalId}</div>
                      </td>
                      <td>
                        <Badge tone="blue">{r.channel}</Badge>
                      </td>
                      <td className="font-mono text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3 text-slate-400" />
                          {r.destinationMasked}
                        </span>
                      </td>
                      <td className="text-xs">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                          <Clock className="size-3 text-slate-400" />
                          {r.bestTimeWindow}
                        </span>
                      </td>
                      <td className="tabular text-xs">{r.evidencesCount} eventos</td>
                      <td className="tabular font-medium text-emerald-700">
                        {fmtPercent(r.historicRate)}
                      </td>
                      <td className="tabular text-xs">
                        {r.estimatedCostPerSuccess !== null ? fmtMoney(r.estimatedCostPerSuccess) : '—'}
                      </td>
                      <td className="text-xs text-slate-600">{r.policyUsed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <Card title="Observações da Central de Decisão">
            <ul className="list-disc pl-4 text-xs text-slate-600 space-y-1">
              <li>A estimativa de custo por sucesso divide a tarifa vigente pela taxa histórica quando houver ao menos 3 evidências e 1 sucesso.</li>
              <li>A faixa horária sugerida deriva da maior densidade de CPC/atendimento anterior, respeitando a janela permitida do calendário da estratégia.</li>
              <li>Nenhum cliente em DNC, bloqueado ou com reserva ativa em outra campanha é exibido como recomendação.</li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Compass, Phone, SlidersHorizontal, Sparkles } from 'lucide-react';
import { OPTIMIZATION_POLICIES, OPTIMIZATION_POLICY_LABEL, type OptimizationPolicy } from '@voll/shared';
import { get, post } from '../lib/api';
import type { CampaignSummary } from '../lib/types';
import { fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  useToast,
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

type OptimizationResponse = {
  enabled?: boolean;
  policyCode?: OptimizationPolicy;
  minEvidences?: number;
  strategyId?: string;
  strategyName?: string;
  strategyVersion?: number;
  items: RecommendationRow[];
  policy: string;
  notes: string[];
};

export function OptimizationPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => get<{ items: CampaignSummary[] }>('/campaigns') });
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [appliedContacts, setAppliedContacts] = useState<Record<string, boolean>>({});

  // Auto-seleciona a primeira campanha em execução (ou a primeira disponível) para que o painel já abra ativo
  useEffect(() => {
    if (!selectedCampaignId && campaigns.data?.items.length) {
      const running = campaigns.data.items.find((c) => c.status === 'RUNNING') ?? campaigns.data.items[0];
      setSelectedCampaignId(running.id);
    }
  }, [campaigns.data, selectedCampaignId]);

  const q = useQuery({
    queryKey: ['optimization-recommendations', selectedCampaignId],
    queryFn: () => get<OptimizationResponse>(`/optimization?campaignId=${selectedCampaignId}`),
    enabled: !!selectedCampaignId,
  });

  const [enabled, setEnabled] = useState(true);
  const [policy, setPolicy] = useState<OptimizationPolicy>('LOWEST_COST_PER_CPC');
  const [minEvidences, setMinEvidences] = useState(3);

  useEffect(() => {
    if (q.data) {
      setEnabled(q.data.enabled ?? true);
      setPolicy(q.data.policyCode ?? 'LOWEST_COST_PER_CPC');
      setMinEvidences(q.data.minEvidences ?? 3);
    }
  }, [q.data]);

  const configMutation = useMutation({
    mutationFn: () =>
      post<{ ok: boolean; version: number }>('/optimization/configure', {
        campaignId: selectedCampaignId,
        enabled,
        policy,
        minEvidences,
      }),
    onSuccess: (res) => {
      toast('success', `Otimização consultiva ${enabled ? 'ativada' : 'desativada'} (Estratégia publicada na v${res.version}).`);
      qc.invalidateQueries({ queryKey: ['optimization-recommendations', selectedCampaignId] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['strategies'] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: (payload: { contactId?: string; count?: number }) =>
      post('/optimization/apply', { campaignId: selectedCampaignId, ...payload }),
    onSuccess: (_res, vars) => {
      if (vars.contactId) {
        setAppliedContacts((s) => ({ ...s, [vars.contactId!]: true }));
        toast('success', 'Recomendação aplicada ao contato e registrada na trilha de auditoria.');
      } else {
        const next: Record<string, boolean> = {};
        for (const it of q.data?.items ?? []) next[it.contactId] = true;
        setAppliedContacts(next);
        toast('success', `Recomendações aplicadas para ${vars.count ?? 0} contatos na fila de acionamento.`);
      }
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Central de Decisão · Otimização Consultiva"
        subtitle="Painel de propensão de contato, evidências históricas, melhor janela horária e ativação por estratégia (§22)."
        actions={
          q.data?.strategyId && (
            <Link
              to={`/estrategias/${q.data.strategyId}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
            >
              <SlidersHorizontal className="size-3.5 text-brand-700" aria-hidden />
              Editar na Estratégia ({q.data.strategyName} v{q.data.strategyVersion})
            </Link>
          )
        }
      />

      <Alert tone="info">
        <strong>Como funciona o Modo Consultivo (§22):</strong> Você pode ativar a política de otimização na <strong>Estratégia</strong> ou diretamente no painel abaixo. As recomendações classificam melhor canal, destino e janela horária para cada contato, permitindo que o gestor aplique individualmente ou em lote sem jamais violar DNC, bloqueios ou limites institucionais.
      </Alert>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card title="1. Campanha em avaliação" className="lg:col-span-5">
          <div className="space-y-3">
            <Field label="Campanha" hint="A campanha vincula a lista de contatos ao template de estratégia">
              {(p) => (
                <Select
                  id={p.id}
                  value={selectedCampaignId}
                  onChange={(e) => {
                    setSelectedCampaignId(e.target.value);
                    setAppliedContacts({});
                  }}
                >
                  <option value="">Selecione uma campanha…</option>
                  {campaigns.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.statusLabel})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {q.data && (
              <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs">
                <span className="text-slate-600">
                  Template vinculado: <strong className="text-slate-900">{q.data.strategyName ?? 'Padrão'}</strong> (v{q.data.strategyVersion ?? 1})
                </span>
                {enabled ? <Badge tone="green">Otimização Ativa</Badge> : <Badge tone="gray">Desativada</Badge>}
              </div>
            )}
          </div>
        </Card>

        <Card title="2. Ativar e Configurar Política Consultiva" className="lg:col-span-7">
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200/80 bg-brand-50/30 px-3.5 py-2.5">
              <div>
                <div className="text-sm font-semibold text-slate-900">Motor de Recomendação Consultiva</div>
                <div className="text-xs text-slate-600">Ativa o cálculo de propensão, melhor horário (Best Time to Contact) e custo por CPC.</div>
              </div>
              <Checkbox label="Ativar otimização" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Política de priorização" className="sm:col-span-2">
                {(p) => (
                  <Select id={p.id} value={policy} disabled={!enabled} onChange={(e) => setPolicy(e.target.value as OptimizationPolicy)}>
                    {OPTIMIZATION_POLICIES.map((pol) => (
                      <option key={pol} value={pol}>
                        {OPTIMIZATION_POLICY_LABEL[pol]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Mín. de evidências">
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    min={1}
                    max={50}
                    disabled={!enabled}
                    value={minEvidences}
                    onChange={(e) => setMinEvidences(Math.max(1, Number(e.target.value)))}
                  />
                )}
              </Field>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-slate-500">Salvar publica uma nova versão imutável da estratégia e atualiza a campanha.</span>
              <Button
                variant="primary"
                size="sm"
                loading={configMutation.isPending}
                disabled={!selectedCampaignId}
                onClick={() => configMutation.mutate()}
              >
                Salvar e atualizar política
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {!selectedCampaignId ? (
        <Card>
          <div className="py-8 text-center text-sm text-slate-500">
            <Compass className="mx-auto mb-2 size-8 text-slate-400" />
            Selecione uma campanha acima para visualizar as recomendações consultivas e o ranking de propensão.
          </div>
        </Card>
      ) : q.isLoading ? (
        <Loading rows={5} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Status e Política vigente"
              value={enabled ? q.data?.policy ?? 'Menor custo por CPC' : 'Desativada (Ordem fixa)'}
              tone={enabled ? 'good' : undefined}
            />
            <Stat
              label="Mínimo de evidências exigidas"
              value={`${minEvidences} tentativas`}
              hint="Abaixo disso, mantém a ordem padrão do template"
            />
            <Stat
              label="Candidatos com recomendação"
              value={fmtNumber(enabled ? (q.data?.items.length ?? 0) : 0)}
              tone={enabled ? 'good' : undefined}
              hint={enabled ? 'Prontos para aplicação consultiva' : 'Ative o motor acima para gerar'}
            />
          </div>

          <Card
            padded={false}
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="size-4 text-brand-700" aria-hidden />
                <span>Candidatos Classificados para Acionamento</span>
              </span>
            }
            actions={
              enabled &&
              (q.data?.items.length ?? 0) > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  loading={applyMutation.isPending}
                  onClick={() => applyMutation.mutate({ count: q.data?.items.length ?? 0 })}
                >
                  Aplicar recomendações na fila ({q.data?.items.length})
                </Button>
              )
            }
          >
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
                    <th className="text-right">Ação Consultiva</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((r) => {
                    const isApplied = !!appliedContacts[r.contactId];
                    return (
                      <tr key={r.contactId}>
                        <td>
                          <Link to={`/contatos/${r.contactId}`} className="font-medium text-slate-900 hover:underline">
                            {r.name}
                          </Link>
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
                        <td className="tabular font-medium text-emerald-700">{fmtPercent(r.historicRate)}</td>
                        <td className="tabular text-xs">{r.estimatedCostPerSuccess !== null ? fmtMoney(r.estimatedCostPerSuccess) : '—'}</td>
                        <td className="text-xs text-slate-600">{r.policyUsed}</td>
                        <td className="text-right">
                          {isApplied ? (
                            <Badge tone="green" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
                              Aplicada
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              disabled={!enabled}
                              onClick={() => applyMutation.mutate({ contactId: r.contactId })}
                            >
                              Aplicar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <Card title="Observações da Central de Decisão">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              <li>A estimativa de custo por sucesso divide a tarifa vigente pela taxa histórica quando houver ao menos {minEvidences} evidências e 1 sucesso.</li>
              <li>A faixa horária sugerida deriva da maior densidade de CPC/atendimento anterior, respeitando a janela permitida do calendário da estratégia.</li>
              <li>Nenhum cliente em DNC, bloqueado ou com reserva ativa em outra campanha é exibido como recomendação.</li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

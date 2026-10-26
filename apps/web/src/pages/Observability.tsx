import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  ShieldCheck,
  User,
} from 'lucide-react';
import { get, qs } from '../lib/api';
import type { AuditRow, Paginated } from '../lib/types';
import { fmtDateTimeSec } from '../lib/format';
import { useCursorPager } from '../lib/hooks';
import {
  Alert,
  Badge,
  Card,
  ErrorState,
  Loading,
  PageHeader,
  Pager,
  Stat,
  TableWrap,
} from '../components/ui';

export function ObservabilityPage() {
  const pager = useCursorPager();
  const [selectedEntityFilter, setSelectedEntityFilter] = useState<string>('ALL');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['audit', pager.cursor],
    queryFn: () => get<Paginated<AuditRow>>(`/audit${qs({ cursor: pager.cursor })}`),
    placeholderData: keepPreviousData,
  });

  const items = q.data?.items ?? [];
  const filteredItems =
    selectedEntityFilter === 'ALL'
      ? items
      : items.filter((it) => it.entity.toLowerCase().includes(selectedEntityFilter.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Observabilidade & Auditoria"
        tooltip="Trilha completa de auditoria operacional, telemetria de governança e rastreabilidade LGPD (Art. 20)."
        actions={
          <Link
            to="/limites"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
          >
            <ShieldCheck className="size-3.5 text-brand-700" aria-hidden />
            Configurar Limites Institucionais →
          </Link>
        }
      />

      {/* Indicadores de Conformidade */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Status da Trilha"
          value="Ativa · Imutável"
          tone="good"
          tooltip="Gravação atômica em log imutável de todas as mutações e ações de campanha."
        />
        <Stat
          label="Conformidade LGPD"
          value="Art. 20 Pleno"
          tone="good"
          tooltip="Garantia legal de auditabilidade sobre todas as decisões automatizadas e critérios de inteligência artificial."
        />
        <Stat
          label="Registros nesta página"
          value={String(filteredItems.length)}
          tooltip="Total de eventos na página atual do log de auditoria operacional."
        />
        <Stat
          label="Revisão Humana"
          value="Disponível"
          tone="good"
          tooltip="Possibilidade de auditoria e intervenção manual com justificativa formal registrada."
        />
      </div>

      <Card title="Trilha de Eventos e Auditoria Governamental" padded={false}>
        <div className="p-4 border-b border-slate-200/80 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Filter className="size-3.5 text-slate-500" />
            <span className="font-medium">Filtrar por entidade:</span>
            <div className="flex flex-wrap gap-1">
              {[
                { key: 'ALL', label: 'Todas' },
                { key: 'campaign', label: 'Campanhas' },
                { key: 'contact', label: 'Contatos & Bloqueios' },
                { key: 'mailing', label: 'Mailings' },
                { key: 'workspace', label: 'Controle Institucional' },
                { key: 'cpc_hypothesis', label: 'Hipóteses CPC' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setSelectedEntityFilter(f.key)}
                  className={`px-2 py-0.5 rounded-full text-xs transition font-medium ${
                    selectedEntityFilter === f.key
                      ? 'bg-brand-700 text-white font-semibold'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {q.isLoading ? (
          <div className="p-8">
            <Loading />
          </div>
        ) : q.error ? (
          <div className="p-4">
            <ErrorState error={q.error} />
          </div>
        ) : (
          <>
            <TableWrap label="Tabela de Auditoria">
              <table className="data">
                <thead>
                  <tr>
                    <th>Data & Hora</th>
                    <th>Responsável</th>
                    <th>Ação Operacional</th>
                    <th>Entidade Afetada</th>
                    <th>Motivo Registrado</th>
                    <th>Alterações (Antes → Depois)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                        Nenhum registro de auditoria encontrado para o filtro selecionado.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((a) => {
                      const isExpanded = expandedRowId === a.id;
                      return (
                        <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="whitespace-nowrap text-xs text-slate-600 font-mono">
                            {fmtDateTimeSec(a.at)}
                          </td>
                          <td>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-900">
                              <User className="size-3 text-slate-400" />
                              <span>{a.user?.name ?? 'Sistema Automático'}</span>
                            </div>
                          </td>
                          <td>
                            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-800">
                              {a.action}
                            </span>
                          </td>
                          <td className="text-xs">
                            <span className="font-medium text-slate-900">{a.entity}</span>
                            {a.entityId && (
                              <div className="font-mono text-[11px] text-slate-400">
                                {a.entityId.slice(0, 8)}...
                              </div>
                            )}
                          </td>
                          <td className="text-xs text-slate-700 max-w-xs">
                            {a.reason ? (
                              <span className="italic">"{a.reason}"</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="text-xs">
                            <button
                              type="button"
                              onClick={() => setExpandedRowId(isExpanded ? null : String(a.id))}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900 hover:underline"
                            >
                              {isExpanded ? 'Ocultar JSON' : 'Inspecionar diff'}
                              {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                            </button>

                            {isExpanded && (
                              <div className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-w-md shadow-inner">
                                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 border-b border-slate-700 pb-0.5">
                                  Antes → Depois
                                </div>
                                <pre className="whitespace-pre-wrap break-all leading-tight">
                                  {JSON.stringify({ antes: a.before, depois: a.after }, null, 2)}
                                </pre>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </TableWrap>

            <Pager
              page={pager.page}
              hasNext={!!q.data!.nextCursor}
              onPrev={pager.prev}
              onNext={() => pager.next(q.data!.nextCursor)}
            />
          </>
        )}
      </Card>
    </div>
  );
}

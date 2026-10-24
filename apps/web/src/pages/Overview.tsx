import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Database, ListFilter, Megaphone } from 'lucide-react';
import { get } from '../lib/api';
import type { Overview } from '../lib/types';
import { fmtNumber } from '../lib/format';
import { Alert, Card, ErrorState, Loading, PageHeader, Stat } from '../components/ui';
import { useAuth } from '../lib/auth';

export function OverviewPage() {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview>('/overview'), refetchInterval: 5000 });
  const shortcuts = [
    { to: '/campanhas/nova', label: 'Nova campanha', desc: 'Mailing, público, acionamento e revisão em 4 etapas.', icon: Megaphone, perm: 'campaigns.create' as const },
    { to: '/mailings/importar', label: 'Importar mailing', desc: 'CSV ou conteúdo colado, com conferência por linha.', icon: Database, perm: 'mailings.write' as const },
    { to: '/listas/nova', label: 'Preparar lista', desc: 'Filtros, ordenação e modalidade sobre um mailing.', icon: ListFilter, perm: 'lists.write' as const },
  ];
  return (
    <div>
      <PageHeader title={`Olá, ${me?.name.split(' ')[0] ?? ''}`} subtitle="Resumo da operação do workspace" />
      {q.data?.globalSuspension && (
        <Alert tone="warn" title="Suspensão global ativa" className="mb-4">
          Nenhuma nova reserva ou envio acontece até a liberação no Controle central. Retornos em andamento continuam sendo processados.
        </Alert>
      )}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {shortcuts.map((s) =>
          can(s.perm) ? (
            <Link
              key={s.to}
              to={s.to}
              className="group flex gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50/40"
            >
              <s.icon className="size-5 shrink-0 text-brand-700" aria-hidden />
              <span>
                <span className="block font-medium text-slate-900 group-hover:text-brand-800">{s.label}</span>
                <span className="block text-xs text-slate-600">{s.desc}</span>
              </span>
            </Link>
          ) : null,
        )}
      </div>
      {q.isLoading ? (
        <Loading rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-4">
          <Card title="Campanhas">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Em execução" value={fmtNumber(q.data!.campaigns.running)} tone="good" />
              <Stat label="Pausadas" value={fmtNumber(q.data!.campaigns.paused)} />
              <Stat label="Prontas" value={fmtNumber(q.data!.campaigns.ready)} />
              <Stat label="Agendadas" value={fmtNumber(q.data!.campaigns.scheduled)} />
              <Stat label="Concluídas" value={fmtNumber(q.data!.campaigns.completed)} />
            </div>
          </Card>
          <Card title="Tentativas e dados">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Tentativas ativas" value={fmtNumber(q.data!.attempts.active)} />
              <Stat
                label="Em reconciliação"
                value={fmtNumber(q.data!.attempts.reconciliation)}
                tone={q.data!.attempts.reconciliation > 0 ? 'warn' : undefined}
              />
              <Stat label="Enviadas hoje" value={fmtNumber(q.data!.attempts.sentToday)} />
              <Stat label="Contatos" value={fmtNumber(q.data!.contacts)} />
              <Stat label="Mailings" value={fmtNumber(q.data!.mailings)} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

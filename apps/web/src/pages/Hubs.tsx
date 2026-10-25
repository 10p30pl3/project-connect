import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrainCircuit, Compass, Database, DollarSign, FlaskConical, ListFilter, Route, SlidersHorizontal, Tags, Users } from 'lucide-react';
import { btnClass, PageHeader, Tabs } from '../components/ui';
import { MailingsSection } from './Mailings';
import { ListsSection } from './Lists';
import { ContactsSection } from './Contacts';
import { OptimizationPage } from './Optimization';
import { ExperimentsPage } from './Experiments';
import { CostsPage } from './Costs';
import { StrategiesSection } from './Strategies';
import { JourneysSection } from './Journeys';
import { TabulationsSection } from './Tabulations';

/**
 * Hub 1: Carteiras & Público
 * Consolida Mailings (Cargas), Listas de Segmentação e Contatos/DNC em uma única experiência integrada.
 */
export function PortfolioHubPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const activeTab = loc.pathname.startsWith('/listas')
    ? 'listas'
    : loc.pathname.startsWith('/contatos')
      ? 'contatos'
      : 'mailings';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Carteiras & Público"
        subtitle="Gestão consolidada da base de clientes: importação de mailings, listas de segmentação e cadastro de contatos / DNC"
      />
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          if (v === 'mailings') nav('/mailings');
          else if (v === 'listas') nav('/listas');
          else if (v === 'contatos') nav('/contatos');
        }}
        tabs={[
          {
            value: 'mailings',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Database className="size-4 text-brand-700" aria-hidden />
                <span>Mailings (Cargas)</span>
              </span>
            ),
            content: <MailingsSection />,
          },
          {
            value: 'listas',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <ListFilter className="size-4 text-brand-700" aria-hidden />
                <span>Listas de Segmentação</span>
              </span>
            ),
            content: <ListsSection />,
          },
          {
            value: 'contatos',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4 text-brand-700" aria-hidden />
                <span>Contatos & DNC</span>
              </span>
            ),
            content: <ContactsSection />,
          },
        ]}
      />
    </div>
  );
}

/**
 * Hub 2: Central de Decisão
 * Consolida Otimização Consultiva, Experimentos A/B (Campeão/Desafiante) e Custos & Conciliação.
 */
export function DecisionHubPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const activeTab = loc.pathname.startsWith('/experimentos')
    ? 'experimentos'
    : loc.pathname.startsWith('/custos')
      ? 'custos'
      : 'otimizacao';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50/90 to-white px-4 py-3">
        <div className="flex items-center gap-3">
          <BrainCircuit className="size-5 text-brand-700" aria-hidden />
          <div>
            <div className="text-sm font-semibold text-slate-900">Motor de Inteligência de Contato & Otimização de CPC</div>
            <div className="text-xs text-slate-600">
              Execute a Esteira Autônoma em Modo Produção + Modo Laboratório (TIC Domicílios 2025, 29 Hipóteses H-A..H-L e Plano em 8 Blocos).
            </div>
          </div>
        </div>
        <Link to="/inteligencia" className={btnClass('primary', 'sm')}>
          Abrir Esteira de CPC & Lab →
        </Link>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          if (v === 'otimizacao') nav('/otimizacao');
          else if (v === 'experimentos') nav('/experimentos');
          else if (v === 'custos') nav('/custos');
        }}
        tabs={[
          {
            value: 'otimizacao',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Compass className="size-4 text-brand-700" aria-hidden />
                <span>Otimização Consultiva</span>
              </span>
            ),
            content: <OptimizationPage />,
          },
          {
            value: 'experimentos',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <FlaskConical className="size-4 text-brand-700" aria-hidden />
                <span>Experimentos A/B</span>
              </span>
            ),
            content: <ExperimentsPage />,
          },
          {
            value: 'custos',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <DollarSign className="size-4 text-brand-700" aria-hidden />
                <span>Custos & Conciliação</span>
              </span>
            ),
            content: <CostsPage />,
          },
        ]}
      />
    </div>
  );
}

/**
 * Hub 3: Réguas & Estratégias
 * Consolida Estratégias de Cobrança, Jornadas de Canal e Catálogo de Tabulações em uma única bancada de planejamento.
 */
export function PlaybookHubPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const activeTab = loc.pathname.startsWith('/jornadas')
    ? 'jornadas'
    : loc.pathname.startsWith('/tabulacoes')
      ? 'tabulacoes'
      : 'estrategias';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Réguas & Estratégias"
        subtitle="Bancada de planejamento de cobrança: templates de estratégia, jornadas multicanal e dicionário de tabulações"
      />
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          if (v === 'estrategias') nav('/estrategias');
          else if (v === 'jornadas') nav('/jornadas');
          else if (v === 'tabulacoes') nav('/tabulacoes');
        }}
        tabs={[
          {
            value: 'estrategias',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <SlidersHorizontal className="size-4 text-brand-700" aria-hidden />
                <span>Estratégias</span>
              </span>
            ),
            content: <StrategiesSection />,
          },
          {
            value: 'jornadas',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Route className="size-4 text-brand-700" aria-hidden />
                <span>Jornadas de Canal</span>
              </span>
            ),
            content: <JourneysSection />,
          },
          {
            value: 'tabulacoes',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Tags className="size-4 text-brand-700" aria-hidden />
                <span>Tabulações</span>
              </span>
            ),
            content: <TabulationsSection />,
          },
        ]}
      />
    </div>
  );
}

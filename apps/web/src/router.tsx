import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { CampaignsPage } from './pages/Campaigns';
import { CampaignDetailPage } from './pages/CampaignDetail';
import { NewCampaignPage } from './pages/NewCampaign';
import { AttemptsPage } from './pages/Attempts';
import { ContactsPage } from './pages/Contacts';
import { ContactDetailPage } from './pages/ContactDetail';
import { MailingsPage, MailingDetailPage, MailingImportPage } from './pages/Mailings';
import { ListsPage, ListDetailPage, NewListPage } from './pages/Lists';
import { JourneysPage } from './pages/Journeys';
import { StrategiesPage, StrategyDetailPage } from './pages/Strategies';
import { TabulationsPage } from './pages/Tabulations';
import { ChannelsPage } from './pages/Channels';
import { ControlPage } from './pages/Control';
import { ExperimentsPage } from './pages/Experiments';
import { OptimizationPage } from './pages/Optimization';
import { CostsPage } from './pages/Costs';
import { MorePage } from './pages/More';
import { NotFoundPage } from './pages/NotFound';
import { DecisionHubPage, PlaybookHubPage, PortfolioHubPage } from './pages/Hubs';
import { IntelligencePage } from './pages/Intelligence';

function RequireAuth() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="p-8">
        <Loading />
      </div>
    );
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

function RouteError() {
  const err = useRouteError() as Error | undefined;
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-lg font-semibold">Algo deu errado nesta tela</h1>
      <p className="mt-2 text-sm text-slate-600">Recarregue a página. Se o problema persistir, informe o suporte com a mensagem abaixo.</p>
      <pre className="mt-3 overflow-auto rounded bg-slate-100 p-3 text-xs">{err?.message ?? String(err)}</pre>
      <a href="/" className="mt-4 inline-block text-sm font-medium text-brand-700 underline">
        Voltar para a visão geral
      </a>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <OverviewPage /> },
          { path: '/campanhas', element: <CampaignsPage /> },
          { path: '/campanhas/nova', element: <NewCampaignPage /> },
          { path: '/campanhas/:id', element: <CampaignDetailPage /> },
          { path: '/tentativas', element: <AttemptsPage /> },
          { path: '/contatos', element: <PortfolioHubPage /> },
          { path: '/contatos/:id', element: <ContactDetailPage /> },
          { path: '/mailings', element: <PortfolioHubPage /> },
          { path: '/mailings/importar', element: <MailingImportPage /> },
          { path: '/mailings/:id', element: <MailingDetailPage /> },
          { path: '/listas', element: <PortfolioHubPage /> },
          { path: '/listas/nova', element: <NewListPage /> },
          { path: '/listas/:id', element: <ListDetailPage /> },
          { path: '/jornadas', element: <PlaybookHubPage /> },
          { path: '/estrategias', element: <PlaybookHubPage /> },
          { path: '/estrategias/:id', element: <StrategyDetailPage /> },
          { path: '/tabulacoes', element: <PlaybookHubPage /> },
          { path: '/canais', element: <ChannelsPage /> },
          { path: '/controle', element: <ControlPage /> },
          { path: '/inteligencia', element: <IntelligencePage /> },
          { path: '/experimentos', element: <DecisionHubPage /> },
          { path: '/otimizacao', element: <DecisionHubPage /> },
          { path: '/custos', element: <DecisionHubPage /> },
          { path: '/mais', element: <MorePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

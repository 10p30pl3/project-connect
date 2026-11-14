import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';

function lazyNamed<K extends string, T extends Record<K, ComponentType<any>> & Record<string, any>>(
  loader: () => Promise<T>,
  key: K,
) {
  return lazy(async () => {
    const flag = `vc_lazy_reload:${String(key)}`;
    try {
      const mod = await loader();
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(flag);
      return { default: mod[key] };
    } catch (err) {
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, '1');
        window.location.reload();
      }
      throw err;
    }
  });
}

const LoginPage = lazyNamed(() => import('./pages/Login'), 'LoginPage');
const OverviewPage = lazyNamed(() => import('./pages/Overview'), 'OverviewPage');
const CampaignsPage = lazyNamed(() => import('./pages/Campaigns'), 'CampaignsPage');
const CampaignDetailPage = lazyNamed(() => import('./pages/CampaignDetail'), 'CampaignDetailPage');
const NewCampaignPage = lazyNamed(() => import('./pages/NewCampaign'), 'NewCampaignPage');
const CampaignTemplatesPage = lazyNamed(() => import('./pages/CampaignTemplates'), 'CampaignTemplatesPage');
const AttemptsPage = lazyNamed(() => import('./pages/Attempts'), 'AttemptsPage');
const ContactsPage = lazyNamed(() => import('./pages/Contacts'), 'ContactsPage');
const ContactDetailPage = lazyNamed(() => import('./pages/ContactDetail'), 'ContactDetailPage');
const MailingsPage = lazyNamed(() => import('./pages/Mailings'), 'MailingsPage');
const MailingDetailPage = lazyNamed(() => import('./pages/Mailings'), 'MailingDetailPage');
const MailingImportPage = lazyNamed(() => import('./pages/Mailings'), 'MailingImportPage');
const ListsPage = lazyNamed(() => import('./pages/Lists'), 'ListsPage');
const ListDetailPage = lazyNamed(() => import('./pages/Lists'), 'ListDetailPage');
const NewListPage = lazyNamed(() => import('./pages/Lists'), 'NewListPage');
const JourneysPage = lazyNamed(() => import('./pages/Journeys'), 'JourneysPage');
const StrategiesPage = lazyNamed(() => import('./pages/Strategies'), 'StrategiesPage');
const StrategyDetailPage = lazyNamed(() => import('./pages/Strategies'), 'StrategyDetailPage');
const TabulationsPage = lazyNamed(() => import('./pages/Tabulations'), 'TabulationsPage');
const ChannelsPage = lazyNamed(() => import('./pages/Channels'), 'ChannelsPage');
const VoiceAgentsPage = lazyNamed(() => import('./pages/VoiceAgents'), 'VoiceAgentsPage');
const TelephonyPage = lazyNamed(() => import('./pages/Telephony'), 'TelephonyPage');
const LimitsPage = lazyNamed(() => import('./pages/Limits'), 'LimitsPage');
const ObservabilityPage = lazyNamed(() => import('./pages/Observability'), 'ObservabilityPage');
const CentralIntelligencePage = lazyNamed(() => import('./pages/CentralIntelligence'), 'CentralIntelligencePage');
const ReportsPage = lazyNamed(() => import('./pages/Reports'), 'ReportsPage');
const BillingPage = lazyNamed(() => import('./pages/Billing'), 'BillingPage');
const SystemPage = lazyNamed(() => import('./pages/System'), 'SystemPage');
const MorePage = lazyNamed(() => import('./pages/More'), 'MorePage');
const NotFoundPage = lazyNamed(() => import('./pages/NotFound'), 'NotFoundPage');

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="p-8"><Loading /></div>}>{children}</Suspense>;
}

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
  { path: '/login', element: <S><LoginPage /></S> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <S><OverviewPage /></S> },
          { path: '/campanhas', element: <S><CampaignsPage /></S> },
          { path: '/campanhas/nova', element: <S><NewCampaignPage /></S> },
          { path: '/campanhas/modelos', element: <S><CampaignTemplatesPage /></S> },
          { path: '/campanhas/:id', element: <S><CampaignDetailPage /></S> },
          { path: '/modelos', element: <Navigate to="/campanhas/modelos" replace /> },
          { path: '/tentativas', element: <S><AttemptsPage /></S> },
          { path: '/contatos', element: <S><ContactsPage /></S> },
          { path: '/contatos/:id', element: <S><ContactDetailPage /></S> },
          { path: '/mailings', element: <S><MailingsPage /></S> },
          { path: '/mailings/importar', element: <S><MailingImportPage /></S> },
          { path: '/mailings/:id', element: <S><MailingDetailPage /></S> },
          { path: '/listas', element: <S><ListsPage /></S> },
          { path: '/listas/nova', element: <S><NewListPage /></S> },
          { path: '/listas/:id', element: <S><ListDetailPage /></S> },
          { path: '/jornadas', element: <S><JourneysPage /></S> },
          { path: '/estrategias', element: <S><StrategiesPage /></S> },
          { path: '/estrategias/:id', element: <S><StrategyDetailPage /></S> },
          { path: '/tabulacoes', element: <S><TabulationsPage /></S> },
          { path: '/canais', element: <S><ChannelsPage /></S> },
          { path: '/agentes-de-voz', element: <S><VoiceAgentsPage /></S> },
          { path: '/telefonia', element: <S><TelephonyPage /></S> },
          { path: '/relatorios', element: <S><ReportsPage /></S> },
          { path: '/consumo', element: <S><BillingPage /></S> },
          { path: '/billing', element: <S><BillingPage /></S> },
          { path: '/inteligencia', element: <S><CentralIntelligencePage /></S> },
          { path: '/limites', element: <S><LimitsPage /></S> },
          { path: '/observabilidade', element: <S><ObservabilityPage /></S> },
          { path: '/sistema', element: <S><SystemPage /></S> },
          { path: '/controle', element: <Navigate to="/limites" replace /> },
          { path: '/otimizacao', element: <Navigate to="/inteligencia" replace /> },
          { path: '/experimentos', element: <Navigate to="/inteligencia" replace /> },
          { path: '/custos', element: <Navigate to="/consumo" replace /> },
          { path: '/mais', element: <S><MorePage /></S> },
          { path: '*', element: <S><NotFoundPage /></S> },
        ],
      },
    ],
  },
]);

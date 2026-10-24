import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import {
  Activity,
  BookMarked,
  Cable,
  ChevronDown,
  Database,
  Home,
  ListFilter,
  LogOut,
  Megaphone,
  Menu,
  Route,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Tags,
  Users,
} from 'lucide-react';
import { ROLE_LABEL } from '@voll/shared';
import { useAuth } from '../lib/auth';
import { AttemptDrawer } from './AttemptDrawer';
import type { ReactNode } from 'react';

export type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };
const ico = 'size-4 shrink-0';
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operação',
    items: [
      { to: '/', label: 'Visão geral', icon: <Home className={ico} aria-hidden />, end: true },
      { to: '/campanhas', label: 'Campanhas', icon: <Megaphone className={ico} aria-hidden /> },
      { to: '/tentativas', label: 'Tentativas', icon: <Activity className={ico} aria-hidden /> },
    ],
  },
  {
    title: 'Dados',
    items: [
      { to: '/contatos', label: 'Contatos', icon: <Users className={ico} aria-hidden /> },
      { to: '/mailings', label: 'Mailings', icon: <Database className={ico} aria-hidden /> },
      { to: '/listas', label: 'Listas', icon: <ListFilter className={ico} aria-hidden /> },
    ],
  },
  {
    title: 'Configuração',
    items: [
      { to: '/jornadas', label: 'Jornadas', icon: <Route className={ico} aria-hidden /> },
      { to: '/estrategias', label: 'Estratégias', icon: <SlidersHorizontal className={ico} aria-hidden /> },
      { to: '/tabulacoes', label: 'Tabulações', icon: <Tags className={ico} aria-hidden /> },
      { to: '/canais', label: 'Canais', icon: <Cable className={ico} aria-hidden /> },
      { to: '/controle', label: 'Controle central', icon: <ShieldAlert className={ico} aria-hidden /> },
    ],
  },
];

const MOBILE: NavItem[] = [
  { to: '/', label: 'Início', icon: <Home className="size-5" aria-hidden />, end: true },
  { to: '/campanhas', label: 'Campanhas', icon: <Megaphone className="size-5" aria-hidden /> },
  { to: '/listas', label: 'Listas', icon: <ListFilter className="size-5" aria-hidden /> },
  { to: '/tentativas', label: 'Tentativas', icon: <Activity className="size-5" aria-hidden /> },
  { to: '/mais', label: 'Mais', icon: <Menu className="size-5" aria-hidden /> },
];

function UserMenu() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100"
          aria-label={`Menu do usuário ${me.name}`}
        >
          <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" aria-hidden>
            {me.name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate font-medium leading-tight">{me.name}</span>
            <span className="block text-xs leading-tight text-slate-500">{ROLE_LABEL[me.role]}</span>
          </span>
          <ChevronDown className="size-4 text-slate-500" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg">
          <div className="px-2 py-1.5">
            <div className="font-medium">{me.name}</div>
            <div className="text-xs text-slate-500">{me.email}</div>
            <div className="mt-1 text-xs text-slate-600">
              Perfil: <strong>{ROLE_LABEL[me.role]}</strong>
            </div>
            <div className="text-xs text-slate-600">
              {me.organization?.name} · {me.workspace?.name}
            </div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-slate-100"
            onSelect={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut className="size-4" aria-hidden /> Sair
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Layout() {
  const loc = useLocation();
  return (
    <div className="flex min-h-full">
      <a href="#conteudo" className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Pular para o conteúdo
      </a>
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">Voll Connect</span>
        </div>
        <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="mb-4">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</div>
              <ul>
                {g.items.map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.end}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                          isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-700 hover:bg-slate-100',
                        )
                      }
                    >
                      {it.icon}
                      {it.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
          <Settings2 className="mr-1 inline size-3" aria-hidden />
          MVP · conector simulado
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2 md:hidden">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="font-semibold">Voll Connect</span>
          </div>
          <div className="hidden text-sm text-slate-500 md:block">
            <BookMarked className="mr-1 inline size-4" aria-hidden />
            Campanhas inteligentes, do mailing ao contato
          </div>
          <UserMenu />
        </header>
        <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-5 focus:outline-none md:px-6 md:pb-8" key={loc.pathname}>
          <Outlet />
        </main>
      </div>

      {/* Barra móvel: 5 destinos fixos (§26.11) */}
      <nav aria-label="Navegação móvel" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white md:hidden" data-testid="mobile-nav">
        <ul className="grid grid-cols-5">
          {MOBILE.map((it) => (
            <li key={it.to}>
              <NavLink
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  clsx('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'font-semibold text-brand-800' : 'text-slate-600')
                }
              >
                {it.icon}
                {it.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <AttemptDrawer />
    </div>
  );
}

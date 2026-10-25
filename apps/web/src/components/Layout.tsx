import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { ROLES } from '@voll/shared';
import { setDemoRole } from '../lib/api';
import clsx from 'clsx';
import {
  Activity,
  BookMarked,
  BrainCircuit,
  Cable,
  ChevronDown,
  Compass,
  Database,
  Home,
  ListFilter,
  LogOut,
  Megaphone,
  Menu,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { ROLE_LABEL } from '@voll/shared';
import { useAuth } from '../lib/auth';
import { AttemptDrawer } from './AttemptDrawer';
import { BrandLogo } from './ui';
import type { ReactNode } from 'react';

export type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; matchPrefixes?: string[] };
const ico = 'size-4 shrink-0';
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operação',
    items: [
      { to: '/', label: 'Painel operacional', icon: <Home className={ico} aria-hidden />, end: true, matchPrefixes: ['/tentativas'] },
      { to: '/campanhas', label: 'Campanhas', icon: <Megaphone className={ico} aria-hidden /> },
      {
        to: '/mailings',
        label: 'Bases & Contatos',
        icon: <Database className={ico} aria-hidden />,
        matchPrefixes: ['/mailings', '/listas', '/contatos'],
      },
    ],
  },
  {
    title: 'Inteligência & Otimização',
    items: [
      {
        to: '/inteligencia',
        label: 'Laboratório & Testes Empíricos',
        icon: <BrainCircuit className={ico} aria-hidden />,
        matchPrefixes: ['/inteligencia'],
      },
    ],
  },
  {
    title: 'Configurações & Parâmetros',
    items: [
      {
        to: '/estrategias',
        label: 'Réguas & Estratégias',
        icon: <SlidersHorizontal className={ico} aria-hidden />,
        matchPrefixes: ['/estrategias', '/jornadas', '/tabulacoes'],
      },
      { to: '/canais', label: 'Canais & Conectores', icon: <Cable className={ico} aria-hidden /> },
      {
        to: '/otimizacao',
        label: 'Central de Decisão & Custos',
        icon: <Compass className={ico} aria-hidden />,
        matchPrefixes: ['/otimizacao', '/experimentos', '/custos'],
      },
      { to: '/controle', label: 'Governança & Controle Central', icon: <ShieldAlert className={ico} aria-hidden /> },
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
  const qc = useQueryClient();
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
          {me.demoMode ? (
            <>
              <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-slate-500">
                Mockup sem login · ver como
              </DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={me.role}
                onValueChange={(role) => {
                  setDemoRole(role);
                  qc.clear();
                  navigate('/', { replace: true });
                }}
              >
                {ROLES.map((r) => (
                  <DropdownMenu.RadioItem
                    key={r}
                    value={r}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-slate-100 data-[state=checked]:font-semibold"
                  >
                    <span className="inline-block w-3 text-brand-700" aria-hidden>
                      {me.role === r ? '✓' : ''}
                    </span>
                    {ROLE_LABEL[r]}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </>
          ) : (
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-slate-100"
              onSelect={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut className="size-4" aria-hidden /> Sair
            </DropdownMenu.Item>
          )}
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
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-200/90 bg-white md:flex">
        <div className="flex h-15 items-center border-b border-slate-100 px-4">
          <BrandLogo showTagline />
        </div>
        <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-3 py-3.5">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="mb-4">
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</div>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const matchedByPrefix = it.matchPrefixes?.some((p) => loc.pathname.startsWith(p)) ?? false;
                  return (
                    <li key={it.to}>
                      <NavLink
                        to={it.to}
                        end={it.end}
                        className={({ isActive }) =>
                          clsx(
                            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                            isActive || matchedByPrefix
                              ? 'bg-brand-50 font-semibold text-brand-800 shadow-2xs ring-1 ring-inset ring-brand-200/70'
                              : 'font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
                          )
                        }
                      >
                        {it.icon}
                        {it.label}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] font-medium text-slate-500">
          <Settings2 className="mr-1.5 inline size-3.5 text-brand-700" aria-hidden />
          MVP · Conector simulado ativo
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-15 items-center justify-between gap-3 border-b border-slate-200/90 bg-white/95 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <BrandLogo size="sm" />
          </div>
          <div className="hidden items-center gap-2 text-xs font-medium text-slate-500 md:flex">
            <span className="inline-flex size-2 rounded-full bg-emerald-500" aria-hidden />
            <BookMarked className="size-3.5 text-brand-700" aria-hidden />
            <span>Campanhas inteligentes, do mailing ao contato</span>
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

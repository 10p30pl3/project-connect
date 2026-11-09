import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { ROLES } from '@voll/shared';
import { setDemoRole } from '../lib/api';
import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  Bookmark,
  BookMarked,
  BrainCircuit,
  Cable,
  PhoneCall,
  ChevronDown,
  Compass,
  Database,
  Home,
  ListFilter,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Moon,
  Users,
} from 'lucide-react';
import { ROLE_LABEL } from '@voll/shared';
import { useAuth } from '../lib/auth';
import { AttemptDrawer } from './AttemptDrawer';
import { BrandLogo } from './ui';
import { type ReactNode, useState } from 'react';

export type SubNavItem = { to: string; label: string; end?: boolean };
export type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  matchPrefixes?: string[];
  subItems?: SubNavItem[];
};

export function isRouteActive(to: string, currentPath: string, currentSearch: string, end?: boolean) {
  if (to.includes('?')) {
    const [path, query] = to.split('?');
    if (currentPath !== path) return false;
    const toParams = new URLSearchParams(query);
    const curParams = new URLSearchParams(currentSearch);
    for (const [k, v] of toParams.entries()) {
      if (curParams.get(k) !== v) return false;
    }
    return true;
  }
  if (end) return currentPath === to;
  return currentPath === to || (to !== '/' && currentPath.startsWith(to + '/'));
}

const ico = 'size-4 shrink-0';
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operação',
    items: [
      {
        to: '/',
        label: 'Visão geral',
        icon: <Home className={ico} aria-hidden />,
        end: true,
      },
      {
        to: '/campanhas',
        label: 'Campanhas',
        icon: <Megaphone className={ico} aria-hidden />,
        end: true,
      },
      {
        to: '/campanhas/modelos',
        label: 'Modelos de campanhas',
        icon: <Bookmark className={ico} aria-hidden />,
        matchPrefixes: ['/campanhas/modelos', '/modelos'],
      },
      {
        to: '/inteligencia',
        label: 'Central de inteligência',
        icon: <BrainCircuit className={ico} aria-hidden />,
        matchPrefixes: ['/inteligencia'],
      },
    ],
  },
  {
    title: 'Dados',
    items: [
      {
        to: '/contatos',
        label: 'Contatos',
        icon: <Users className={ico} aria-hidden />,
        matchPrefixes: ['/contatos'],
      },
      {
        to: '/mailings',
        label: 'Mailings',
        icon: <Database className={ico} aria-hidden />,
        matchPrefixes: ['/mailings'],
      },
      {
        to: '/listas',
        label: 'Listas',
        icon: <ListFilter className={ico} aria-hidden />,
        matchPrefixes: ['/listas'],
      },
    ],
  },
  {
    title: 'Configuração',
    items: [
      {
        to: '/jornadas',
        label: 'Jornadas',
        icon: <Compass className={ico} aria-hidden />,
        matchPrefixes: ['/jornadas'],
      },
      {
        to: '/estrategias',
        label: 'Estratégias',
        icon: <SlidersHorizontal className={ico} aria-hidden />,
        matchPrefixes: ['/estrategias'],
      },
      {
        to: '/tabulacoes',
        label: 'Tabulação',
        icon: <BookMarked className={ico} aria-hidden />,
        matchPrefixes: ['/tabulacoes'],
      },
      {
        to: '/canais',
        label: 'Canais',
        icon: <Cable className={ico} aria-hidden />,
        matchPrefixes: ['/canais'],
      },
      {
        to: '/telefonia',
        label: 'Telefonia',
        icon: <PhoneCall className={ico} aria-hidden />,
        matchPrefixes: ['/telefonia'],
      },
    ],
  },
  {
    title: 'Relatórios',
    items: [
      {
        to: '/relatorios',
        label: 'Relatórios',
        icon: <BarChart3 className={ico} aria-hidden />,
        matchPrefixes: ['/relatorios'],
      },
    ],
  },
  {
    title: 'Governança',
    items: [
      {
        to: '/limites',
        label: 'Limites',
        icon: <ShieldAlert className={ico} aria-hidden />,
        matchPrefixes: ['/limites', '/controle'],
      },
      {
        to: '/observabilidade',
        label: 'Observabilidade',
        icon: <Activity className={ico} aria-hidden />,
        matchPrefixes: ['/observabilidade', '/audit'],
      },
    ],
  },
  {
    title: 'Sistema',
    items: [
      {
        to: '/sistema',
        label: 'Sistema',
        icon: <Settings className={ico} aria-hidden />,
        matchPrefixes: ['/sistema'],
      },
    ],
  },
];

const MOBILE: NavItem[] = [
  { to: '/', label: 'Início', icon: <Home className="size-5" aria-hidden />, end: true },
  { to: '/campanhas', label: 'Campanhas', icon: <Megaphone className="size-5" aria-hidden /> },
  { to: '/inteligencia', label: 'Inteligência', icon: <BrainCircuit className="size-5" aria-hidden /> },
  { to: '/contatos', label: 'Contatos', icon: <Users className="size-5" aria-hidden /> },
  { to: '/mais', label: 'Mais', icon: <Menu className="size-5" aria-hidden /> },
];

function UserMenu({ sidebar = false }: { sidebar?: boolean } = {}) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  if (!me) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={clsx(
            'flex items-center gap-2.5 rounded-lg text-left transition-colors cursor-pointer',
            sidebar
              ? 'w-full p-2 bg-slate-50/70 border border-slate-200/80 hover:bg-slate-100 hover:border-slate-300 shadow-2xs'
              : 'px-2 py-1.5 text-sm hover:bg-slate-100'
          )}
          aria-label={`Menu do usuário ${me.name}`}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" aria-hidden>
            {me.name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-900 leading-tight">{me.name}</span>
            <span className="block truncate text-[11px] text-slate-500 leading-tight">{ROLE_LABEL[me.role]}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={sidebar ? 'start' : 'end'}
          side={sidebar ? 'right' : 'bottom'}
          sideOffset={8}
          className="z-50 min-w-56 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg"
        >
          <div className="px-2.5 py-2">
            <div className="font-semibold text-slate-900">{me.name}</div>
            <div className="text-xs text-slate-500">{me.email}</div>
            <div className="mt-1 text-xs text-slate-600">
              Perfil: <strong>{ROLE_LABEL[me.role]}</strong>
            </div>
            <div className="text-xs text-slate-600">
              {me.organization?.name} · {me.workspace?.name}
            </div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          {me.demoMode && (
            <>
              <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-slate-500">
                Alternar perfil (Demonstração)
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
              <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
            </>
          )}
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-slate-100 text-slate-700 hover:text-rose-600"
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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document !== 'undefined') {
      return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
    }
    return 'light';
  });

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('voll-plan-theme', next);
      } catch {}
    }
  };

  return (
    <div className="flex min-h-full">
      <a href="#conteudo" className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Pular para o conteúdo
      </a>
      {/* Sidebar desktop - Padrão Voll Connect (largura 260px, header 62px) */}
      <aside className="sticky top-0 hidden h-dvh w-[260px] min-w-[260px] shrink-0 flex-col border-r border-slate-200/90 bg-white md:flex">
        <div className="flex h-[62px] items-center border-b border-slate-100 px-[18px]">
          <BrandLogo showTagline />
        </div>
        <div className="border-b border-slate-100 p-3">
          <UserMenu sidebar />
        </div>
        <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-3 py-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="mb-3.5">
              <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.6px] text-slate-400">{g.title}</div>
              <ul className="space-y-1">
                {g.items.map((it) => {
                  const isAnySubActive = it.subItems?.some((sub) => isRouteActive(sub.to, loc.pathname, loc.search, sub.end)) ?? false;
                  const isParentDirectActive = isRouteActive(it.to, loc.pathname, loc.search, it.end);
                  const isPrefixMatched = it.matchPrefixes?.some((p) => loc.pathname === p || loc.pathname.startsWith(p + '/')) ?? false;
                  const isParentActive = isParentDirectActive || isAnySubActive || isPrefixMatched;

                  return (
                    <li key={it.to} className="space-y-0.5">
                      <Link
                        to={it.to}
                        className={clsx(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                          isParentActive
                            ? 'bg-brand-50/80 font-semibold text-brand-900 ring-1 ring-inset ring-brand-200/60'
                            : 'font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
                        )}
                      >
                        <span className={clsx(isParentActive ? 'text-brand-700' : 'text-slate-500')}>
                          {it.icon}
                        </span>
                        <span className="truncate">{it.label}</span>
                      </Link>

                      {/* Submenu links: sempre abertos, sem botão de recolher */}
                      {it.subItems && it.subItems.length > 0 && (
                        <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2.5 py-0.5">
                          {it.subItems.map((sub) => {
                            const isSubActive = isRouteActive(sub.to, loc.pathname, loc.search, sub.end);
                            return (
                              <li key={sub.to}>
                                <Link
                                  to={sub.to}
                                  className={clsx(
                                    'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                                    isSubActive
                                      ? 'bg-brand-100/80 font-semibold text-brand-900 shadow-2xs'
                                      : 'font-medium text-slate-500 hover:bg-slate-100/80 hover:text-slate-900',
                                  )}
                                >
                                  <span
                                    className={clsx(
                                      'size-1.5 shrink-0 rounded-full transition-colors',
                                      isSubActive ? 'bg-brand-700' : 'bg-slate-300',
                                    )}
                                    aria-hidden
                                  />
                                  <span className="truncate">{sub.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-100 bg-slate-50/60 p-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-1.5 px-3 text-[12px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
            title="Alternar entre modo Claro e Escuro"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="size-3.5 text-amber-500" aria-hidden />
                <span>Modo Claro</span>
              </>
            ) : (
              <>
                <Moon className="size-3.5 text-slate-600" aria-hidden />
                <span>Modo Escuro</span>
              </>
            )}
          </button>
          <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-400">
            <span className="flex items-center gap-1">
              <Settings2 className="size-3 text-brand-700" aria-hidden />
              Voll Plan
            </span>
            <span className="tabular opacity-75">v1.0.4</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabeçalho compacto visível apenas em telas móveis */}
        <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-slate-200/90 bg-white/95 px-4 backdrop-blur md:hidden">
          <BrandLogo size="sm" />
          <UserMenu />
        </header>
        <main
          id="conteudo"
          tabIndex={-1}
          className="w-full flex-1 px-7 py-6 focus:outline-none md:pb-10"
          key={loc.pathname}
        >
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

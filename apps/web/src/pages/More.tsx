import { NavLink } from 'react-router-dom';
import { isSuperAdminRole } from '@voll/shared';
import { NAV_GROUPS } from '../components/Layout';
import { PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';
import { EXPERIENCE_MODE_META, useExperienceMode } from '../lib/experience-mode';

/** Destino "Mais" da barra móvel: Operação, Dados e Configuração (§26.11). */
export function MorePage() {
  const { me } = useAuth();
  const { mode, setMode, isAtLeast } = useExperienceMode();
  const isSuper = isSuperAdminRole(me?.role);

  return (
    <div>
      <PageHeader title="Mais" />
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Nível da interface ({EXPERIENCE_MODE_META[mode].label})
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(['basic', 'advanced'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setMode(lvl)}
              className={
                mode === lvl
                  ? 'rounded-lg bg-brand-700 py-1.5 text-xs font-semibold text-white'
                  : 'rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-xs font-medium text-slate-700'
              }
            >
              {EXPERIENCE_MODE_META[lvl].shortLabel}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-5">
        {NAV_GROUPS.map((g) => {
          const visibleItems = g.items.filter((it) => isAtLeast(it.minMode ?? 'basic'));
          if (visibleItems.length === 0) return null;
          return (
            <nav key={g.title} aria-label={g.title}>
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{g.title}</h2>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {visibleItems.map((it) => {
                  const label = it.to === '/consumo' && !isSuper ? 'Consumo de Tempo' : it.label;
                  return (
                    <li key={it.to} className="p-3">
                      <NavLink to={it.to} end={it.end} className="flex items-center gap-3 text-sm font-semibold text-slate-800 hover:text-brand-800">
                        {it.icon}
                        {label}
                      </NavLink>
                      {it.subItems && it.subItems.length > 0 && (
                        <ul className="ml-7 mt-2 space-y-1.5 border-l border-slate-200 pl-3">
                          {it.subItems.map((sub) => (
                            <li key={sub.to}>
                              <NavLink to={sub.to} end={sub.end} className="block text-xs font-medium text-slate-600 hover:text-brand-800">
                                {sub.label}
                              </NavLink>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          );
        })}
      </div>
    </div>
  );
}

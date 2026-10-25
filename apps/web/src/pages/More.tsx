import { NavLink } from 'react-router-dom';
import { NAV_GROUPS } from '../components/Layout';
import { PageHeader } from '../components/ui';

/** Destino "Mais" da barra móvel: Operação, Dados e Configuração (§26.11). */
export function MorePage() {
  return (
    <div>
      <PageHeader title="Mais" />
      <div className="space-y-5">
        {NAV_GROUPS.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{g.title}</h2>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {g.items.map((it) => (
                <li key={it.to} className="p-3">
                  <NavLink to={it.to} end={it.end} className="flex items-center gap-3 text-sm font-semibold text-slate-800 hover:text-brand-800">
                    {it.icon}
                    {it.label}
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
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </div>
  );
}

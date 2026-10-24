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
                <li key={it.to}>
                  <NavLink to={it.to} end={it.end} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                    {it.icon}
                    {it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </div>
  );
}

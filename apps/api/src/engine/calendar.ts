import { DateTime } from 'luxon';
import type { StrategyConfig } from '@voll/shared';

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** dia da semana no formato do plano/estratégia: 0=domingo..6=sábado */
export const weekday0 = (dt: DateTime) => dt.weekday % 7;

export function inCalendar(cal: StrategyConfig['calendar'], now: Date): boolean {
  const dt = DateTime.fromJSDate(now, { zone: cal.timezone || 'America/Sao_Paulo' });
  if (!cal.days.includes(weekday0(dt))) return false;
  const m = dt.hour * 60 + dt.minute;
  const s = toMin(cal.start);
  const e = toMin(cal.end);
  return m >= s && (e === 23 * 60 + 59 ? m <= e : m < e);
}

/** Início do dia operacional no fuso da política (contagem diária, AC09). */
export function startOfOperationalDay(now: Date, timezone: string): Date {
  return DateTime.fromJSDate(now, { zone: timezone || 'America/Sao_Paulo' }).startOf('day').toJSDate();
}

/** Próxima abertura da janela. null se nunca (sem dias). */
export function nextWindowStart(cal: StrategyConfig['calendar'], now: Date): Date | null {
  if (inCalendar(cal, now)) return now;
  const zone = cal.timezone || 'America/Sao_Paulo';
  const base = DateTime.fromJSDate(now, { zone });
  const [h, m] = cal.start.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = base.plus({ days: i }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
    if (!cal.days.includes(weekday0(d))) continue;
    if (d > base) return d.toJSDate();
  }
  return null;
}

const DAY_SHORT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

export function describeNextWindow(cal: StrategyConfig['calendar'], now: Date): string | null {
  const n = nextWindowStart(cal, now);
  if (!n) return null;
  if (n.getTime() === now.getTime()) return 'Agora — dentro da janela permitida (horário de São Paulo)';
  const dt = DateTime.fromJSDate(n, { zone: cal.timezone || 'America/Sao_Paulo' });
  return `${DAY_SHORT[weekday0(dt)]} ${dt.toFormat('dd/LL')} às ${dt.toFormat('HH:mm')} (horário de São Paulo)`;
}

export function describeDays(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return 'todos os dias';
  return sorted.map((d) => DAY_SHORT[d]).join(', ');
}

export function strategySummary(c: StrategyConfig): string {
  return (
    `Até ${c.limits.total} tentativas por cliente (${c.limits.daily} por dia), ` +
    `${describeDays(c.calendar.days)} das ${c.calendar.start} às ${c.calendar.end} (${c.calendar.timezone}); ` +
    `retentativa a cada ${c.retry.intervalMinutes} min; até ${c.retry.maxPerDestination} tentativas por destino. ` +
    `Bloqueios e limites globais prevalecem sobre o template.`
  );
}

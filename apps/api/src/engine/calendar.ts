import { DateTime } from 'luxon';
import type { StrategyConfig } from '@voll/shared';

export type OperationCalendarLike = {
  timezone: string;
  windows: { days: number[]; start: string; end: string }[];
  holidayPolicy?: 'BLOCK' | 'ALLOW';
  holidays?: { date: string; action: 'BLOCK' | 'ALLOW' | 'LIMIT'; startTime?: string | null; endTime?: string | null }[];
};

export type CalendarInput = StrategyConfig['calendar'] | OperationCalendarLike;

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** dia da semana no formato do plano/estratégia: 0=domingo..6=sábado */
export const weekday0 = (dt: DateTime) => dt.weekday % 7;

function isOperationCalendar(cal: CalendarInput): cal is OperationCalendarLike {
  return 'windows' in cal && Array.isArray(cal.windows);
}

function checkTimeInRange(m: number, start: string, end: string): boolean {
  const s = toMin(start);
  const e = toMin(end);
  return m >= s && (e === 23 * 60 + 59 ? m <= e : m < e);
}

export function inCalendar(cal: CalendarInput, now: Date): boolean {
  const dt = DateTime.fromJSDate(now, { zone: cal.timezone || 'America/Sao_Paulo' });
  const m = dt.hour * 60 + dt.minute;

  if (!isOperationCalendar(cal)) {
    if (!cal.days.includes(weekday0(dt))) return false;
    return checkTimeInRange(m, cal.start, cal.end);
  }

  const dateKey = dt.toFormat('yyyy-MM-dd');
  const holiday = cal.holidays?.find((h) => h.date.slice(0, 10) === dateKey);
  if (holiday) {
    if (holiday.action === 'BLOCK') return false;
    if (holiday.action === 'LIMIT' && holiday.startTime && holiday.endTime) {
      return checkTimeInRange(m, holiday.startTime.slice(0, 5), holiday.endTime.slice(0, 5));
    }
    if (holiday.action === 'ALLOW') {
      return cal.windows.some((w) => checkTimeInRange(m, w.start, w.end));
    }
  }

  const wday = weekday0(dt);
  return cal.windows.some((w) => w.days.includes(wday) && checkTimeInRange(m, w.start, w.end));
}

/** Início do dia operacional no fuso da política (contagem diária, AC09). */
export function startOfOperationalDay(now: Date, timezone: string): Date {
  return DateTime.fromJSDate(now, { zone: timezone || 'America/Sao_Paulo' }).startOf('day').toJSDate();
}

/** Próxima abertura da janela. null se nunca (sem dias). */
export function nextWindowStart(cal: CalendarInput, now: Date): Date | null {
  if (inCalendar(cal, now)) return now;
  const zone = cal.timezone || 'America/Sao_Paulo';
  const base = DateTime.fromJSDate(now, { zone });

  if (!isOperationCalendar(cal)) {
    const [h, m] = cal.start.split(':').map(Number);
    for (let i = 0; i < 8; i++) {
      const d = base.plus({ days: i }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (!cal.days.includes(weekday0(d))) continue;
      if (d > base) return d.toJSDate();
    }
    return null;
  }

  let earliest: DateTime | null = null;
  for (let i = 0; i < 14; i++) {
    const dayBase = base.plus({ days: i });
    const dateKey = dayBase.toFormat('yyyy-MM-dd');
    const holiday = cal.holidays?.find((h) => h.date.slice(0, 10) === dateKey);
    if (holiday?.action === 'BLOCK') continue;

    if (holiday?.action === 'LIMIT' && holiday.startTime) {
      const [hh, mm] = holiday.startTime.split(':').map(Number);
      const candidate = dayBase.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
      if (candidate > base && (!earliest || candidate < earliest)) earliest = candidate;
      continue;
    }

    const wday = weekday0(dayBase);
    for (const w of cal.windows) {
      if (!w.days.includes(wday) && holiday?.action !== 'ALLOW') continue;
      const [hh, mm] = w.start.split(':').map(Number);
      const candidate = dayBase.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
      if (candidate > base && (!earliest || candidate < earliest)) earliest = candidate;
    }
    if (earliest) return earliest.toJSDate();
  }
  return earliest ? earliest.toJSDate() : null;
}

const DAY_SHORT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

export function describeNextWindow(cal: CalendarInput, now: Date): string | null {
  const n = nextWindowStart(cal, now);
  if (!n) return null;
  const zone = cal.timezone || 'America/Sao_Paulo';
  if (n.getTime() === now.getTime()) return `Agora — dentro da janela permitida (${zone})`;
  const dt = DateTime.fromJSDate(n, { zone });
  return `${DAY_SHORT[weekday0(dt)]} ${dt.toFormat('dd/LL')} às ${dt.toFormat('HH:mm')} (${zone})`;
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
    `Bloqueios e limites globais prevalem sobre o template.`
  );
}

export const TZ = 'America/Sao_Paulo';

const dtf = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dtfSec = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : dtf.format(d);
}
export function fmtDateTimeSec(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : dtfSec.format(d);
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR');
}

export function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: 4 });
}

export function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return (n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
}

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Converte "YYYY-MM-DDTHH:mm" interpretado em America/Sao_Paulo para ISO com offset. */
export function saoPauloLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const [datePart, timePart] = local.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  // offset de São Paulo no instante aproximado (sem horário de verão desde 2019, mas calculado para robustez)
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetMin = tzOffsetMinutes(new Date(guess), TZ);
  const utc = guess - offsetMin * 60_000;
  const off = tzOffsetMinutes(new Date(utc), TZ);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${local}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** Valor "agora" em São Paulo no formato do input datetime-local. */
export function nowSaoPauloLocal(addMinutes = 0): string {
  const d = new Date(Date.now() + addMinutes * 60000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

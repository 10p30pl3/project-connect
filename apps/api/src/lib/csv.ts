/** Exportação CSV segura (§8.3): escapa aspas/separadores e neutraliza fórmulas. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][], sep = ';'): string {
  const lines = [headers.map(csvCell).join(sep), ...rows.map((r) => r.map(csvCell).join(sep))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

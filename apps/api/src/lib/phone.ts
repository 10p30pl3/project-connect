/** Normalização de telefone (§6.1, §16.1): texto, só dígitos, 10–15 dígitos, sem notação científica. */
export function normalizePhone(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: 'telefone vazio' };
  if (/\d[.,]?\d*e[+-]?\d+/i.test(s)) return { ok: false, error: 'telefone em notação científica' };
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return { ok: false, error: `telefone deve ter de 10 a 15 dígitos (${digits.length})` };
  // recomenda DDI: números com 10/11 dígitos recebem +55
  const value = digits.length <= 11 ? `55${digits}` : digits;
  return { ok: true, value: `+${value}` };
}

export function normalizeEmail(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { ok: false, error: 'e-mail inválido' };
  return { ok: true, value: s };
}

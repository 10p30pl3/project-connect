/** Pertencimento de lista sobre um mailing (§7): filtros, ordenação determinística, exclusões por motivo. */
import type { ListFilter, ReasonCode } from '@voll/shared';
import type { Db } from '../db/pool.js';
import { q } from '../db/pool.js';

export type MemberCandidate = {
  recordId: string;
  rowNumber: number;
  contactId: string;
  externalId: string;
  name: string | null;
  fields: Record<string, unknown>;
};

export type MembershipResult = {
  members: MemberCandidate[];
  excluded: { reason: ReasonCode; count: number }[];
  filteredOut: number;
  /** clientes que satisfazem os filtros (inclusive bloqueados) */
  matched: Set<string>;
};

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1; // nulos por último
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export function matchFilter(fields: Record<string, unknown>, f: ListFilter): boolean {
  const v = fields[f.field];
  const empty = v === null || v === undefined || v === '';
  switch (f.op) {
    case 'empty':
      return empty;
    case 'not_empty':
      return !empty;
    case 'contains':
      return !empty && String(v).toLowerCase().includes(String(f.value ?? '').toLowerCase());
    case 'eq':
    case 'neq': {
      const nv = asNumber(v);
      const nf = asNumber(f.value);
      const eq = nv !== null && nf !== null ? nv === nf : String(v ?? '').toLowerCase() === String(f.value ?? '').toLowerCase();
      return f.op === 'eq' ? eq : !eq;
    }
    default: {
      if (empty) return false;
      const nv = asNumber(v);
      const nf = asNumber(f.value);
      const c = nv !== null && nf !== null ? nv - nf : String(v).localeCompare(String(f.value ?? ''));
      return f.op === 'gt' ? c > 0 : f.op === 'gte' ? c >= 0 : f.op === 'lt' ? c < 0 : c <= 0;
    }
  }
}

export async function computeMembership(
  db: Db,
  workspaceId: string,
  mailingId: string,
  filters: ListFilter[],
  sort: { field: string; dir: 'asc' | 'desc' }[],
): Promise<MembershipResult> {
  const rows = await q(
    db,
    `SELECT r.id, r.row_number, r.contact_id, r.typed_fields, c.external_id, c.name, c.attributes
       FROM mailing_records r JOIN contacts c ON c.id = r.contact_id
      WHERE r.mailing_id = $1 ORDER BY r.row_number`,
    [mailingId],
  );
  const blocked = new Set(
    (
      await q(db, `SELECT DISTINCT contact_id FROM blocks WHERE workspace_id=$1 AND scope='CONTACT' AND revoked_at IS NULL`, [workspaceId])
    ).map((r) => r.contact_id),
  );
  const withDest = new Set(
    (
      await q(
        db,
        `SELECT DISTINCT d.contact_id FROM contact_destinations d JOIN mailing_records r ON r.contact_id = d.contact_id
          WHERE r.mailing_id = $1 AND d.valid`,
        [mailingId],
      )
    ).map((r) => r.contact_id),
  );

  const seen = new Set<string>();
  const matched = new Set<string>();
  const cands: MemberCandidate[] = [];
  let filteredOut = 0;
  const excl: Record<string, number> = {};
  for (const r of rows) {
    const fields: Record<string, unknown> = { ...(r.attributes ?? {}), ...(r.typed_fields ?? {}), name: r.name, external_id: r.external_id };
    if (!filters.every((f) => matchFilter(fields, f))) {
      filteredOut++;
      continue;
    }
    matched.add(r.contact_id);
    if (seen.has(r.contact_id)) continue; // um membro por cliente; contratos adicionais ficam no mailing
    seen.add(r.contact_id);
    let reason: ReasonCode | null = null;
    if (!r.external_id) reason = 'INVALID_RECORD';
    else if (blocked.has(r.contact_id)) reason = 'DNC';
    else if (!withDest.has(r.contact_id)) reason = 'NO_DESTINATION';
    if (reason) {
      excl[reason] = (excl[reason] ?? 0) + 1;
      continue;
    }
    cands.push({ recordId: r.id, rowNumber: r.row_number, contactId: r.contact_id, externalId: r.external_id, name: r.name, fields });
  }
  if (sort.length) {
    cands.sort((a, b) => {
      for (const s of sort) {
        const c = cmp(a.fields[s.field], b.fields[s.field]);
        if (c !== 0) {
          const nullish = (x: unknown) => x === null || x === undefined || x === '';
          // nulos sempre no fim, independentemente da direção
          if (nullish(a.fields[s.field]) || nullish(b.fields[s.field])) return c;
          return s.dir === 'desc' ? -c : c;
        }
      }
      return a.rowNumber - b.rowNumber; // desempate determinístico
    });
  }
  return {
    members: cands,
    excluded: Object.entries(excl).map(([reason, count]) => ({ reason: reason as ReasonCode, count })),
    filteredOut,
    matched,
  };
}

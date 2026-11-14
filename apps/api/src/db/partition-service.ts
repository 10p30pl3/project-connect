import { getPool, q, tx } from './pool.js';

export type PartitionStatRow = {
  name: string;
  bounds: string;
  estimatedRows: number;
  totalBytes: number;
  sizePretty: string;
  isDefault: boolean;
};

function monthBoundsUtc(offsetMonths: number): { name: string; startIso: string; endIso: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths + 1, 1, 0, 0, 0));
  const y = start.getUTCFullYear();
  const m = String(start.getUTCMonth() + 1).padStart(2, '0');
  return {
    name: `tenant_billing_ledger_${y}_${m}`,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export async function ensureUpcomingPartitions(monthsBack = 1, monthsAhead = 3): Promise<{ created: string[] }> {
  const pool = getPool();
  const created: string[] = [];

  const exists = await q<{ ok: string | null }>(
    pool,
    `SELECT to_regclass('public.tenant_billing_ledger')::text AS ok`,
  );
  if (!exists[0]?.ok) return { created };

  await tx(async (c) => {
    const lock = await c.query<{ acquired: boolean }>(`SELECT pg_try_advisory_xact_lock(9841201) AS acquired`);
    if (!lock.rows[0]?.acquired) return;
    for (let offset = -monthsBack; offset <= monthsAhead; offset += 1) {
      const { name, startIso, endIso } = monthBoundsUtc(offset);
      if (!/^[a-z0-9_]+$/.test(name)) continue;
      const reg = await c.query<{ ok: string | null }>(`SELECT to_regclass($1)::text AS ok`, [`public.${name}`]);
      if (reg.rows[0]?.ok) continue;

      await c.query(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF tenant_billing_ledger FOR VALUES FROM ('${startIso}') TO ('${endIso}')`,
      );
      created.push(name);
    }
  });
  return { created };
}

export async function getPartitionStats(): Promise<{
  parent: string;
  partitionCount: number;
  defaultPartitionRows: number;
  partitions: PartitionStatRow[];
}> {
  const rows = await q<{
    name: string;
    bounds: string;
    estimated_rows: number;
    total_bytes: number;
    size_pretty: string;
  }>(
    getPool(),
    `SELECT c.relname AS name,
            pg_get_expr(c.relpartbound, c.oid) AS bounds,
            COALESCE(s.n_live_tup, 0)::bigint AS estimated_rows,
            pg_total_relation_size(c.oid)::bigint AS total_bytes,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE p.relname = 'tenant_billing_ledger'
      ORDER BY c.relname ASC`,
  );

  const partitions: PartitionStatRow[] = rows.map((r) => ({
    name: r.name,
    bounds: r.bounds ?? '',
    estimatedRows: Number(r.estimated_rows ?? 0),
    totalBytes: Number(r.total_bytes ?? 0),
    sizePretty: r.size_pretty ?? '0 bytes',
    isDefault: r.name.endsWith('_default'),
  }));

  const defaultRow = partitions.find((p) => p.isDefault);
  return {
    parent: 'tenant_billing_ledger',
    partitionCount: partitions.length,
    defaultPartitionRows: defaultRow?.estimatedRows ?? 0,
    partitions,
  };
}

import pg from 'pg';
import { config } from '../config.js';

// numeric -> number (custos com 4 casas cabem em double sem problema para exibição)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 (count) -> number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export type Db = pg.Pool | pg.PoolClient;
export type Client = pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });
    pool.on('error', () => {});
  }
  return pool;
}

export function setPool(p: pg.Pool) {
  pool = p;
}

export async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

export async function q<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(text, params as any[]);
  return r.rows as T[];
}

export async function one<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(text, params as any[]);
  return (r.rows[0] as T) ?? null;
}

export async function tx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

import pg from 'pg';
import { migrate } from '../src/db/migrate.js';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/voll_connect_test';
  try {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
    await c.connect();
    await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await c.end();
    await migrate(url, false);
  } catch (err: any) {
    if (process.env.SKIP_DB_SETUP === 'true' || err?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
      console.warn(`[test/global-setup] Database not reachable at ${url}. Skipping DB setup for non-DB unit tests.`);
      return;
    }
    throw err;
  }
}

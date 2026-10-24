import pg from 'pg';
import { migrate } from '../src/db/migrate.js';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/voll_connect_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await migrate(url, false);
}

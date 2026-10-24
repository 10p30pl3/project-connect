import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '../../migrations');

export async function migrate(databaseUrl = config.databaseUrl, log = true) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        if (log) console.log(`migração aplicada: ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  migrate()
    .then(() => console.log('migrações ok'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

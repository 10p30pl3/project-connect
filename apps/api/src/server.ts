import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';

const app = await buildApp({ logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await closePool();
    process.exit(0);
  });
}

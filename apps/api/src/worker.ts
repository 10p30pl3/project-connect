/**
 * Worker do motor: processa sem navegador aberto e retoma após reinício (estado só no banco, §18.2).
 * Várias instâncias podem rodar em paralelo (FOR UPDATE / SKIP LOCKED + índice único de tentativa ativa).
 */
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { tick } from './engine/maintenance.js';

let stopping = false;
let running = false;

async function loop() {
  while (!stopping) {
    running = true;
    const started = Date.now();
    try {
      const s = await tick();
      const busy = Object.values(s).some((v) => v > 0);
      if (busy) console.log(new Date().toISOString(), 'tick', JSON.stringify(s));
    } catch (e) {
      console.error(new Date().toISOString(), 'erro no tick', e);
    }
    running = false;
    const wait = Math.max(200, config.workerTickMs - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stopping = true;
    while (running) await new Promise((r) => setTimeout(r, 100));
    await closePool();
    process.exit(0);
  });
}

console.log(`worker iniciado (tick ${config.workerTickMs} ms)`);
void loop();

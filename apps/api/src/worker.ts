/**
 * Worker do motor: processa sem navegador aberto e retoma após reinício (estado só no banco, §18.2).
 * Várias instâncias podem rodar em paralelo (FOR UPDATE / SKIP LOCKED + índice único de tentativa ativa).
 */
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { tick } from './engine/maintenance.js';
import { reconcileVoiceAgents } from './modules/voice-agent.js';

const AGENT_RECONCILE_MS = Number(process.env.VOICE_AGENT_RECONCILE_MS ?? 60_000);
let lastAgentReconcile = 0;

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
      if (Date.now() - lastAgentReconcile >= AGENT_RECONCILE_MS) {
        lastAgentReconcile = Date.now();
        const r = await reconcileVoiceAgents();
        if (r.republished || r.failed) console.log(new Date().toISOString(), 'agentes de voz', JSON.stringify(r));
      }
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

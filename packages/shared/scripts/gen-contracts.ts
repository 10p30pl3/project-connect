/**
 * Gera os JSON Schemas do contrato Voll Plan <-> gateway de voz a partir dos schemas Zod.
 * `npm run contracts` grava; `npm run contracts -- --check` falha se os arquivos estiverem desatualizados (CI).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ConnectorEventSchema, VoiceCallAcceptedSchema, VoiceCallRequestSchema } from '../src/index.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts');
const targets = {
  'voice-call-request.schema.json': VoiceCallRequestSchema,
  'voice-call-accepted.schema.json': VoiceCallAcceptedSchema,
  'connector-event.schema.json': ConnectorEventSchema,
};

export function render(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [file, schema] of Object.entries(targets)) {
    const js = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' });
    out[file] = JSON.stringify(js, null, 2) + '\n';
  }
  return out;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [file, text] of Object.entries(render())) {
  const p = join(dir, file);
  let current = '';
  try {
    current = readFileSync(p, 'utf8');
  } catch {
    /* ausente */
  }
  if (current === text) continue;
  if (check) {
    stale++;
    console.error(`contrato desatualizado: contracts/${file} (rode npm run contracts)`);
  } else {
    writeFileSync(p, text);
    console.log(`gerado contracts/${file}`);
  }
}
if (stale) process.exit(1);

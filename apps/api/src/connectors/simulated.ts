/**
 * Conector SIMULADO — provedor fictício para desenvolvimento e homologação do motor.
 * Aceita o envio, gera um id do provedor e agenda webhooks reais (entregues pelo worker via HTTP
 * assinado) com resultado sorteado pelos pesos configurados na conexão.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from '../db/pool.js';
import type { ConnectorAdapter, SendInput, SendResult } from './adapter.js';

export type SimulationConfig = {
  outcomes: Record<string, number>; // código de tabulação (ou OPT_OUT / RESULT_UNKNOWN) -> peso
  minDelaySeconds: number;
  maxDelaySeconds: number;
  duplicateRate: number;
  noReturnRate: number;
  rejectRate?: number;
  inconclusiveRate?: number;
};

export const DEFAULT_SIMULATION: SimulationConfig = {
  outcomes: { NO_ANSWER: 4, BUSY: 1, CPC_NO_DEAL: 2, CONVERSION: 1, WRONG_PERSON: 1, INVALID_NUMBER: 0.5, OPT_OUT: 0.2, RESULT_UNKNOWN: 0.3 },
  minDelaySeconds: 2,
  maxDelaySeconds: 8,
  duplicateRate: 0.15,
  noReturnRate: 0.05,
  rejectRate: 0,
  inconclusiveRate: 0,
};

let rng: () => number = Math.random;
/** Testes podem fixar a aleatoriedade. */
export function setSimulationRandom(fn: () => number) {
  rng = fn;
}

export function pickOutcome(outcomes: Record<string, number>): string {
  const entries = Object.entries(outcomes).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!entries.length || total <= 0) return 'NO_ANSWER';
  let x = rng() * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function buildEvent(providerAttemptId: string, type: string, tabulationCode?: string, at = new Date()) {
  return {
    eventId: `sim-${randomUUID()}`,
    providerAttemptId,
    type,
    occurredAt: at.toISOString(),
    ...(tabulationCode ? { tabulationCode } : {}),
  };
}

export async function scheduleSimEvent(c: Client, connectionId: string, payload: any, deliverAt: Date) {
  await c.query(
    `INSERT INTO sim_scheduled_events (connection_id, payload, deliver_at, provider_attempt_id) VALUES ($1,$2,$3,$4)`,
    [connectionId, JSON.stringify(payload), deliverAt, payload.providerAttemptId],
  );
}

export const simulatedAdapter: ConnectorAdapter = {
  capabilities: { statusQuery: false, cancel: false, asyncResults: true, maxBatch: 100 },
  async send(c: Client, { attempt, connection }: SendInput): Promise<SendResult> {
    const cfg: SimulationConfig = { ...DEFAULT_SIMULATION, ...(connection.config?.simulation ?? {}) };
    if (rng() < (cfg.rejectRate ?? 0)) return { status: 'REJECTED', reason: 'SIM_REJECTED' };
    const providerAttemptId = `sim-${attempt.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    if (rng() < (cfg.inconclusiveRate ?? 0)) return { status: 'INCONCLUSIVE', reason: 'SIM_TIMEOUT', providerAttemptId };

    const now = Date.now();
    const span = Math.max(0, cfg.maxDelaySeconds - cfg.minDelaySeconds);
    const resultAt = new Date(now + (cfg.minDelaySeconds + rng() * span) * 1000);
    if (connection.channel_type !== 'VOICE') {
      const deliveredAt = new Date(now + Math.min(1000, (resultAt.getTime() - now) / 2));
      await scheduleSimEvent(c, connection.id, buildEvent(providerAttemptId, 'DELIVERY_CONFIRMED', undefined, deliveredAt), deliveredAt);
    }
    if (rng() >= cfg.noReturnRate) {
      const outcome = pickOutcome(cfg.outcomes);
      const ev =
        outcome === 'OPT_OUT'
          ? buildEvent(providerAttemptId, 'OPT_OUT', 'OPT_OUT', resultAt)
          : outcome === 'RESULT_UNKNOWN'
            ? buildEvent(providerAttemptId, 'RESULT_UNKNOWN', undefined, resultAt)
            : buildEvent(providerAttemptId, 'RESULT', outcome, resultAt);
      await scheduleSimEvent(c, connection.id, ev, resultAt);
      if (rng() < cfg.duplicateRate) {
        // provedor reentrega o mesmo evento (mesmo eventId) — o webhook deve ignorar (AC04)
        await scheduleSimEvent(c, connection.id, ev, new Date(resultAt.getTime() + 1500));
      }
    }
    return { status: 'ACCEPTED', providerAttemptId };
  },
};

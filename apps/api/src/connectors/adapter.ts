/**
 * Contrato do conector (§11). Cada provedor converte seu formato para o contrato normalizado.
 * `send` roda dentro da transação do dispatch: um adaptador real deve ser rápido (timeout curto) e
 * devolver INCONCLUSIVE quando não souber se o envio foi aceito — nunca reenviar por conta própria.
 */
import type { ChannelType } from '@voll/shared';
import type { Client } from '../db/pool.js';
import { simulatedAdapter } from './simulated.js';

export type SendInput = {
  attempt: { id: string; destination_address: string; channel_type: ChannelType; trace_id: string };
  connection: { id: string; provider: string; config: any; channel_type: ChannelType };
};

export type SendResult =
  | { status: 'ACCEPTED'; providerAttemptId: string }
  | { status: 'REJECTED'; reason: string }
  | { status: 'INCONCLUSIVE'; reason: string; providerAttemptId?: string };

/** Indisponibilidade transitória: o worker reagenda com backoff; não é um novo acionamento. */
export class TransientConnectorError extends Error {}

export type ConnectorAdapter = {
  capabilities: { statusQuery: boolean; cancel: boolean; asyncResults: boolean; maxBatch: number };
  send(c: Client, input: SendInput): Promise<SendResult>;
};

const registry: Record<string, ConnectorAdapter> = {
  SIMULATED: simulatedAdapter,
};

export function getAdapter(provider: string): ConnectorAdapter {
  const a = registry[provider];
  if (!a) throw new Error(`conector sem adaptador: ${provider}`);
  return a;
}

/** Permite registrar adaptadores (e mocks em testes). */
export function registerAdapter(provider: string, adapter: ConnectorAdapter) {
  registry[provider] = adapter;
}

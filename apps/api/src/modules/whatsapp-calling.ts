/**
 * WhatsApp Business Calling receptivo via Meta Cloud API (canal WebRTC).
 * - GET /webhooks/whatsapp-calling/:connectionId : desafio de verificação Meta
 * - POST /webhooks/whatsapp-calling/:connectionId : webhook assinado X-Hub-Signature-256 (connect/terminate)
 * - POST /internal/webrtc/:callId/ended : callback interno autenticado do voice-gateway para encerrar na Meta
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { InternalWebRtcEndedSchema } from '@voll/shared';
import { config } from '../config.js';
import { getPool, one } from '../db/pool.js';
import { HttpError, parse } from '../lib/problem.js';
import {
  jsonInit,
  proxyJson,
  PUBLIC_WEBRTC_LONG_TIMEOUT_MS,
  resolveInboundVoiceRouting,
} from './telephony.js';

const META_GRAPH_VERSION = 'v21.0';
const enc = encodeURIComponent;

function timingSafeTextEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyMetaHubSignature(rawBody: string, headerValue: unknown, appSecret: string): boolean {
  if (typeof headerValue !== 'string' || !headerValue.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return timingSafeTextEqual(expected, headerValue.trim());
}

async function sendMetaCallAction(
  phoneNumberId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${enc(phoneNumberId)}/calls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(502, 'Falha na Graph API WhatsApp Calling', `HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
}

function buildInternalEndedBaseUrl(req: any): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}/api/internal/webrtc`;
}

function extractMetaCallEvents(body: any): any[] {
  const out: any[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== 'calls') continue;
      const val = change?.value ?? {};
      if (Array.isArray(val.calls)) {
        out.push(...val.calls);
      } else if (val.call_id || val.id || val.event) {
        out.push(val);
      }
    }
  }
  return out;
}

export async function whatsappCallingRoutes(app: FastifyInstance) {
  app.get<{
    Params: { connectionId: string };
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>('/webhooks/whatsapp-calling/:connectionId', async (req, reply) => {
    const conn = await one<{ id: string; config: any }>(
      getPool(),
      `SELECT id, config FROM connections WHERE id = $1 AND channel_type = 'WEBRTC'::channel_type`,
      [req.params.connectionId],
    ).catch(() => null);
    if (!conn) throw new HttpError(404, 'Canal WebRTC não encontrado');

    const mode = req.query['hub.mode'];
    const token = String(req.query['hub.verify_token'] ?? '');
    const challenge = String(req.query['hub.challenge'] ?? '');
    const configuredToken = String(conn.config?.whatsappVerifyToken ?? '');

    if (mode !== 'subscribe' || !configuredToken || !timingSafeTextEqual(configuredToken, token)) {
      throw new HttpError(403, 'Verify token inválido', 'O hub.verify_token informado não confere com este canal.');
    }
    return reply.type('text/plain').send(challenge);
  });

  app.post<{ Params: { connectionId: string } }>('/webhooks/whatsapp-calling/:connectionId', async (req) => {
    const conn = await one<{ id: string; workspace_id: string; active: boolean; config: any }>(
      getPool(),
      `SELECT id, workspace_id, active, config
         FROM connections
        WHERE id = $1 AND channel_type = 'WEBRTC'::channel_type`,
      [req.params.connectionId],
    ).catch(() => null);
    if (!conn) throw new HttpError(404, 'Canal WebRTC não encontrado');

    const appSecret = String(conn.config?.whatsappAppSecret ?? '').trim();
    if (!appSecret) {
      throw new HttpError(401, 'Webhook sem assinatura configurada', 'Configure o Meta App Secret neste canal WebRTC.');
    }
    const rawBody = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    if (!verifyMetaHubSignature(rawBody, req.headers['x-hub-signature-256'], appSecret)) {
      throw new HttpError(401, 'Assinatura Meta inválida', 'X-Hub-Signature-256 ausente ou incorreto.');
    }

    if (!conn.active) {
      throw new HttpError(403, 'Canal WebRTC inativo', 'Este canal WebRTC está desabilitado.');
    }
    const mode = conn.config?.webrtcMode ?? 'BOTH';
    if (mode !== 'WHATSAPP_CALLING' && mode !== 'BOTH') {
      throw new HttpError(403, 'WhatsApp Calling desabilitado', 'Este canal está configurado apenas para Web Widget.');
    }

    const phoneNumberId = String(conn.config?.whatsappPhoneNumberId ?? '').trim();
    const accessToken = String(conn.config?.whatsappAccessToken ?? '').trim();
    if (!phoneNumberId || !accessToken) {
      throw new HttpError(422, 'Credenciais WhatsApp incompletas', 'Configure Phone Number ID e Access Token neste canal.');
    }

    const events = extractMetaCallEvents(req.body);
    let processed = 0;
    let duplicates = 0;
    const endedCallbackBaseUrl = buildInternalEndedBaseUrl(req);

    for (const ev of events) {
      const whatsappCallId = String(ev.id || ev.call_id || '').trim();
      const eventType = String(ev.event || '').trim().toLowerCase();
      if (!whatsappCallId) continue;

      if (eventType === 'connect') {
        const sdpOffer = String(ev.session?.sdp || '').trim();
        if (!sdpOffer) continue;

        const routing = await resolveInboundVoiceRouting({
          workspaceId: conn.workspace_id,
          channelType: 'WEBRTC',
          connectionId: conn.id,
          did: phoneNumberId,
          callerId: ev.from ? String(ev.from) : '',
          channelDefaultTenantId: conn.config?.tenantId,
        });
        if (!routing.tenantId) {
          throw new HttpError(
            422,
            'Agente de voz pendente',
            'Vincule um agente de voz ativo ao canal WebRTC antes de receber chamadas WhatsApp.',
          );
        }

        const inserted = await one<{ whatsapp_call_id: string }>(
          getPool(),
          `INSERT INTO whatsapp_calling_sessions (whatsapp_call_id, workspace_id, connection_id, gateway_call_id, caller_phone, status)
           VALUES ($1, $2, $3, 'pending', $4, 'CONNECTING')
           ON CONFLICT (whatsapp_call_id) DO NOTHING
           RETURNING whatsapp_call_id`,
          [whatsappCallId, conn.workspace_id, conn.id, ev.from ? String(ev.from) : null],
        );
        if (!inserted) {
          duplicates++;
          continue;
        }

        let gwCallId = '';
        try {
          const gwRes = await proxyJson(
            conn.workspace_id,
            '/v1/webrtc/offer',
            jsonInit('POST', {
              tenantId: routing.tenantId,
              sdpOffer,
              caller: ev.from ? String(ev.from) : 'whatsapp-caller',
              metadata: {
                source: 'whatsapp_calling',
                connectionId: conn.id,
                workspaceId: conn.workspace_id,
                whatsappCallId,
                callerPhone: ev.from ? String(ev.from) : null,
                agentSource: routing.source,
                ...(routing.matchedRule?.id ? { routeId: routing.matchedRule.id } : {}),
                ...(endedCallbackBaseUrl ? { endedCallbackBaseUrl } : {}),
              },
            }),
            PUBLIC_WEBRTC_LONG_TIMEOUT_MS,
          );
          gwCallId = String(gwRes?.callId ?? '');
          await getPool().query(
            `UPDATE whatsapp_calling_sessions SET gateway_call_id = $2 WHERE whatsapp_call_id = $1`,
            [whatsappCallId, gwCallId || 'unknown'],
          );

          await sendMetaCallAction(phoneNumberId, accessToken, {
            messaging_product: 'whatsapp',
            call_id: whatsappCallId,
            action: 'accept',
            session: { sdp_type: 'answer', sdp: gwRes.sdpAnswer },
          });

          await getPool().query(
            `UPDATE whatsapp_calling_sessions SET status = 'ACTIVE' WHERE whatsapp_call_id = $1`,
            [whatsappCallId],
          );
          processed++;
        } catch (err) {
          if (gwCallId) {
            await proxyJson(conn.workspace_id, `/v1/webrtc/${enc(gwCallId)}`, { method: 'DELETE' }).catch(() => {});
          }
          await getPool().query(
            `UPDATE whatsapp_calling_sessions SET status = 'FAILED', ended_at = now() WHERE whatsapp_call_id = $1`,
            [whatsappCallId],
          );
          throw err;
        }
      } else if (eventType === 'terminate') {
        const existing = await one<{ gateway_call_id: string; status: string }>(
          getPool(),
          `SELECT gateway_call_id, status FROM whatsapp_calling_sessions WHERE whatsapp_call_id = $1`,
          [whatsappCallId],
        );
        if (existing && existing.status !== 'ENDED') {
          await getPool().query(
            `UPDATE whatsapp_calling_sessions SET status = 'ENDED', ended_at = now() WHERE whatsapp_call_id = $1`,
            [whatsappCallId],
          );
          if (existing.gateway_call_id && existing.gateway_call_id !== 'pending') {
            await proxyJson(conn.workspace_id, `/v1/webrtc/${enc(existing.gateway_call_id)}`, { method: 'DELETE' }).catch(
              () => {},
            );
          }
          processed++;
        }
      }
    }

    return { accepted: true, processed, duplicates };
  });

  app.post<{ Params: { callId: string } }>('/internal/webrtc/:callId/ended', async (req) => {
    const expectedToken = String(process.env.VOICE_APP_TOKEN || process.env.API_AUTH_TOKEN || '').trim();
    if (expectedToken || config.isProduction) {
      const authHeader = String(req.headers.authorization || '').trim();
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!expectedToken || !bearer || !timingSafeTextEqual(expectedToken, bearer)) {
        throw new HttpError(401, 'Token interno inválido', 'Autenticação Bearer inválida para callback do gateway.');
      }
    }

    parse(InternalWebRtcEndedSchema, req.body ?? {});

    const session = await one<{
      whatsapp_call_id: string;
      status: string;
      config: any;
    }>(
      getPool(),
      `SELECT s.whatsapp_call_id, s.status, c.config
         FROM whatsapp_calling_sessions s
         JOIN connections c ON c.id = s.connection_id
        WHERE s.gateway_call_id = $1
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [req.params.callId],
    );
    if (!session) {
      return { ok: true, found: false };
    }

    if (session.status !== 'ENDED') {
      await getPool().query(
        `UPDATE whatsapp_calling_sessions SET status = 'ENDED', ended_at = now() WHERE whatsapp_call_id = $1`,
        [session.whatsapp_call_id],
      );
      const phoneNumberId = String(session.config?.whatsappPhoneNumberId ?? '').trim();
      const accessToken = String(session.config?.whatsappAccessToken ?? '').trim();
      if (phoneNumberId && accessToken) {
        await sendMetaCallAction(phoneNumberId, accessToken, {
          messaging_product: 'whatsapp',
          call_id: session.whatsapp_call_id,
          action: 'terminate',
        }).catch(() => {});
      }
    }
    return { ok: true, found: true, whatsappCallId: session.whatsapp_call_id };
  });
}

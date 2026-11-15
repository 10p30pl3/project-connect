'use strict';

/**
 * Executor HTTP seguro de Custom Tools configuradas no agente de voz.
 * Inclui bloqueio SSRF para endereços privados salvo VOLL_ALLOW_INTERNAL_TOOLS=true.
 */

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254', 'metadata.google.internal'];

function isPrivateIp(host) {
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^fc00:|^fd00:|^fe80:/i.test(host)) return true;
  return false;
}

function assertSafeToolUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Protocolo de tool inválido (use http ou https)');
  }
  const allowInternal = process.env.VOLL_ALLOW_INTERNAL_TOOLS === 'true';
  if (!allowInternal) {
    const h = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(h) || isPrivateIp(h)) {
      throw new Error(`Destino interno bloqueado pela política SSRF (${h})`);
    }
  }
  return parsed;
}

async function executeCustomTool(toolDef, args = {}, context = {}) {
  const start = Date.now();
  const parsed = assertSafeToolUrl(toolDef.url);
  const method = String(toolDef.method || 'POST').toUpperCase();
  const timeoutMs = Math.max(500, Math.min(10000, Number(toolDef.timeoutMs || 4000)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let targetUrl = parsed.toString();
    const fetchInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Voll-Call-Id': String(context.callId || ''),
        ...(toolDef.headers || {}),
      },
      signal: controller.signal,
    };

    if (method === 'GET') {
      const urlObj = new URL(targetUrl);
      for (const [k, v] of Object.entries(args || {})) {
        urlObj.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      targetUrl = urlObj.toString();
    } else {
      fetchInit.body = JSON.stringify({ args, context });
    }

    const res = await fetch(targetUrl, fetchInit);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs: Date.now() - start,
      data,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - start,
      error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { executeCustomTool, assertSafeToolUrl };

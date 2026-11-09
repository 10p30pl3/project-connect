const path = require('path');
const { readJsonList, writeJsonList } = require('./json-store');

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

function render(tpl, vars) {
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** JSON-safe: escapa o valor para dentro de string JSON do template */
function renderJson(tpl, vars) {
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return JSON.stringify(v === undefined || v === null ? '' : String(v)).slice(1, -1);
  });
}

/**
 * Provedores de canal: 'sip' (agrupa troncos), 'sms' e 'whatsapp' via API HTTP genérica
 * (url + headers + bodyTemplate com {{to}}, {{from}}, {{message}} e variáveis do destinatário).
 */
class ProviderManager {
  constructor(file = null) {
    this.file = file || path.join(__dirname, '..', 'config', 'providers.json');
    this.providers = new Map();
    for (const p of readJsonList(this.file)) if (p && p.id) this.providers.set(p.id, p);
    if (!this.providers.has('directcall')) {
      this.providers.set('directcall', { id: 'directcall', name: 'DirectCall', type: 'sip', vendor: 'directcall', active: true });
      this.persist();
    }
  }

  persist() {
    writeJsonList(this.file, [...this.providers.values()]);
  }

  mask(p) {
    const headers = {};
    for (const k of Object.keys(p.http?.headers || {})) headers[k] = '********';
    return p.http ? { ...p, http: { ...p.http, headers } } : { ...p };
  }

  list() {
    return [...this.providers.values()].map((p) => this.mask(p));
  }

  get(id) {
    return this.providers.get(id) || null;
  }

  upsert(data) {
    if (!ID_RE.test(data?.id || '')) throw new Error('"id" inválido (2-40: a-z, 0-9, _ ou -)');
    if (!['sip', 'sms', 'whatsapp'].includes(data.type)) throw new Error('"type" deve ser sip, sms ou whatsapp');
    const existing = this.providers.get(data.id);
    const merged = { active: true, vendor: 'custom', ...(existing || {}), ...data };
    if (merged.type !== 'sip') {
      const h = merged.http || {};
      if (!/^https?:\/\//i.test(h.url || '')) throw new Error('http.url deve começar com http(s)://');
      // mantém headers antigos quando o painel reenvia valores mascarados
      const oldHeaders = existing?.http?.headers || {};
      const headers = { ...(h.headers || {}) };
      for (const k of Object.keys(headers)) if (headers[k] === '********') headers[k] = oldHeaders[k] || '';
      merged.http = {
        method: 'POST',
        bodyTemplate: '{"to":"{{to}}","from":"{{from}}","message":"{{message}}"}',
        ...h,
        headers
      };
    }
    this.providers.set(merged.id, merged);
    this.persist();
    return this.mask(merged);
  }

  remove(id) {
    if (id === 'directcall') throw new Error('Provedor padrão não pode ser removido');
    const ok = this.providers.delete(id);
    if (ok) this.persist();
    return ok;
  }

  /** Envia uma mensagem (sms/whatsapp) por chamada à API HTTP do provedor */
  async send(providerId, { to, from, message, vars = {} }) {
    const p = this.providers.get(providerId);
    if (!p || !p.active) throw new Error(`Provedor indisponível: ${providerId}`);
    if (p.type === 'sip') throw new Error('Provedor SIP não envia mensagens');
    const h = p.http;
    const all = { ...vars, to, from: from || p.http.from || '', message: render(message || '', vars) };
    const headers = {};
    for (const [k, v] of Object.entries(h.headers || {})) headers[k] = render(v, all);
    const isForm = /x-www-form-urlencoded/i.test(headers['Content-Type'] || headers['content-type'] || '');
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    let body;
    if (isForm) {
      body = render(h.bodyTemplate, Object.fromEntries(Object.entries(all).map(([k, v]) => [k, encodeURIComponent(v)])));
    } else {
      body = renderJson(h.bodyTemplate, all);
    }
    const method = (h.method || 'POST').toUpperCase();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(render(h.url, Object.fromEntries(Object.entries(all).map(([k, v]) => [k, encodeURIComponent(v)]))), {
        method,
        headers,
        body: method === 'GET' ? undefined : body,
        signal: ctrl.signal
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return { ok: true, status: resp.status, response: text.slice(0, 500) };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = new ProviderManager();
module.exports.ProviderManager = ProviderManager;

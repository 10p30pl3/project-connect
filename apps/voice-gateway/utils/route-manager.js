const path = require('path');
const { readJsonList, writeJsonList } = require('./json-store');

function norm(v) {
  return String(v || '').replace(/^sip:/, '').replace(/@.*$/, '').replace(/^\+/, '').trim();
}

/** Padrões: "*" (qualquer), exato, prefixo "5511*", ou regex "re:^55(11|21)" */
function matchPattern(pattern, value) {
  const p = String(pattern || '*').trim();
  const v = norm(value);
  if (p === '*' || p === '') return true;
  if (p.startsWith('re:')) {
    try {
      return new RegExp(p.slice(3)).test(v);
    } catch {
      return false;
    }
  }
  const pn = p.replace(/^\+/, '');
  if (pn.endsWith('*')) return v.startsWith(pn.slice(0, -1));
  return v === pn;
}

/**
 * Regras de roteamento de entrada: Tronco + DID + Caller ID -> Agente (Tenant) + políticas.
 * Primeira regra ativa que casar (menor prioridade primeiro) vence.
 */
class RouteManager {
  constructor(file = null) {
    this.file = file || path.join(__dirname, '..', 'config', 'routes.json');
    this.routes = readJsonList(this.file);
    this.activeByRule = new Map();
  }

  persist() {
    writeJsonList(this.file, this.routes);
  }

  list() {
    return [...this.routes]
      .sort((a, b) => a.priority - b.priority)
      .map((r) => ({ ...r, usedChannels: this.activeByRule.get(r.id) || 0 }));
  }

  get(id) {
    return this.routes.find((r) => r.id === id) || null;
  }

  upsert(data, tenantManager) {
    if (!data || !data.tenantId) throw new Error('"tenantId" (agente de destino) é obrigatório');
    if (tenantManager && !tenantManager.tenants.has(data.tenantId)) {
      throw new Error(`Agente/tenant inexistente: ${data.tenantId}`);
    }
    if (data.didPattern && String(data.didPattern).startsWith('re:')) {
      try {
        new RegExp(String(data.didPattern).slice(3));
      } catch {
        throw new Error('Regex do DID inválida');
      }
    }
    const idx = data.id ? this.routes.findIndex((r) => r.id === data.id) : -1;
    const base = idx >= 0 ? this.routes[idx] : null;
    const maxPriority = this.routes.reduce((m, r) => Math.max(m, r.priority), 0);
    const rule = {
      name: 'Regra',
      trunkId: '*',
      didPattern: '*',
      callerPattern: '*',
      amdMode: 'tenant_default',
      bargeinGraceSec: null,
      recordingEnabled: 'tenant_default',
      crosstalkFilterMode: 'tenant_default',
      maxChannels: null,
      active: true,
      ...(base || {}),
      ...data,
      id: base?.id || data.id || `r-${Date.now().toString(36)}`,
      priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : base?.priority ?? maxPriority + 10
    };
    rule.maxChannels = rule.maxChannels ? Math.max(1, parseInt(rule.maxChannels, 10)) : null;
    rule.active = rule.active !== false;
    if (idx >= 0) this.routes[idx] = rule;
    else this.routes.push(rule);
    this.persist();
    return rule;
  }

  remove(id) {
    const n = this.routes.length;
    this.routes = this.routes.filter((r) => r.id !== id);
    if (this.routes.length !== n) this.persist();
    return this.routes.length !== n;
  }

  reorder(ids) {
    ids.forEach((id, i) => {
      const r = this.get(id);
      if (r) r.priority = (i + 1) * 10;
    });
    this.persist();
  }

  match({ did, callerId, trunkId }) {
    const trace = [];
    for (const r of [...this.routes].sort((a, b) => a.priority - b.priority)) {
      if (!r.active) {
        trace.push({ rule: r.id, name: r.name, matched: false, reason: 'inativa' });
        continue;
      }
      const okTrunk = r.trunkId === '*' || !r.trunkId || r.trunkId === trunkId;
      const okDid = matchPattern(r.didPattern, did);
      const okCaller = matchPattern(r.callerPattern, callerId);
      const matched = okTrunk && okDid && okCaller;
      trace.push({
        rule: r.id,
        name: r.name,
        matched,
        reason: matched ? 'casou' : `não casou (${[!okTrunk && 'tronco', !okDid && 'DID', !okCaller && 'caller'].filter(Boolean).join(', ')})`
      });
      if (matched) return { rule: r, trace };
    }
    return { rule: null, trace };
  }

  /** Simulação sem efeitos colaterais (dry-run) */
  simulate({ did, callerId, trunkId }, tenantManager) {
    const { rule, trace } = this.match({ did, callerId, trunkId });
    let tenant = null;
    let source = 'rule';
    if (rule) {
      tenant = tenantManager.tenants.get(rule.tenantId) || null;
    } else {
      source = 'tenant_did_fallback';
      const fake = { calledNumber: norm(did), get: () => null };
      tenant = tenantManager.resolveTenant(fake);
    }
    return {
      matchedRule: rule,
      source,
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            active: tenant.active,
            voice: tenant.voice,
            model: tenant.openaiModel,
            promptId: tenant.openaiPromptId,
            instructions: String(tenant.instructions || '').slice(0, 200),
            maxConcurrentCalls: tenant.maxConcurrentCalls,
            maxCallsPerSecond: tenant.maxCallsPerSecond
          }
        : null,
      effective: tenant ? this.effectivePolicy(rule, tenant) : null,
      accepted: Boolean(tenant && tenant.active),
      trace
    };
  }

  effectivePolicy(rule, tenant) {
    const amdMode = rule?.amdMode || 'tenant_default';
    return {
      amdEnabled: amdMode === 'tenant_default' ? Boolean(tenant.amd?.enabled) : amdMode === 'active',
      bargeinGraceSec: rule?.bargeinGraceSec ?? tenant.bargeinGraceSec,
      recording: rule?.recordingEnabled ?? 'tenant_default',
      crosstalkMode: rule?.crosstalkFilterMode || tenant.crosstalkFilter?.mode,
      maxChannels: Math.min(rule?.maxChannels || Infinity, tenant.maxConcurrentCalls || 200)
    };
  }

  /**
   * Resolve a rota de uma chamada real. Sem regra casada, mantém o comportamento legado (DID do tenant).
   */
  resolveRoute(req, tenantManager, trunkId = null) {
    const did = req.calledNumber || tenantManager.extractCalledNumber(req);
    const callerId = req.callingNumber || '';
    const headerTenant = req.get && (req.get('x-tenant-id') || req.get('X-Tenant-ID'));
    if (!headerTenant) {
      const { rule } = this.match({ did, callerId, trunkId });
      if (rule) {
        const tenant = tenantManager.tenants.get(rule.tenantId) || null;
        if (tenant) {
          const policy = this.effectivePolicy(rule, tenant);
          const t = { ...tenant };
          if (rule.amdMode && rule.amdMode !== 'tenant_default') {
            t.amd = { ...t.amd, enabled: rule.amdMode === 'active' };
          }
          if (rule.bargeinGraceSec !== null && rule.bargeinGraceSec !== undefined && rule.bargeinGraceSec !== '') {
            t.bargeinGraceSec = Number(rule.bargeinGraceSec);
          }
          if (rule.crosstalkFilterMode) {
            t.crosstalkFilter = { ...t.crosstalkFilter, mode: rule.crosstalkFilterMode };
          }
          return { tenant: t, rule, policy, trunkId };
        }
      }
    }
    return { tenant: tenantManager.resolveTenant(req), rule: null, policy: null, trunkId };
  }

  tryAcquire(rule) {
    if (!rule?.maxChannels) return true;
    const cur = this.activeByRule.get(rule.id) || 0;
    if (cur >= rule.maxChannels) return false;
    this.activeByRule.set(rule.id, cur + 1);
    return true;
  }

  release(rule) {
    if (!rule?.maxChannels) return;
    const cur = this.activeByRule.get(rule.id) || 0;
    if (cur <= 1) this.activeByRule.delete(rule.id);
    else this.activeByRule.set(rule.id, cur - 1);
  }
}

module.exports = new RouteManager();
module.exports.RouteManager = RouteManager;
module.exports.matchPattern = matchPattern;

const path = require('path');
const { readJsonList, writeJsonList } = require('./json-store');

const PROFILE = process.env.FREESWITCH_SIP_PROFILE || 'drachtio_mrf';
const GATEWAY_DIR = process.env.FREESWITCH_GATEWAY_DIR || '/usr/local/freeswitch/conf/sip_profiles/mrf';
const PROFILE_FILE = process.env.FREESWITCH_PROFILE_FILE || '/usr/local/freeswitch/conf/sip_profiles/mrf.xml';
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const HOST_RE = /^[A-Za-z0-9._-]+$/;

function escXml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}

/**
 * Gerencia troncos SIP (gateways Sofia) no FreeSWITCH via ESL.
 * Troncos `external` (ex.: directcall definido em mrf.xml) são apenas monitorados.
 */
function resolveMaxChannels(trunk) {
  const n = Number(trunk?.maxChannels);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

class TrunkManager {
  constructor(file = null) {
    this.file = file || path.join(__dirname, '..', 'config', 'sip-trunks.json');
    this.fsPool = null;
    this.trunks = new Map();
    this.activeCalls = new Map(); // trunkId -> n
    this._statusCache = new Map(); // trunkId -> { data, ts }
    this._statusCacheTtlMs = Number(process.env.TRUNK_STATUS_CACHE_MS || 3000);
    for (const t of readJsonList(this.file)) {
      if (t && t.id) this.trunks.set(t.id, t);
    }
    if (!this.trunks.has('directcall')) {
      this.trunks.set('directcall', {
        id: 'directcall',
        name: 'DirectCall',
        providerId: 'directcall',
        direction: 'both',
        realm: 'sip1.directdial.com.br',
        proxy: 'sip1.directdial.com.br',
        username: process.env.DIRECTCALL_USERNAME || 'WTVNM',
        password: process.env.DIRECTCALL_PASSWORD || undefined,
        register: Boolean(process.env.DIRECTCALL_REGISTER === 'true'),
        maxChannels: 30,
        active: true,
        external: false
      });
      this.persist();
    }
  }

  attach(fsPool) {
    this.fsPool = fsPool;
  }

  persist() {
    writeJsonList(this.file, [...this.trunks.values()]);
  }

  // ---- ESL ----
  _nodes() {
    return (this.fsPool?.nodes || []).filter((n) => n.ready && n.mediaserver);
  }

  async _api(cmd, node = null) {
    const n = node || this._nodes()[0];
    if (!n) throw new Error('Nenhum nó FreeSWITCH disponível');
    const body = await Promise.race([
      n.mediaserver.api(cmd),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ESL: ${cmd}`)), 8000))
    ]);
    return String(body || '');
  }

  async _apiAll(cmd) {
    const out = [];
    for (const n of this._nodes()) out.push(await this._api(cmd, n));
    return out;
  }

  validate(data) {
    if (!data || !ID_RE.test(data.id || '')) {
      throw new Error('"id" inválido (use 2-40 caracteres: a-z, 0-9, _ ou -)');
    }
    const host = data.proxy || data.realm;
    if (!host || !HOST_RE.test(host.replace(/:\d+$/, ''))) {
      throw new Error('"proxy"/"realm" inválido');
    }
    const port = data.port !== undefined && data.port !== '' ? Number(data.port) : 5060;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('"port" inválida');
    if (data.register && (!data.username || !data.password)) {
      // senha pode ser mantida do cadastro anterior; validado em upsert
    }
  }

  buildXml(t) {
    const host = t.proxy || t.realm;
    const port = Number(t.port || 5060);
    const hostPort = port === 5060 ? host : `${host}:${port}`;
    const p = [];
    const add = (n, v) => p.push(`    <param name="${n}" value="${escXml(v)}"/>`);
    if (t.register) {
      add('username', t.username);
      add('password', t.password);
      add('from-user', t.fromUser || t.username);
      add('from-domain', t.fromDomain || t.realm || host);
      add('realm', t.realm || host);
      add('register', 'true');
      add('expire-seconds', t.expireSeconds || 600);
      add('retry-seconds', 30);
    } else {
      add('username', t.username || 'none');
      add('password', t.password || (t.id === 'directcall' ? process.env.DIRECTCALL_PASSWORD : null) || 'none');
      add('realm', t.realm || host);
      add('register', 'false');
    }
    add('proxy', hostPort);
    add('caller-id-in-from', t.callerIdInFrom === false ? 'false' : 'true');
    // Troncos IP-auth (register=false) não devem forçar OPTIONS ping por padrão, pois operadoras
    // que ignoram OPTIONS fazem o FreeSWITCH marcar status=DOWN mesmo com o tronco operacional.
    const pingFreq = Number(t.pingFreq);
    if (Number.isFinite(pingFreq) && pingFreq > 0) {
      add('ping', pingFreq);
    } else if (t.register && pingFreq !== 0) {
      add('ping', 25);
    }
    if (t.codecs) add('codec-prefs', t.codecs);
    return `<include>\n  <gateway name="${escXml(t.id)}">\n${p.join('\n')}\n  </gateway>\n</include>\n`;
  }

  async ensureInclude() {
    // Idempotente: garante que mrf.xml inclua mrf/*.xml dentro de <gateways>
    const cmd =
      `system grep -q 'mrf/\\*.xml' ${PROFILE_FILE} || ` +
      `sed -i 's|</profile>|    <gateways>\\n      <X-PRE-PROCESS cmd=\\"include\\" data=\\"mrf/*.xml\\"/>\\n    </gateways>\\n  </profile>|' ${PROFILE_FILE}`;
    await this._apiAll(cmd);
  }

  async _writeFile(t) {
    const b64 = Buffer.from(this.buildXml(t)).toString('base64');
    await this._apiAll(`system mkdir -p ${GATEWAY_DIR} && echo ${b64} | base64 -d > ${GATEWAY_DIR}/${t.id}.xml`);
  }

  async _removeFile(id) {
    await this._apiAll(`system rm -f ${GATEWAY_DIR}/${id}.xml`);
  }

  async _reload() {
    await this._apiAll('reloadxml');
    await this._apiAll(`sofia profile ${PROFILE} rescan`);
  }

  /** Aplica todos os troncos ativos no FreeSWITCH (usado no boot e após reconexão do nó) */
  async syncAll() {
    if (!this._nodes().length) return { ok: false, reason: 'sem nó FreeSWITCH' };
    await this.ensureInclude();
    for (const t of this.trunks.values()) {
      if (t.external) continue;
      if (t.active) await this._writeFile(t);
      else await this._removeFile(t.id);
      await this._apiAll(`sofia profile ${PROFILE} killgw ${t.id}`).catch(() => {});
    }
    await this._reload();
    return { ok: true };
  }

  async _apply(t) {
    await this.ensureInclude();
    if (t.active) {
      await this._writeFile(t);
      await this._apiAll(`sofia profile ${PROFILE} killgw ${t.id}`).catch(() => {});
    } else {
      await this._removeFile(t.id);
      await this._apiAll(`sofia profile ${PROFILE} killgw ${t.id}`).catch(() => {});
    }
    await this._reload();
  }

  // ---- CRUD ----
  list() {
    return [...this.trunks.values()].map((t) => this.mask(t));
  }

  mask(t) {
    const { password, ...rest } = t;
    const maxChannels = resolveMaxChannels(t);
    const activeCalls = this.activeCalls.get(t.id) || 0;
    return {
      ...rest,
      maxChannels,
      hasPassword: Boolean(password),
      usedChannels: activeCalls,
      activeCalls,
      availableChannels: t.active === false || t.direction === 'inbound' ? 0 : Math.max(0, maxChannels - activeCalls),
    };
  }

  invalidateStatusCache(id = null) {
    if (id) this._statusCache.delete(id);
    else this._statusCache.clear();
  }

  get(id) {
    const t = this.trunks.get(id);
    return t ? this.mask(t) : null;
  }

  async upsert(data) {
    const existing = this.trunks.get(data.id);
    if (existing?.external) throw new Error('Tronco externo (definido em mrf.xml) é somente leitura');
    const merged = {
      direction: 'both',
      active: true,
      register: false,
      maxChannels: existing?.maxChannels ?? 1,
      ...(existing || {}),
      ...data
    };
    if (!data.password && existing?.password) merged.password = existing.password;
    if (merged.register && (!merged.username || !merged.password)) {
      throw new Error('Registro SIP exige usuário e senha');
    }
    this.validate(merged);
    merged.maxChannels = resolveMaxChannels(merged);
    merged.active = merged.active !== false;
    this.trunks.set(merged.id, merged);
    this.invalidateStatusCache(merged.id);
    this.persist();
    await this._apply(merged);
    return this.mask(merged);
  }

  async remove(id) {
    const t = this.trunks.get(id);
    if (!t) return false;
    if (t.external) throw new Error('Tronco externo (definido em mrf.xml) não pode ser removido pelo painel');
    this.trunks.delete(id);
    this.invalidateStatusCache(id);
    this.persist();
    await this._removeFile(id);
    await this._apiAll(`sofia profile ${PROFILE} killgw ${id}`).catch(() => {});
    await this._reload();
    return true;
  }

  async toggle(id, active) {
    const t = this.trunks.get(id);
    if (!t) return null;
    if (t.external) throw new Error('Tronco externo não pode ser pausado pelo painel');
    t.active = active === undefined ? !t.active : Boolean(active);
    this.invalidateStatusCache(id);
    this.persist();
    await this._apply(t);
    return this.mask(t);
  }

  /** Re-registra o gateway e devolve o status */
  async reconnect(id) {
    const t = this.trunks.get(id);
    if (!t) return null;
    this.invalidateStatusCache(id);
    await this._apiAll(`sofia profile ${PROFILE} killgw ${id}`).catch(() => {});
    await this._reload();
    await new Promise((r) => setTimeout(r, 2500));
    return this.status(id);
  }

  // ---- Status ----
  async status(id, { useCache = false } = {}) {
    const t = this.trunks.get(id);
    if (!t) return null;
    if (!t.active) return { id, state: 'PAUSED', status: 'DOWN', message: 'Tronco pausado' };
    if (useCache) {
      const cached = this._statusCache.get(id);
      if (cached && Date.now() - cached.ts < this._statusCacheTtlMs) {
        return cached.data;
      }
    }
    try {
      const xml = await this._api(`sofia xmlstatus gateway ${id}`);
      const res = !xml.includes('<gateway>')
        ? { id, state: 'NOT_LOADED', status: 'DOWN', message: 'Gateway não carregado no FreeSWITCH' }
        : {
            id,
            state: tag(xml, 'state'),
            status: tag(xml, 'status'),
            pingTimeMs: parseFloat(tag(xml, 'pingtime') || '0'),
            pingFreq: parseInt(tag(xml, 'pingfreq') || '0', 10),
            uptimeSec: Math.round(parseInt(tag(xml, 'uptime-usec') || '0', 10) / 1e6),
            callsIn: parseInt(tag(xml, 'calls-in') || '0', 10),
            callsOut: parseInt(tag(xml, 'calls-out') || '0', 10),
            failedCallsIn: parseInt(tag(xml, 'failed-calls-in') || '0', 10),
            failedCallsOut: parseInt(tag(xml, 'failed-calls-out') || '0', 10)
          };
      this._statusCache.set(id, { data: res, ts: Date.now() });
      return res;
    } catch (err) {
      const res = { id, state: 'UNKNOWN', status: 'DOWN', message: err.message };
      this._statusCache.set(id, { data: res, ts: Date.now() });
      return res;
    }
  }

  async statusAll(opts = {}) {
    const out = {};
    await Promise.all([...this.trunks.keys()].map(async (id) => (out[id] = await this.status(id, opts))));
    return out;
  }

  isTrunkOnline(t, liveStatus) {
    if (!t || t.active === false) return false;
    // Sem nenhum fsPool anexado (ex.: testes unitários isolados), considera tronco ativo como online
    if (!this.fsPool) return true;
    if (!liveStatus) return false;
    const state = String(liveStatus.state || '').toUpperCase();
    const st = String(liveStatus.status || '').toUpperCase();
    if (state === 'PAUSED' || state === 'NOT_LOADED' || state === 'UNKNOWN') return false;
    if (t.register) {
      if (st === 'DOWN') return false;
      return state === 'REGED' || st === 'UP';
    }
    // Tronco IP-auth (register=false) carregado em NOREG sem ping explícito é considerado operante
    if (state === 'NOREG' && !(Number(t.pingFreq) > 0)) return true;
    if (st === 'DOWN') return false;
    return st === 'UP' || state === 'NOREG' || state === 'REGED';
  }

  async getAvailability({ trunkIds = null, useCache = true } = {}) {
    const liveAll = await this.statusAll({ useCache });
    const allow = Array.isArray(trunkIds) && trunkIds.length > 0 ? new Set(trunkIds.map(String)) : null;
    const trunks = [];
    for (const t of this.trunks.values()) {
      if (allow && !allow.has(t.id)) continue;
      const live = liveAll[t.id] || null;
      const active = t.active !== false;
      const direction = t.direction || 'both';
      const isOutbound = direction === 'outbound' || direction === 'both';
      const maxChannels = resolveMaxChannels(t);
      const activeCalls = this.activeCalls.get(t.id) || 0;
      const online = this.isTrunkOnline(t, live);
      const availableChannels = active && isOutbound && online ? Math.max(0, maxChannels - activeCalls) : 0;
      trunks.push({
        id: t.id,
        name: t.name || t.id,
        direction,
        active,
        online,
        maxChannels,
        activeCalls,
        availableChannels,
        state: live?.state || null,
        status: live?.status || null,
        statusMessage: !active ? 'PAUSED' : (live?.message || live?.state || live?.status || null),
      });
    }
    const outbound = trunks.filter((t) => t.direction !== 'inbound');
    return {
      trunks,
      summary: {
        totalTrunks: trunks.length,
        onlineOutboundTrunks: outbound.filter((t) => t.active && t.online).length,
        totalChannels: outbound.filter((t) => t.active && t.online).reduce((s, t) => s + t.maxChannels, 0),
        activeCalls: outbound.reduce((s, t) => s + t.activeCalls, 0),
        availableChannels: outbound.reduce((s, t) => s + t.availableChannels, 0),
      },
    };
  }

  selectAvailableTrunk({ trunkIds = null, preferredTrunkId = null } = {}) {
    const hasFilter = Array.isArray(trunkIds) && trunkIds.length > 0;
    const allow = hasFilter ? trunkIds.map(String) : [...this.trunks.keys()];
    const ordered = preferredTrunkId && (!hasFilter || allow.includes(preferredTrunkId))
      ? [preferredTrunkId, ...allow.filter((id) => id !== preferredTrunkId)]
      : allow;

    const candidates = [];
    for (const id of ordered) {
      const t = this.trunks.get(id);
      if (!t || t.active === false || t.direction === 'inbound') continue;
      const cached = this._statusCache.get(id)?.data || null;
      if (this.fsPool && cached && !this.isTrunkOnline(t, cached)) continue;
      if (this.fsPool && !this._nodes().length) continue;
      const maxChannels = resolveMaxChannels(t);
      const cur = this.activeCalls.get(id) || 0;
      if (cur < maxChannels) {
        candidates.push({ id, ratio: cur / maxChannels, isPreferred: id === preferredTrunkId });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
      return a.ratio - b.ratio;
    });
    return candidates[0].id;
  }

  // ---- Canais por tronco ----
  tryAcquire(trunkId) {
    if (!trunkId) return true;
    const t = this.trunks.get(trunkId);
    if (!t) return true;
    if (t.active === false || t.direction === 'inbound') return false;
    const cur = this.activeCalls.get(trunkId) || 0;
    const maxChannels = resolveMaxChannels(t);
    if (cur >= maxChannels) return false;
    this.activeCalls.set(trunkId, cur + 1);
    return true;
  }

  release(trunkId) {
    if (!trunkId) return;
    const cur = this.activeCalls.get(trunkId) || 0;
    if (cur <= 1) this.activeCalls.delete(trunkId);
    else this.activeCalls.set(trunkId, cur - 1);
  }

  /** Identifica o tronco de entrada por header X-Trunk-ID ou pelo IP/host de origem */
  identifyTrunk(req) {
    try {
      const h = req.get && (req.get('x-trunk-id') || req.get('X-Trunk-ID'));
      if (h && this.trunks.has(h)) return h;
      const src = req.source_address || req.source?.address;
      if (src) {
        for (const t of this.trunks.values()) {
          const host = (t.proxy || t.realm || '').replace(/:\d+$/, '');
          if (host && host === src) return t.id;
        }
      }
    } catch {}
    return null;
  }
}

module.exports = new TrunkManager();
module.exports.TrunkManager = TrunkManager;

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
class TrunkManager {
  constructor(file = null) {
    this.file = file || path.join(__dirname, '..', 'config', 'sip-trunks.json');
    this.fsPool = null;
    this.trunks = new Map();
    this.activeCalls = new Map(); // trunkId -> n
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
        username: 'WTVNM',
        register: true,
        maxChannels: 30,
        active: true,
        external: true
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
      add('password', t.password || 'none');
      add('realm', t.realm || host);
      add('register', 'false');
    }
    add('proxy', hostPort);
    add('caller-id-in-from', t.callerIdInFrom === false ? 'false' : 'true');
    add('ping', t.pingFreq || 25);
    if (t.codecs) add('codec-prefs', t.codecs);
    return `<include>\n  <gateway name="${escXml(t.id)}">\n${p.join('\n')}\n  </gateway>\n</include>\n`;
  }

  async ensureInclude() {
    // Idempotente: garante que mrf.xml inclua mrf/*.xml dentro de <gateways>
    const cmd =
      `system grep -q 'mrf/\\*.xml' ${PROFILE_FILE} || ` +
      `sed -i 's|<gateways>|<gateways>\\n      <X-PRE-PROCESS cmd="include" data="mrf/*.xml"/>|' ${PROFILE_FILE}`;
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
    return { ...rest, hasPassword: Boolean(password), usedChannels: this.activeCalls.get(t.id) || 0 };
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
      maxChannels: 30,
      ...(existing || {}),
      ...data
    };
    if (!data.password && existing?.password) merged.password = existing.password;
    if (merged.register && (!merged.username || !merged.password)) {
      throw new Error('Registro SIP exige usuário e senha');
    }
    this.validate(merged);
    merged.maxChannels = Math.max(1, parseInt(merged.maxChannels, 10) || 30);
    merged.active = merged.active !== false;
    this.trunks.set(merged.id, merged);
    this.persist();
    await this._apply(merged);
    return this.mask(merged);
  }

  async remove(id) {
    const t = this.trunks.get(id);
    if (!t) return false;
    if (t.external) throw new Error('Tronco externo (definido em mrf.xml) não pode ser removido pelo painel');
    this.trunks.delete(id);
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
    this.persist();
    await this._apply(t);
    return this.mask(t);
  }

  /** Re-registra o gateway e devolve o status */
  async reconnect(id) {
    const t = this.trunks.get(id);
    if (!t) return null;
    await this._apiAll(`sofia profile ${PROFILE} killgw ${id}`).catch(() => {});
    await this._reload();
    await new Promise((r) => setTimeout(r, 2500));
    return this.status(id);
  }

  // ---- Status ----
  async status(id) {
    const t = this.trunks.get(id);
    if (!t) return null;
    if (!t.active) return { id, state: 'PAUSED', status: 'DOWN', message: 'Tronco pausado' };
    try {
      const xml = await this._api(`sofia xmlstatus gateway ${id}`);
      if (!xml.includes('<gateway>')) {
        return { id, state: 'NOT_LOADED', status: 'DOWN', message: 'Gateway não carregado no FreeSWITCH' };
      }
      return {
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
    } catch (err) {
      return { id, state: 'UNKNOWN', status: 'DOWN', message: err.message };
    }
  }

  async statusAll() {
    const out = {};
    await Promise.all([...this.trunks.keys()].map(async (id) => (out[id] = await this.status(id))));
    return out;
  }

  // ---- Canais por tronco ----
  tryAcquire(trunkId) {
    if (!trunkId) return true;
    const t = this.trunks.get(trunkId);
    if (!t) return true;
    const cur = this.activeCalls.get(trunkId) || 0;
    if (cur >= (t.maxChannels || 30)) return false;
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

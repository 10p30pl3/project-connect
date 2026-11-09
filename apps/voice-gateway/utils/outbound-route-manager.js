const { DEFAULT_CALLER_ID, SIP_HOST } = require('./env-defaults');
const fs = require('fs');
const path = require('path');
const { readJsonList, writeJsonList } = require('./json-store');

const ROUTES_FILE = path.join(__dirname, '..', 'config', 'outbound-routes.json');
const DIALPLAN_FILE = process.env.FREESWITCH_DIALPLAN_FILE || '/usr/local/freeswitch/conf/dialplan/mrf.xml';
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/;

function escXml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const DEFAULT_OUTBOUND_ROUTES = [
  {
    id: 'out-directcall-national',
    name: 'DirectCall Nacional (Celular / Fixo DDD)',
    trunkId: 'directcall',
    pattern: '^(?:0055|55|0)?([1-9]\\d{9,10})$',
    prepend: '55',
    callerIdNumber: DEFAULT_CALLER_ID,
    callerIdName: DEFAULT_CALLER_ID,
    priority: 10,
    active: true,
    description: 'Celulares e fixos de todo o Brasil (com DDD). Normaliza e adiciona 55.'
  },
  {
    id: 'out-directcall-local',
    name: 'DirectCall Local (Sem DDD - SP 11)',
    trunkId: 'directcall',
    pattern: '^([2-9]\\d{7,8})$',
    prepend: '5511',
    callerIdNumber: DEFAULT_CALLER_ID,
    callerIdName: DEFAULT_CALLER_ID,
    priority: 20,
    active: true,
    description: 'Números locais sem DDD (8 ou 9 dígitos). Adiciona 5511 automaticamente.'
  }
];

class OutboundRouteManager {
  constructor(fsPool = null, file = null) {
    this.fsPool = fsPool;
    this.file = file || ROUTES_FILE;
    this.routes = new Map();
    this.init();
  }

  setFsPool(fsPool) {
    this.fsPool = fsPool;
  }

  init() {
    let list = readJsonList(this.file);
    if (!list || list.length === 0) {
      list = DEFAULT_OUTBOUND_ROUTES;
      writeJsonList(this.file, list);
    }
    this.routes.clear();
    for (const r of list) {
      if (r && r.id) this.routes.set(String(r.id), r);
    }
  }

  persist() {
    const list = [...this.routes.values()].sort((a, b) => (a.priority || 0) - (b.priority || 0));
    writeJsonList(this.file, list);
  }

  list() {
    return [...this.routes.values()].sort((a, b) => (a.priority || 0) - (b.priority || 0));
  }

  get(id) {
    return this.routes.get(String(id)) || null;
  }

  validate(data) {
    if (!data || !data.name || !String(data.name).trim()) {
      throw new Error('"name" (nome da rota) é obrigatório');
    }
    if (!data.trunkId || !String(data.trunkId).trim()) {
      throw new Error('"trunkId" (tronco SIP de saída) é obrigatório');
    }
    if (!data.pattern || !String(data.pattern).trim()) {
      throw new Error('"pattern" (expressão de discagem) é obrigatório');
    }
    try {
      new RegExp(data.pattern);
    } catch (e) {
      throw new Error(`Expressão regular inválida no padrão: ${e.message}`);
    }
  }

  async upsert(data) {
    this.validate(data);

    let id = data.id ? String(data.id).trim().toLowerCase() : null;
    const existing = id ? this.routes.get(id) : null;

    if (!id) {
      const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
      id = `out-${slug || Date.now().toString(36)}`;
    }

    if (!ID_RE.test(id)) {
      throw new Error('"id" inválido (use letras minúsculas, números, hífen ou underline)');
    }

    const maxPriority = [...this.routes.values()].reduce((m, r) => Math.max(m, r.priority || 0), 0);

    const route = {
      id,
      name: String(data.name).trim(),
      trunkId: String(data.trunkId).trim(),
      pattern: String(data.pattern).trim(),
      prepend: data.prepend !== undefined && data.prepend !== null ? String(data.prepend).trim() : '',
      callerIdNumber: data.callerIdNumber ? String(data.callerIdNumber).trim() : '',
      callerIdName: data.callerIdName ? String(data.callerIdName).trim() : '',
      priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : existing?.priority ?? maxPriority + 10,
      active: data.active !== undefined ? Boolean(data.active) : true,
      description: data.description ? String(data.description).trim() : ''
    };

    this.routes.set(id, route);
    this.persist();

    await this.syncAllToFreeSwitch().catch((err) => {
      console.warn('[OutboundRouteManager] Aviso: rota salva, mas falhou ao sincronizar com FreeSWITCH:', err.message);
    });

    return route;
  }

  async remove(id) {
    const key = String(id);
    if (!this.routes.has(key)) return false;
    this.routes.delete(key);
    this.persist();

    await this.syncAllToFreeSwitch().catch((err) => {
      console.warn('[OutboundRouteManager] Aviso: rota removida, mas falhou ao sincronizar com FreeSWITCH:', err.message);
    });

    return true;
  }

  async toggle(id, active) {
    const r = this.get(id);
    if (!r) return null;
    r.active = active === undefined ? !r.active : Boolean(active);
    this.persist();

    await this.syncAllToFreeSwitch().catch((err) => {
      console.warn('[OutboundRouteManager] Aviso: rota alternada, mas falhou ao sincronizar com FreeSWITCH:', err.message);
    });

    return r;
  }

  async reorder(ids) {
    if (!Array.isArray(ids)) throw new Error('"ids" (array) é obrigatório');
    ids.forEach((id, i) => {
      const r = this.get(id);
      if (r) r.priority = (i + 1) * 10;
    });
    this.persist();

    await this.syncAllToFreeSwitch().catch((err) => {
      console.warn('[OutboundRouteManager] Aviso: rotas reordenadas, mas falhou ao sincronizar com FreeSWITCH:', err.message);
    });

    return this.list();
  }

  // ---- Geração de XML do Dialplan do FreeSWITCH ----

  getAiExtensionsRegex() {
    const exts = new Set(['9\\d{3}', '\\*1000', 'ia']);
    try {
      const tFile = path.join(__dirname, '..', 'config', 'tenants.json');
      if (fs.existsSync(tFile)) {
        const arr = JSON.parse(fs.readFileSync(tFile, 'utf8'));
        if (Array.isArray(arr)) {
          for (const t of arr) {
            if (t.extension && /^\d+$/.test(String(t.extension).trim())) {
              exts.add(String(t.extension).trim());
            }
          }
        }
      }
    } catch {}
    return `^(${Array.from(exts).join('|')})$`;
  }

  buildDialplanXml() {
    const activeRoutes = this.list().filter((r) => r.active);
    const aiPattern = this.getAiExtensionsRegex();

    const renderRoutesXml = () => {
      if (activeRoutes.length === 0) {
        return '    <!-- Nenhuma rota de saída ativa configurada -->\n';
      }
      return activeRoutes
        .map((r) => {
          const cidNum = r.callerIdNumber || '';
          const cidName = r.callerIdName || cidNum || '';
          const prepend = r.prepend || '';
          const trunk = r.trunkId || 'directcall';
          const matchPattern = r.pattern || '^(.*)$';

          return `    <!-- Rota de Saída: ${escXml(r.name)} -->
    <extension name="${escXml(r.id)}">
      <condition field="destination_number" expression="${escXml(matchPattern)}">
        <!-- Normalizacao de BINA: se o caller_id for ramal interno (< 10 digitos) ou vazio, usa o DID homologado da rota para evitar 603 Decline da operadora -->
        <action application="set" data="effective_caller_id_number=\${cond(\${regex(\${caller_id_number}|^[0-9]{10,13}$)} == true ? \${caller_id_number} : '${escXml(cidNum)}')}"/>
        <action application="set" data="effective_caller_id_name=\${cond(\${caller_id_name} == '' ? '${escXml(cidName)}' : \${caller_id_name})}"/>
        <action application="set" data="origination_caller_id_number=\${cond(\${regex(\${caller_id_number}|^[0-9]{10,13}$)} == true ? \${caller_id_number} : '${escXml(cidNum)}')}"/>
        <action application="set" data="origination_caller_id_name=\${cond(\${caller_id_name} == '' ? '${escXml(cidName)}' : \${caller_id_name})}"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="bridge" data="sofia/gateway/${escXml(trunk)}/${escXml(prepend)}$1"/>
      </condition>
    </extension>`;
        })
        .join('\n\n');
    };

    return `<include>
  <!-- Contexto Default: Chamadas originadas por Ramais SIP Autenticados (1000 a 1010) -->
  <context name="default">
    <!-- Teste de Eco / Loopback de Audio (*99 ou echo) -->
    <extension name="echo_test">
      <condition field="destination_number" expression="^(\\*99|echo|test)$">
        <action application="answer"/>
        <action application="set" data="playback_terminators=none"/>
        <action application="sleep" data="500"/>
        <action application="echo"/>
      </condition>
    </extension>

    <!-- Discar para o Agente de Voz IA (Ramais configurados ou range 9000-9999 / *1000 / ia) -->
    <extension name="ai_agent_call">
      <condition field="destination_number" expression="${aiPattern}">
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="bridge" data="sofia/drachtio_mrf/\${destination_number}@${SIP_HOST}:5060"/>
      </condition>
    </extension>

    <!-- Chamadas Internas entre Ramais (1000 a 1010) -->
    <extension name="internal_extensions">
      <condition field="destination_number" expression="^(100[0-9]|1010)$">
        <action application="set" data="dialed_extension=$1"/>
        <action application="set" data="ringback=$$\{us-ring\}"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="bridge" data="user/\${dialed_extension}@\${domain_name}"/>
      </condition>
    </extension>

${renderRoutesXml()}
  </context>

  <!-- Contexto MRF: Chamadas controladas pelo Drachtio, Softphones e Midia -->
  <context name="mrf">
    <!-- establish outbound event socket connection to the address specified in the X-esl-outbound header -->
    <extension name="socket">
      <condition field="\${sip_user_agent}" expression="^drachtio-fsmrf:(.*)$">
        <action application="answer"/>
        <action application="set" data="send_silence_when_idle=-1"/>
        <action application="set" data="hangup_after_bridge=false"/>
        <action application="set" data="park_after_bridge=true"/>
        <action application="set" data="playback_terminators=none"/>
        <action application="socket" data="\${sip_h_X-esl-outbound} async full"/>
      </condition>
    </extension>

    <!-- Discar para o Agente de Voz IA (Ramais configurados ou range 9000-9999 / *1000 / ia) -->
    <extension name="mrf_ai_agent_call">
      <condition field="destination_number" expression="${aiPattern}">
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="bridge" data="sofia/drachtio_mrf/\${destination_number}@${SIP_HOST}:5060"/>
      </condition>
    </extension>

    <!-- Ramais Internos (1000 a 1010) -->
    <extension name="mrf_internal_extensions">
      <condition field="destination_number" expression="^(100[0-9]|1010)$">
        <action application="set" data="dialed_extension=$1"/>
        <action application="set" data="ringback=$$\{us-ring\}"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="bridge" data="user/\${dialed_extension}@\${domain_name}"/>
      </condition>
    </extension>

    <!-- Teste de Eco (*99 ou echo) -->
    <extension name="test_echo">
      <condition field="destination_number" expression="^(\\*99|test|echo)$">
        <action application="answer"/>
        <action application="set" data="playback_terminators=none"/>
        <action application="sleep" data="500"/>
        <action application="echo"/>
      </condition>
    </extension>

${renderRoutesXml()}
  </context>
</include>
`;
  }

  // ---- ESL & FreeSWITCH ----
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

  async syncAllToFreeSwitch() {
    if (!this._nodes().length) {
      console.warn('[OutboundRouteManager] Nenhum nó FreeSWITCH ativo no momento para sincronização de rotas de saída.');
      return { ok: false, error: 'no_fs_nodes' };
    }

    const xml = this.buildDialplanXml();
    const b64 = Buffer.from(xml).toString('base64');
    const writeCmd = `system echo '${b64}' | base64 -d > ${DIALPLAN_FILE}`;

    await this._apiAll(writeCmd);
    await this._apiAll('reloadxml');

    console.log(`[OutboundRouteManager] ✅ ${this.routes.size} rotas de saída sincronizadas com sucesso no FreeSWITCH (${DIALPLAN_FILE})!`);
    return { ok: true, count: this.routes.size };
  }
}

module.exports = new OutboundRouteManager();
module.exports.OutboundRouteManager = OutboundRouteManager;

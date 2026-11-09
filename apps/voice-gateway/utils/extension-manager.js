const fs = require('fs');
const path = require('path');

const EXTENSIONS_FILE = path.join(__dirname, '..', 'config', 'extensions.json');
const DIRECTORY_DIR = '/usr/local/freeswitch/conf/directory/default';

const DEFAULT_EXTENSIONS = [
  { id: '1000', name: 'Ramal 1000 - Suporte Principal', password: '1234', context: 'default', callgroup: 'techsupport', enabled: true },
  { id: '1001', name: 'Ramal 1001 - Vendas 1', password: '1234', context: 'default', callgroup: 'sales', enabled: true },
  { id: '1002', name: 'Ramal 1002 - Vendas 2', password: '1234', context: 'default', callgroup: 'sales', enabled: true },
  { id: '1003', name: 'Ramal 1003 - Atendimento 1', password: '1234', context: 'default', callgroup: 'support', enabled: true },
  { id: '1004', name: 'Ramal 1004 - Atendimento 2', password: '1234', context: 'default', callgroup: 'support', enabled: true },
  { id: '1005', name: 'Ramal 1005 - Financeiro', password: '1234', context: 'default', callgroup: 'billing', enabled: true },
  { id: '1006', name: 'Ramal 1006 - Cobrança', password: '1234', context: 'default', callgroup: 'billing', enabled: true },
  { id: '1007', name: 'Ramal 1007 - Diretoria', password: '1234', context: 'default', callgroup: 'executive', enabled: true },
  { id: '1008', name: 'Ramal 1008 - Operação', password: '1234', context: 'default', callgroup: 'operations', enabled: true },
  { id: '1009', name: 'Ramal 1009 - Engenharia & TI', password: '1234', context: 'default', callgroup: 'engineering', enabled: true },
  { id: '1010', name: 'Ramal 1010 - Testes & Laboratório', password: '1234', context: 'default', callgroup: 'qa', enabled: true }
];

class ExtensionManager {
  constructor(fsPool = null) {
    this.fsPool = fsPool;
    this.extensions = new Map();
    this.init();
  }

  setFsPool(fsPool) {
    this.fsPool = fsPool;
  }

  init() {
    try {
      if (fs.existsSync(EXTENSIONS_FILE)) {
        const raw = fs.readFileSync(EXTENSIONS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.extensions.clear();
          for (const item of parsed) {
            this.extensions.set(String(item.id), item);
          }
          return;
        }
      }
    } catch (err) {
      console.warn('[ExtensionManager] Erro ao ler extensions.json, recriando padrão:', err.message);
    }

    // Inicializa com os ramais de 1000 a 1010 por padrão
    this.extensions.clear();
    for (const item of DEFAULT_EXTENSIONS) {
      this.extensions.set(String(item.id), { ...item });
    }
    this.persist();
  }

  persist() {
    try {
      const arr = Array.from(this.extensions.values());
      const dir = path.dirname(EXTENSIONS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(EXTENSIONS_FILE, JSON.stringify(arr, null, 2), 'utf8');
    } catch (err) {
      console.error('[ExtensionManager] Falha ao persistir extensions.json:', err.message);
    }
  }

  _nodes() {
    return (this.fsPool?.nodes || []).filter((n) => n.ready && n.mediaserver);
  }

  async _api(cmd, node = null) {
    const n = node || this._nodes()[0];
    if (!n) throw new Error('Nenhum nó FreeSWITCH disponível no pool');
    const body = await Promise.race([
      n.mediaserver.api(cmd),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ESL: ${cmd}`)), 8000))
    ]);
    return String(body || '');
  }

  async _apiAll(cmd) {
    const out = [];
    for (const n of this._nodes()) {
      out.push(await this._api(cmd, n).catch((e) => `[ERRO] ${e.message}`));
    }
    return out;
  }

  buildUserXml(ext) {
    const pass = ext.password || '1234';
    const vmPass = ext.vmPassword || ext.id;
    const cidName = ext.effectiveCallerIdName || ext.name || `Extension ${ext.id}`;
    const cidNum = ext.effectiveCallerIdNumber || ext.id;
    const context = ext.context || 'default';
    const group = ext.callgroup || 'default';

    return `<include>
  <user id="${ext.id}">
    <params>
      <param name="password" value="${pass}"/>
      <param name="vm-password" value="${vmPass}"/>
    </params>
    <variables>
      <variable name="toll_allow" value="domestic,international,local"/>
      <variable name="accountcode" value="${ext.id}"/>
      <variable name="user_context" value="${context}"/>
      <variable name="effective_caller_id_name" value="${cidName}"/>
      <variable name="effective_caller_id_number" value="${cidNum}"/>
      <variable name="outbound_caller_id_name" value="${cidName}"/>
      <variable name="outbound_caller_id_number" value="${cidNum}"/>
      <variable name="callgroup" value="${group}"/>
    </variables>
  </user>
</include>`;
  }

  async syncUserToFreeSwitch(ext) {
    if (!this._nodes().length) return;
    try {
      const xml = this.buildUserXml(ext);
      const b64 = Buffer.from(xml, 'utf8').toString('base64');
      const cmd = `system mkdir -p ${DIRECTORY_DIR} && echo ${b64} | base64 -d > ${DIRECTORY_DIR}/${ext.id}.xml`;
      await this._apiAll(cmd);
      await this._apiAll('reloadxml');
    } catch (err) {
      console.warn(`[ExtensionManager] Falha ao sincronizar ramal ${ext.id} no FreeSWITCH:`, err.message);
    }
  }

  async removeUserFromFreeSwitch(extId) {
    if (!this._nodes().length) return;
    try {
      await this._apiAll(`system rm -f ${DIRECTORY_DIR}/${extId}.xml`);
      await this._apiAll('reloadxml');
    } catch (err) {
      console.warn(`[ExtensionManager] Falha ao remover ramal ${extId} do FreeSWITCH:`, err.message);
    }
  }

  async syncAllToFreeSwitch() {
    if (!this._nodes().length) return { ok: false, reason: 'sem nós FreeSWITCH' };
    for (const ext of this.extensions.values()) {
      if (ext.enabled) {
        await this.syncUserToFreeSwitch(ext);
      }
    }
    return { ok: true, count: this.extensions.size };
  }

  async getRegistrations() {
    const regMap = {};
    if (!this._nodes().length) return regMap;

    try {
      const raw = await this._api('sofia status profile drachtio_mrf reg');
      const blocks = raw.split(/=================================================================================================/);

      for (const block of blocks) {
        const userMatch = block.match(/User:\s*([^\r\n]+)/);
        if (!userMatch) continue;

        const fullUser = userMatch[1].trim();
        const userId = fullUser.split('@')[0];

        const ipMatch = block.match(/IP:\s*([^\r\n]+)/);
        const portMatch = block.match(/Port:\s*([^\r\n]+)/);
        const agentMatch = block.match(/Agent:\s*([^\r\n]+)/);
        const statusMatch = block.match(/Status:\s*([^\r\n]+)/);
        const pingMatch = block.match(/Ping-Status:\s*([^\r\n]+)/);
        const contactMatch = block.match(/Contact:\s*([^\r\n]+)/);

        regMap[userId] = {
          registered: true,
          user: fullUser,
          ip: ipMatch ? ipMatch[1].trim() : '',
          port: portMatch ? portMatch[1].trim() : '',
          agent: agentMatch ? agentMatch[1].trim() : 'Softphone',
          status: statusMatch ? statusMatch[1].trim() : 'Registered',
          ping: pingMatch ? pingMatch[1].trim() : 'Reachable',
          contact: contactMatch ? contactMatch[1].trim() : ''
        };
      }
    } catch (err) {
      console.warn('[ExtensionManager] Erro ao consultar registros Sofia:', err.message);
    }

    return regMap;
  }

  async getAll() {
    let regMap = {};
    try {
      regMap = await this.getRegistrations();
    } catch (_) {}

    const result = [];
    for (const ext of this.extensions.values()) {
      const reg = regMap[ext.id] || { registered: false, status: 'Offline' };
      result.push({
        ...ext,
        registered: Boolean(reg.registered),
        registrationDetails: reg.registered ? reg : null
      });
    }

    // Ordena numericamente por ramal
    result.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
    return result;
  }

  getById(id) {
    return this.extensions.get(String(id)) || null;
  }

  async save(data) {
    if (!data || !data.id) throw new Error('ID do ramal obrigatório');
    const id = String(data.id).trim();
    if (!/^\d{3,6}$/.test(id)) {
      throw new Error('ID do ramal deve conter entre 3 e 6 dígitos numéricos');
    }

    const existing = this.extensions.get(id) || {};
    const ext = {
      id,
      name: (data.name || existing.name || `Ramal ${id}`).trim(),
      password: (data.password !== undefined ? data.password : (existing.password || '1234')).trim(),
      context: (data.context || existing.context || 'default').trim(),
      callgroup: (data.callgroup || existing.callgroup || 'default').trim(),
      effectiveCallerIdName: (data.effectiveCallerIdName || existing.effectiveCallerIdName || `Ramal ${id}`).trim(),
      effectiveCallerIdNumber: (data.effectiveCallerIdNumber || existing.effectiveCallerIdNumber || id).trim(),
      vmPassword: (data.vmPassword || existing.vmPassword || id).trim(),
      enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
      updatedAt: new Date().toISOString()
    };

    this.extensions.set(id, ext);
    this.persist();

    if (ext.enabled) {
      await this.syncUserToFreeSwitch(ext);
    } else {
      await this.removeUserFromFreeSwitch(id);
    }

    return ext;
  }

  async delete(id) {
    const extId = String(id);
    if (!this.extensions.has(extId)) return false;
    this.extensions.delete(extId);
    this.persist();
    await this.removeUserFromFreeSwitch(extId);
    return true;
  }

  async generateRange(start = 1000, end = 1010, defaultPassword = '1234') {
    for (let i = start; i <= end; i++) {
      const id = String(i);
      if (!this.extensions.has(id)) {
        const ext = {
          id,
          name: `Ramal ${id}`,
          password: defaultPassword,
          context: 'default',
          callgroup: 'default',
          effectiveCallerIdName: `Ramal ${id}`,
          effectiveCallerIdNumber: id,
          vmPassword: id,
          enabled: true,
          updatedAt: new Date().toISOString()
        };
        this.extensions.set(id, ext);
        await this.syncUserToFreeSwitch(ext);
      }
    }
    this.persist();
    return this.getAll();
  }

  async originateTestCall(extId, destination = '&echo') {
    const id = String(extId);
    if (!this._nodes().length) {
      throw new Error('Nenhum nó FreeSWITCH disponível');
    }

    const regMap = await this.getRegistrations();
    const isOnline = Boolean(regMap[id]?.registered);

    const cmd = `originate user/${id} ${destination} XML default`;
    console.log(`[ExtensionManager] Disparando chamada de teste para ramal ${id} (${isOnline ? 'Online' : 'Offline'}): ${cmd}`);

    try {
      const resp = await this._api(cmd);
      const isSuccess = resp.includes('+OK') || resp.includes('SUCCESS');
      return {
        ok: isSuccess,
        online: isOnline,
        response: resp.trim(),
        message: isSuccess
          ? `Chamada de teste disparada com sucesso para o ramal ${id}!`
          : `Resposta do FreeSWITCH: ${resp.trim()}`
      };
    } catch (err) {
      return {
        ok: false,
        online: isOnline,
        error: err.message,
        message: isOnline
          ? `Falha ao conectar chamada com o ramal ${id}: ${err.message}`
          : `Ramal ${id} não atendeu ou está offline (-ERR USER_NOT_REGISTERED). Registre o softphone primeiro!`
      };
    }
  }

  getSipConfig() {
    const host = process.env.EXTERNAL_IP || process.env.SIP_DOMAIN || '192.168.15.36';
    return {
      server: host,
      port: 5080,
      domain: host,
      transport: 'UDP / TCP',
      codecs: ['PCMU (G.711u)', 'PCMA (G.711a)', 'OPUS', 'G722'],
      testEchoExtension: '*99',
      aiAgentExtension: '9000',
      softphonesSupported: ['MicroSIP (Windows)', 'Zoiper (Windows/Mac/Linux/Mobile)', 'Linphone', 'Grandstream Wave', 'Telephone (macOS)'],
      quickInstructions: [
        `Servidor / Domínio (SIP Server): ${host}`,
        'Porta SIP: 5080 (Atenção: usar 5080 para registro direto no FreeSWITCH)',
        'Usuário / Ramal: 1000 a 1010',
        'Senha SIP padrão: 1234',
        'Transporte: UDP (padrão) ou TCP'
      ]
    };
  }
}

module.exports = ExtensionManager;

const { SIP_HOST, requireCallerId } = require('./env-defaults');
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout após ${ms}ms`)), ms)
    )
  ]);
}

/**
 * Gerenciador de Cluster / Pool de Múltiplas Instâncias FreeSWITCH (MRF)
 * - Conecta e monitora múltiplos servidores FreeSWITCH independentemente.
 * - Balanceia chamadas por Least-Connections (menor carga de chamadas ativas) + Round-Robin.
 * - Reconexão automática individual por nó (se um FreeSWITCH cair, os demais continuam operando).
 */
class FreeSwitchPool {
  constructor(mrf) {
    this.mrf = mrf;
    this.nodes = []; // Array de objetos de estado de cada nó FreeSWITCH
    this.roundRobinIndex = 0;
    this.isShuttingDown = false;
    this.maxCallsPerNode = parseInt(process.env.FREESWITCH_MAX_CALLS_PER_NODE || '600', 10);
  }

  /**
   * Lê a lista de nós do .env:
   * Suporta FREESWITCH_NODES="host1:8021:secret1,host2:8021:secret2"
   * Ou fallback100% compatível com FREESWITCH_HOST, FREESWITCH_PORT, FREESWITCH_SECRET.
   */
  parseNodesFromEnv() {
    const rawList = process.env.FREESWITCH_NODES;
    const defaultHost = process.env.FREESWITCH_HOST || '127.0.0.1';
    const defaultPort = parseInt(process.env.FREESWITCH_PORT || '8021', 10);
    const defaultSecret = process.env.FREESWITCH_SECRET || 'JambonzR0ck$';

    if (rawList && rawList.trim().length > 0) {
      const entries = rawList
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      return entries.map((entry, idx) => {
        const parts = entry.split(':');
        const address = parts[0] || defaultHost;
        const port = parseInt(parts[1] || String(defaultPort), 10);
        const secret = parts.slice(2).join(':') || defaultSecret;
        return {
          id: `fs-${idx + 1} (${address}:${port})`,
          address,
          port,
          secret,
          mediaserver: null,
          ready: false,
          connecting: false,
          activeCalls: 0,
          totalCallsHandled: 0,
          attempts: 0,
          lastError: null
        };
      });
    }

    return [
      {
        id: `fs-1 (${defaultHost}:${defaultPort})`,
        address: defaultHost,
        port: defaultPort,
        secret: defaultSecret,
        mediaserver: null,
        ready: false,
        connecting: false,
        activeCalls: 0,
        totalCallsHandled: 0,
        attempts: 0,
        lastError: null
      }
    ];
  }

  /**
   * Inicializa a conexão com todas as instâncias configuradas em paralelo
   */
  async start() {
    this.nodes = this.parseNodesFromEnv();
    console.log(`[FreeSwitchPool] Inicializando pool com ${this.nodes.length} instância(s) de FreeSWITCH...`);

    for (const node of this.nodes) {
      this.connectNode(node);
    }
  }

  async connectNode(node) {
    if (node.connecting || this.isShuttingDown) return;
    node.connecting = true;

    while (node.connecting && !this.isShuttingDown) {
      node.attempts += 1;
      console.log(`[FreeSwitchPool] Conectando a [${node.id}] via ESL (tentativa ${node.attempts})...`);

      try {
        const ms = await withTimeout(
          this.mrf.connect({
            address: node.address,
            port: node.port,
            secret: node.secret
          }),
          15000
        );

        node.mediaserver = ms;
        node.ready = true;
        node.connecting = false;
        node.attempts = 0;
        node.lastError = null;

        console.log(`[FreeSwitchPool] ✅ Nó [${node.id}] conectado e pronto para chamadas!`);

        ms.on('disconnect', () => {
          console.error(`[FreeSwitchPool] 🚨 Nó [${node.id}] desconectou! Marcando como offline e reconectando...`);
          node.ready = false;
          node.mediaserver = null;
          node.activeCalls = 0; // Limpa contagem de chamadas ativas do nó desconectado para evitar chamadas fantasmas
          if (!this.isShuttingDown) {
            this.connectNode(node);
          }
        });

        ms.on('error', (err) => {
          node.lastError = err.message || String(err);
          console.error(`[FreeSwitchPool] 🚨 Erro ESL no nó [${node.id}]:`, node.lastError);
        });

        break;
      } catch (err) {
        node.lastError = err.message || String(err);
        console.error(`[FreeSwitchPool] Erro ao conectar em [${node.id}]: ${node.lastError}`);
        await wait(3000);
      }
    }
  }

  /**
   * Verifica se há pelo menos 1 instância de FreeSWITCH pronta e com capacidade
   */
  hasHealthyNode() {
    return this.nodes.some((n) => n.ready && n.mediaserver && n.activeCalls < this.maxCallsPerNode);
  }

  /**
   * Seleciona a melhor instância de FreeSWITCH usando Least-Connections + desempate Round-Robin
   */
  selectBestNode() {
    const available = this.nodes.filter(
      (n) => n.ready && n.mediaserver && n.activeCalls < this.maxCallsPerNode
    );

    if (available.length === 0) return null;
    if (available.length === 1) return available[0];

    // Encontra a menor quantidade de chamadas ativas entre os nós saudáveis
    let minCalls = Infinity;
    for (const node of available) {
      if (node.activeCalls < minCalls) {
        minCalls = node.activeCalls;
      }
    }

    // Filtra os candidatos empatados com menor carga e aplica Round-Robin
    const candidates = available.filter((n) => n.activeCalls === minCalls);
    const chosen = candidates[this.roundRobinIndex % candidates.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % 1000000;
    return chosen;
  }

  /**
   * Atende a chamada no FreeSWITCH menos carregado e gerencia a contagem de carga do nó
   */
  async connectCaller(req, res) {
    const node = this.selectBestNode();
    if (!node) {
      throw new Error('Nenhuma instância do FreeSWITCH disponível ou todas atingiram capacidade máxima');
    }

    node.activeCalls += 1;
    node.totalCallsHandled += 1;

    try {
      const result = await node.mediaserver.connectCaller(req, res);
      let released = false;

      const releaseNodeSlot = () => {
        if (released) return;
        released = true;
        node.activeCalls = Math.max(0, node.activeCalls - 1);
      };

      if (result.dialog) {
        result.dialog.on('destroy', () => {
          releaseNodeSlot();
          if (result.endpoint) {
            try {
              result.endpoint.destroy();
            } catch {}
          }
        });
      }

      return {
        ...result,
        fsNode: node,
        releaseNodeSlot
      };
    } catch (err) {
      node.activeCalls = Math.max(0, node.activeCalls - 1);
      throw err;
    }
  }

  /**
   * Origina uma chamada ativa (Outbound SIP INVITE) usando a instância de FreeSWITCH menos carregada
   */
  async originateCall(srf, { to, from, headers = {} }) {
    const node = this.selectBestNode();
    if (!node) {
      throw new Error('Nenhuma instância do FreeSWITCH disponível para originar chamada');
    }

    node.activeCalls += 1;
    node.totalCallsHandled += 1;

    let endpoint = null;
    try {
      endpoint = await node.mediaserver.createEndpoint();
      let sipUri = String(to || '').trim();
      const fsHost = SIP_HOST;

      if (sipUri.startsWith('sip:')) {
        if (!sipUri.includes('@')) {
          const user = sipUri.replace(/^sip:\+?/, '');
          sipUri = `sip:${user}@${fsHost}:5080`;
        } else if (!sipUri.includes(':5080') && sipUri.endsWith(`@${fsHost}`)) {
          sipUri = `${sipUri}:5080`;
        }
      } else {
        if (sipUri.includes('@')) {
          const [user, hostPort] = sipUri.split('@');
          const cleanUser = user.replace(/^\+/, '');
          const host = hostPort.includes(':') ? hostPort : `${hostPort}:5080`;
          sipUri = `sip:${cleanUser}@${host}`;
        } else {
          const cleanTo = sipUri.replace(/^\+/, '');
          sipUri = `sip:${cleanTo}@${fsHost}:5080`;
        }
      }
      const callingNumber = requireCallerId(from);
      const outboundHeaders = {
        ...headers
      };
      if (!outboundHeaders['From'] && !outboundHeaders['from']) {
        outboundHeaders['From'] = `<sip:${callingNumber}@${fsHost}>`;
      }
      const dialog = await srf.createUAC(sipUri, {
        localSdp: endpoint.local.sdp,
        callingNumber,
        headers: outboundHeaders
      });

      await endpoint.modify(dialog.remote.sdp);

      let released = false;
      const releaseNodeSlot = () => {
        if (released) return;
        released = true;
        node.activeCalls = Math.max(0, node.activeCalls - 1);
      };

      dialog.on('destroy', () => {
        releaseNodeSlot();
        try {
          endpoint.destroy();
        } catch {}
      });

      return {
        endpoint,
        dialog,
        fsNode: node,
        releaseNodeSlot
      };
    } catch (err) {
      node.activeCalls = Math.max(0, node.activeCalls - 1);
      if (endpoint) {
        try {
          endpoint.destroy();
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Retorna métricas detalhadas do cluster FreeSWITCH para o /health
   */
  getPoolStats() {
    const healthyCount = this.nodes.filter((n) => n.ready).length;
    return {
      totalNodes: this.nodes.length,
      healthyNodes: healthyCount,
      maxCallsPerNode: this.maxCallsPerNode,
      nodes: this.nodes.map((n) => ({
        id: n.id,
        ready: n.ready,
        activeCalls: n.activeCalls,
        totalCallsHandled: n.totalCallsHandled,
        lastError: n.lastError
      }))
    };
  }

  async stop() {
    this.isShuttingDown = true;
    for (const node of this.nodes) {
      node.connecting = false;
      node.ready = false;
      if (node.mediaserver && typeof node.mediaserver.disconnect === 'function') {
        try {
          node.mediaserver.disconnect();
        } catch {}
      }
    }
  }
}

module.exports = FreeSwitchPool;

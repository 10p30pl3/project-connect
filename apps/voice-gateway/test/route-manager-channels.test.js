const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RouteManager } = require('../utils/route-manager');

function makeTenantManager(tenantsList) {
  const tenants = new Map(tenantsList.map((t) => [t.id, t]));
  return {
    tenants,
    resolveTenant: () => tenantsList[0] || null,
  };
}

test('RouteManager carrega routes.json legado (sem channelType/connectionId/originPattern) preservando regras SIP', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voll-routes-'));
  const file = path.join(tmpDir, 'routes.json');
  fs.writeFileSync(
    file,
    JSON.stringify([
      {
        id: 'legacy-sip-1',
        name: 'DID Cobrança Legado',
        trunkId: 'directcall',
        didPattern: '55114003*',
        callerPattern: '*',
        tenantId: 'agent-sip',
        priority: 10,
        active: true,
      },
    ]),
  );

  try {
    const rm = new RouteManager(file);
    const list = rm.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].channelType, '*');
    assert.equal(list[0].connectionId, '*');
    assert.equal(list[0].originPattern, '*');

    const sipMatch = rm.match({
      channelType: 'VOICE',
      trunkId: 'directcall',
      did: '+551140031234',
      callerId: '5511999990000',
    });
    assert.equal(sipMatch.rule?.id, 'legacy-sip-1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RouteManager aplica channelType, connectionId e originPattern para WEBRTC, WhatsApp Calling e SIP em simulate/match', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voll-routes-mc-'));
  const file = path.join(tmpDir, 'routes.json');
  fs.writeFileSync(file, '[]');

  try {
    const rm = new RouteManager(file);
    const tm = makeTenantManager([
      { id: 'agent-default', name: 'Padrão', active: true },
      { id: 'agent-vip-web', name: 'VIP Web', active: true },
      { id: 'agent-wa', name: 'WhatsApp IA', active: true },
      { id: 'agent-sip', name: 'SIP SAC', active: true },
    ]);

    rm.upsert(
      {
        id: 'r-sip',
        name: 'Rota SIP',
        channelType: 'VOICE',
        connectionId: '*',
        didPattern: '*',
        originPattern: '*',
        tenantId: 'agent-sip',
        priority: 5,
        active: true,
      },
      tm,
    );
    rm.upsert(
      {
        id: 'r-web-vip',
        name: 'Web VIP',
        channelType: 'WEBRTC',
        connectionId: 'conn-web-1',
        originPattern: 'https://vip.*',
        didPattern: '*',
        callerPattern: '*',
        tenantId: 'agent-vip-web',
        priority: 10,
        active: true,
      },
      tm,
    );
    rm.upsert(
      {
        id: 'r-wa-1',
        name: 'WhatsApp Número Oficial',
        channelType: 'WEBRTC',
        connectionId: 'conn-wa-1',
        didPattern: '109283746501234',
        originPattern: '*',
        callerPattern: '*',
        tenantId: 'agent-wa',
        priority: 20,
        active: true,
      },
      tm,
    );

    // Regra SIP não casa chamada WEBRTC
    const webSim = rm.simulate(
      { channelType: 'WEBRTC', connectionId: 'conn-web-1', origin: 'https://vip.empresa.com', did: '' },
      tm,
    );
    assert.equal(webSim.matchedRule?.id, 'r-web-vip');
    assert.equal(webSim.tenant?.id, 'agent-vip-web');
    assert.equal(webSim.source, 'inbound_route');

    // Origem diferente não casa r-web-vip
    const webMiss = rm.match({
      channelType: 'WEBRTC',
      connectionId: 'conn-web-1',
      origin: 'https://blog.empresa.com',
      did: '',
    });
    assert.equal(webMiss.rule, null);

    // WhatsApp Calling casa por connectionId + didPattern
    const waMatch = rm.match({
      channelType: 'WEBRTC',
      connectionId: 'conn-wa-1',
      did: '109283746501234',
      callerId: '5511998887777',
    });
    assert.equal(waMatch.rule?.id, 'r-wa-1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

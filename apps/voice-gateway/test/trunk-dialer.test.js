'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { TrunkManager } = require('../utils/trunk-manager');
const { OutboundRouteManager } = require('../utils/outbound-route-manager');
const { validateCallRequest } = require('../utils/voll-contract');
const { createApiRouter } = require('../utils/api-router');

function createTempTrunkManager(initialTrunks = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voll-trunks-test-'));
  const file = path.join(dir, 'sip-trunks.json');
  fs.writeFileSync(file, JSON.stringify(initialTrunks), 'utf8');
  const tm = new TrunkManager(file);
  tm.trunks.clear();
  for (const t of initialTrunks) tm.trunks.set(t.id, { ...t });
  return {
    tm,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('TrunkManager aplica fallback maxChannels=1 e calcula disponibilidade por tronco e allowlist', async () => {
  const { tm, cleanup } = createTempTrunkManager([
    { id: 't1', name: 'Tronco 1', direction: 'outbound', active: true, maxChannels: 3 },
    { id: 't2', name: 'Tronco 2 (sem max)', direction: 'both', active: true },
    { id: 't3', name: 'Tronco Pausado', direction: 'outbound', active: false, maxChannels: 10 },
    { id: 't4', name: 'Somente Entrada', direction: 'inbound', active: true, maxChannels: 5 },
  ]);

  try {
    assert.strictEqual(tm.tryAcquire('t1'), true);
    assert.strictEqual(tm.tryAcquire('t1'), true);

    const availAll = await tm.getAvailability({ useCache: false });
    // t1: 3 total, 2 active -> 1 livre; t2: fallback 1, 0 active -> 1 livre; t3: paused (0 online); t4: inbound ignorado no summary outbound
    assert.strictEqual(availAll.summary.onlineOutboundTrunks, 2);
    assert.strictEqual(availAll.summary.totalChannels, 4);
    assert.strictEqual(availAll.summary.activeCalls, 2);
    assert.strictEqual(availAll.summary.availableChannels, 2);

    const t2Info = availAll.trunks.find((t) => t.id === 't2');
    assert.strictEqual(t2Info.maxChannels, 1);
    assert.strictEqual(t2Info.availableChannels, 1);

    const availFiltered = await tm.getAvailability({ trunkIds: ['t2'], useCache: false });
    assert.strictEqual(availFiltered.trunks.length, 1);
    assert.strictEqual(availFiltered.summary.availableChannels, 1);
    assert.strictEqual(availFiltered.summary.totalChannels, 1);
  } finally {
    cleanup();
  }
});

test('TrunkManager selectAvailableTrunk, tryAcquire e release respeitam limites e balanceiam ocupação', () => {
  const { tm, cleanup } = createTempTrunkManager([
    { id: 't-a', name: 'Tronco A', direction: 'outbound', active: true, maxChannels: 2 },
    { id: 't-b', name: 'Tronco B', direction: 'outbound', active: true, maxChannels: 2 },
    { id: 't-paused', name: 'Pausado', direction: 'outbound', active: false, maxChannels: 5 },
    { id: 't-in', name: 'Inbound', direction: 'inbound', active: true, maxChannels: 5 },
  ]);

  try {
    assert.strictEqual(tm.tryAcquire('t-paused'), false);
    assert.strictEqual(tm.tryAcquire('t-in'), false);

    // 1a escolha com ambos vazios -> t-a; após adquirir t-a (50%), próxima escolha vai para t-b (0%)
    const first = tm.selectAvailableTrunk({ trunkIds: ['t-a', 't-b'] });
    assert.strictEqual(first, 't-a');
    assert.strictEqual(tm.tryAcquire(first), true);

    const second = tm.selectAvailableTrunk({ trunkIds: ['t-a', 't-b'] });
    assert.strictEqual(second, 't-b');
    assert.strictEqual(tm.tryAcquire(second), true);

    // Ocupa capacidade restante
    assert.strictEqual(tm.tryAcquire('t-a'), true);
    assert.strictEqual(tm.tryAcquire('t-b'), true);
    assert.strictEqual(tm.tryAcquire('t-a'), false);
    assert.strictEqual(tm.selectAvailableTrunk({ trunkIds: ['t-a', 't-b'] }), null);

    // Libera 1 canal em t-b -> volta a ficar elegível
    tm.release('t-b');
    assert.strictEqual(tm.selectAvailableTrunk({ trunkIds: ['t-a', 't-b'] }), 't-b');
  } finally {
    cleanup();
  }
});

test('OutboundRouteManager.matchOutbound filtra rotas pelos troncos permitidos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voll-routes-test-'));
  const file = path.join(dir, 'outbound-routes.json');
  fs.writeFileSync(
    file,
    JSON.stringify([
      { id: 'r1', name: 'Rota Alta Prioridade', trunkId: 't-a', pattern: '^55', priority: 1, active: true },
      { id: 'r2', name: 'Rota Secundária', trunkId: 't-b', pattern: '^55', priority: 2, active: true },
    ]),
    'utf8',
  );
  try {
    const orm = new OutboundRouteManager(file);
    orm.routes.clear();
    orm.routes.set('r1', { id: 'r1', name: 'Rota Alta Prioridade', trunkId: 't-a', pattern: '^55', priority: 1, active: true });
    orm.routes.set('r2', { id: 'r2', name: 'Rota Secundária', trunkId: 't-b', pattern: '^55', priority: 2, active: true });
    assert.strictEqual(orm.matchOutbound({ destination: '+5511999990000' })?.id, 'r1');
    assert.strictEqual(orm.matchOutbound({ destination: '+5511999990000', trunkIds: ['t-b'] })?.id, 'r2');
    assert.strictEqual(orm.matchOutbound({ destination: '+5511999990000', trunkIds: ['t-x'] }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateCallRequest aceita trunkIds opcional no contrato VoiceCallRequestSchema', () => {
  const basePayload = {
    attemptId: '11111111-1111-4111-8111-111111111111',
    traceId: 'trace-1',
    connectionId: '22222222-2222-4222-8222-222222222222',
    workspaceId: '33333333-3333-4333-8333-333333333333',
    to: '+5511988887777',
    from: '+551130001000',
    callerId: '+551130001000',
    tenantId: 'tenant-1',
    contact: { externalId: 'c-1', name: 'Maria', variables: {} },
    campaign: { id: '44444444-4444-4444-8444-444444444444' },
    limits: { maxDurationSec: 300 },
    callback: { url: 'https://example.com/hook', secret: '0123456789abcdef' },
  };
  assert.strictEqual(validateCallRequest({ ...basePayload, trunkIds: ['t-a', 't-b'] }).ok, true);
  assert.strictEqual(validateCallRequest({ ...basePayload, trunkIds: [''] }).ok, false);
});

test('API router expõe GET /v1/trunks/availability e retorna 429 trunk_capacity_exceeded quando troncos lotados', async () => {
  const { tm, cleanup } = createTempTrunkManager([
    { id: 't-cap', name: 'Tronco Cap 1', direction: 'outbound', active: true, maxChannels: 1 },
  ]);

  const tenants = new Map([
    [
      't1',
      {
        id: 't1',
        active: true,
        maxConcurrentCalls: 10,
        fromNumber: '+551130001000',
        allowedCallerIds: ['+551130001000'],
      },
    ],
  ]);
  const tenantManager = {
    tenants,
    getTenant: (id) => tenants.get(id) || null,
    resolve: (id) => tenants.get(id) || null,
  };

  let originatedCalls = 0;
  const router = createApiRouter({
    activeBridges: new Map(),
    tenantManager,
    fsPool: null,
    whisperPool: null,
    mediaServer: null,
    originateCallHandler: async (opts) => {
      originatedCalls++;
      return { callId: `call-${originatedCalls}`, trunkId: opts._preAcquiredTrunkId };
    },
    trunkManager: tm,
    outboundRouteManager: { matchOutbound: () => null },
  });

  const server = http.createServer((req, res) => {
    router(req, res).catch((err) => {
      res.writeHead(500);
      res.end(err.message);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const availRes = await fetch(`${baseUrl}/v1/trunks/availability?trunkIds=t-cap`);
    assert.strictEqual(availRes.status, 200);
    const availBody = await availRes.json();
    assert.strictEqual(availBody.summary.availableChannels, 1);

    const callPayload = {
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      traceId: 'trace-a',
      connectionId: '22222222-2222-4222-8222-222222222222',
      workspaceId: '33333333-3333-4333-8333-333333333333',
      to: '+5511999991111',
      from: '+551130001000',
      callerId: '+551130001000',
      tenantId: 't1',
      contact: { externalId: 'ext-1', name: 'João', variables: {} },
      campaign: { id: '44444444-4444-4444-8444-444444444444' },
      limits: { maxDurationSec: 180 },
      callback: { url: 'https://example.com/hook', secret: '0123456789abcdef' },
      trunkIds: ['t-cap'],
    };

    const res1 = await fetch(`${baseUrl}/v1/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(callPayload),
    });
    assert.strictEqual(res1.status, 202);
    const b1 = await res1.json();
    assert.strictEqual(b1.trunkId, 't-cap');

    // Segunda chamada simultânea encontra t-cap com 1/1 ativo -> HTTP 429 trunk_capacity_exceeded
    const res2 = await fetch(`${baseUrl}/v1/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...callPayload,
        attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        traceId: 'trace-b',
      }),
    });
    assert.strictEqual(res2.status, 429);
    const b2 = await res2.json();
    assert.strictEqual(b2.error, 'trunk_capacity_exceeded');

    // Aguarda setImmediate da chamada 1 finalizar e libera manualmente como cleanupCall faria
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(originatedCalls, 1);
    tm.release('t-cap');

    const res3 = await fetch(`${baseUrl}/v1/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...callPayload,
        attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        traceId: 'trace-c',
      }),
    });
    assert.strictEqual(res3.status, 202);
    await new Promise((r) => setTimeout(r, 30));
    tm.release('t-cap');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup();
  }
});

test('TrunkManager omite ping em tronco IP-auth sem pingFreq e considera NOREG online mesmo com status DOWN', () => {
  const { tm, cleanup } = createTempTrunkManager([
    { id: 'directcall', name: 'DirectCall', proxy: 'sip1.directdial.com.br', register: false, active: true, maxChannels: 30 },
    { id: 'reg-trunk', name: 'Reg', proxy: 'sip.example.com', username: 'u', password: 'p', register: true, active: true, maxChannels: 10 },
  ]);

  try {
    const ipXml = tm.buildXml(tm.trunks.get('directcall'));
    assert.ok(!ipXml.includes('name="ping"'), 'IP-auth sem pingFreq não deve emitir <param name="ping">');

    const regXml = tm.buildXml(tm.trunks.get('reg-trunk'));
    assert.ok(regXml.includes('<param name="ping" value="25"/>'), 'Tronco com register=true deve manter ping padrão');

    // Simula fsPool anexado
    tm.attach({ nodes: [{ ready: true, mediaserver: {} }] });
    assert.strictEqual(tm.isTrunkOnline(tm.trunks.get('directcall'), { state: 'NOREG', status: 'DOWN' }), true);
    assert.strictEqual(tm.isTrunkOnline(tm.trunks.get('directcall'), { state: 'NOT_LOADED', status: 'DOWN' }), false);
    assert.strictEqual(tm.isTrunkOnline(tm.trunks.get('reg-trunk'), { state: 'NOREG', status: 'DOWN' }), false);
    assert.strictEqual(tm.isTrunkOnline(tm.trunks.get('reg-trunk'), { state: 'REGED', status: 'UP' }), true);
  } finally {
    cleanup();
  }
});

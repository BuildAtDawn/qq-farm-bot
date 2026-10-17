const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createRequire } = require('node:module');

function loadModule(relative, mocks) {
  const filename = path.join(__dirname, relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, require: name => mocks[name] || localRequire(name)
  }, { filename });
  return module.exports;
}

const now = 2000000000;
const utils = require('../src/utils/utils');
const analyzer = loadModule('../src/services/farm-land-analyzer.js', {
  '../utils/utils': { ...utils, getServerTimeSec: () => now }
});
function rawLand(options = {}) {
  return {
    id: 1, unlocked: true, level: 3,
    plant: { id: 999999999, name: '测试作物', season: 1, left_inorc_fert_times: 1,
      phases: [{ phase: 2, begin_time: now - 10 }, { phase: 6, begin_time: now + 3600 }] },
    ...options
  };
}
function fixture(raw = rawLand(), reply = { land: [rawLand()], fertilizer: { count: 12000 } }) {
  const calls = [];
  const service = loadModule('../src/services/farm-manual-fertilizer.js', {
    './farm-api': { NORMAL_FERTILIZER_ID: 1011, ORGANIC_FERTILIZER_ID: 1012,
      getAllLands: async () => ({ lands: [raw] }),
      fertilizeOne: async (...args) => { calls.push(args); return reply; } },
    './farm-land-analyzer': analyzer,
    '../utils/utils': { toNum: Number, log: () => {} }
  });
  return { service, calls };
}

test('formats a successful fertilizer land snapshot and preserves unknown remaining applications', () => {
  const raw = rawLand();
  let land = analyzer.buildLandDetails({ lands: [raw] }).lands[0];
  assert.equal(land.status, 'growing');
  assert.equal(land.matureInSec, 3600);
  assert.equal(land.leftInorcFertTimes, 1);
  delete raw.plant.left_inorc_fert_times;
  land = analyzer.buildLandDetails({ lands: [raw] }).lands[0];
  assert.equal(land.leftInorcFertTimes, null);
});

test('normal and default organic calls retain old success/count fields and use reply snapshots', async () => {
  const updated = rawLand({ plant: { ...rawLand().plant, phases: [{ phase: 6, begin_time: now }] } });
  const f = fixture(rawLand(), { land: [updated], fertilizer: { count: 123 } });
  const normal = await f.service.fertilizeOwnLand(1, 'normal');
  assert.equal(f.calls[0][1], 1011);
  assert.equal(normal.success, true);
  assert.equal(normal.count, 1);
  assert.equal(normal.updatedLand.status, 'harvestable');
  assert.equal(normal.fertilizerRemainingSec, 123);
  await f.service.fertilizeOwnLand(1);
  assert.equal(f.calls[1][1], 1012);
});

test('invalid types/ids, locked, empty, mature and occupied slave lands never send fertilizer', async () => {
  for (const [id, type, raw] of [
    [0, 'organic', rawLand()], [1.5, 'organic', rawLand()], [1, 'diamond', rawLand()],
    [1, 'organic', rawLand({ unlocked: false })], [1, 'organic', rawLand({ plant: null })],
    [1, 'organic', rawLand({ plant: { ...rawLand().plant, phases: [{ phase: 6, begin_time: now }] } })],
    [1, 'organic', rawLand({ master_land_id: 2 })],
  ]) {
    const f = fixture(raw);
    await assert.rejects(() => f.service.fertilizeOwnLand(id, type));
    assert.equal(f.calls.length, 0);
  }
});

test('spent normal applications are rejected while organic remains available', async () => {
  const raw = rawLand();
  raw.plant.left_inorc_fert_times = 0;
  const f = fixture(raw);
  await assert.rejects(() => f.service.fertilizeOwnLand(1, 'normal'), /本季已施过/);
  assert.equal(f.calls.length, 0);
  await f.service.fertilizeOwnLand(1, 'organic');
  assert.equal(f.calls.length, 1);
});

test('missing fertilizer inventory or land reply remains unknown rather than claiming maturity', async () => {
  const f = fixture(rawLand(), {});
  const result = await f.service.fertilizeOwnLand(1);
  assert.equal(result.updatedLand, null);
  assert.equal(result.fertilizerRemainingSec, null);
});

const { registerAdminFarmOperationRoutes } = require('../src/controllers/admin-farm-operation-routes');
test('fertilize route rejects invalid types, defaults to organic and checks account access', async () => {
  const routes = new Map();
  const calls = [];
  registerAdminFarmOperationRoutes({
    app: { post: (url, handler) => routes.set(url, handler) },
    provider: { fertilizeLand: async (...args) => { calls.push(args); return { success: true }; } },
    getAccountIdFromRequest: req => req.account,
    canAccessAccount: req => req.allowed !== false,
    sendProviderError: (res, error) => res.status(500).json({ error: error.message })
  });
  async function request(body, overrides = {}) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await routes.get('/api/land/fertilize')({ body, account: 'a', ...overrides }, res);
    return res;
  }
  assert.equal((await request({ landId: 1, fertilizerType: 'diamond' })).code, 400);
  assert.equal(calls.length, 0);
  await request({ landId: 1 });
  assert.equal(calls[0][2], 'organic');
  await request({ landId: 1, fertilizerType: 'normal' });
  assert.equal(calls[1][2], 'normal');
  assert.equal((await request({ landId: 1 }, { allowed: false })).code, 403);
  assert.equal(calls.length, 2);
});

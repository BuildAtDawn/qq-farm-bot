const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { registerAdminFarmOperationRoutes } = require('../src/controllers/admin-farm-operation-routes');
const { validateSeedIds } = require('../src/utils/manual-seed-selection');
const { isSeedLockedByLevel, build2x2LandGroups } = require('../src/services/planting-service');

function fixture() {
  const calls = [];
  const module = { exports: {} };
  const state = {
    seeds: [{ seedId: 1, name: '种子', count: 3, requiredLevel: 1 }],
    lands: Array.from({ length: 24 }, (_, i) => ({ id: 24 - i, unlocked: true, status: 'empty' })),
    level: 1,
    partial: false,
    read: null,
  };
  const modules = {
    './farm-api': { getAllLands: async () => state.read ? state.read() : { lands: state.lands } },
    './farm-land-analyzer': { buildLandDetails: reply => reply },
    './warehouse': { getBagSeeds: async () => state.seeds },
    '../utils/network': { getUserState: () => ({ level: state.level }) },
    '../utils/manual-seed-selection': { validateSeedIds },
    './planting-service': {
      isSeedLockedByLevel, build2x2LandGroups,
      getPlantSizeBySeedId: id => state.seeds.find(seed => seed.seedId === id)?.plantSize || 1,
      plantSeeds: async (id, ids, options) => {
        calls.push([id, Array.from(ids), options.maxPlantCount]);
        const plantedLandIds = state.partial ? ids.slice(0, 1) : ids;
        return { planted: plantedLandIds.length, plantedLandIds, occupiedLandIds: plantedLandIds };
      },
      plant2x2Seed: async (id, group) => {
        calls.push([id, Array.from(group.landIds)]);
        return { masterLandId: group.masterLandId, occupiedLandIds: group.landIds };
      },
    },
    './mutation-operation-gate': { farmOperationGate: { operation: fn => fn() } },
    './stats': { recordOperation() {} },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/farm-manual-planting'), 'utf8'), {
    module, require: name => {
      assert.ok(modules[name], `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return { ...module.exports, state, calls };
}

test('24 empty lands and 3 selected seeds plant only lands 1, 2, 3 without fallback', async () => {
  const f = fixture();
  f.state.seeds.push({ seedId: 2, name: '未选种子', count: 99 });
  const result = await f.plantSelectedBagSeeds([1, 1]);
  assert.deepEqual(f.calls, [[1, [1, 2, 3], 3]]);
  assert.equal(result.planted, 3);
  assert.equal(result.remaining, 21);
});

test('multiple selected seeds use distinct ascending empty lands and exclude occupied or locked plots', async () => {
  const f = fixture();
  f.state.lands = [
    { id: 1, unlocked: true, status: 'growing' },
    { id: 2, unlocked: false, status: 'empty' },
    { id: 3, unlocked: true, occupiedByMaster: true, status: 'empty' },
    ...[9, 7, 4, 6, 5].map(id => ({ id, unlocked: true, status: 'empty' })),
  ];
  f.state.seeds.push({ seedId: 2, name: '另一种子', count: 8 });
  const result = await f.plantSelectedBagSeeds([1, 2]);
  assert.deepEqual(f.calls, [[1, [4, 5, 6], 3], [2, [7, 9], 2]]);
  assert.equal(result.remaining, 0);
});

test('2x2 seeds occupy only legal empty groups in anchor order, consuming one seed per group', async () => {
  const f = fixture();
  f.state.seeds[0].plantSize = 2;
  const result = await f.plantSelectedBagSeeds([1]);
  assert.deepEqual(f.calls, [[1, [5, 6, 1, 2]], [1, [7, 8, 3, 4]], [1, [13, 14, 9, 10]]]);
  assert.equal(result.planted, 3);
  assert.equal(result.remaining, 12);
  f.calls.length = 0;
  f.state.lands = f.state.lands.filter(land => land.id <= 3);
  assert.equal((await f.plantSelectedBagSeeds([1])).planted, 0);
  assert.equal(f.calls.length, 0);
});

test('inventory is checked afresh, normal level limits apply, and level >= 200 retains exemption', async () => {
  const f = fixture();
  for (const ids of [[], [0], ['1'], [1.5], [2]]) {
    await assert.rejects(() => f.plantSelectedBagSeeds(ids));
  }
  f.state.seeds[0].count = 0;
  await assert.rejects(() => f.plantSelectedBagSeeds([1]), /库存不足/);
  f.state.seeds[0].count = 3;
  f.state.seeds[0].requiredLevel = 199;
  await assert.rejects(() => f.plantSelectedBagSeeds([1]), /等级未解锁/);
  assert.equal(f.calls.length, 0);
  f.state.seeds[0].requiredLevel = 200;
  assert.equal((await f.plantSelectedBagSeeds([1])).planted, 3);
});

test('partial planting stops before another seed can reuse uncertain lands', async () => {
  const f = fixture();
  f.state.partial = true;
  f.state.seeds.push({ seedId: 2, count: 99 });
  assert.equal((await f.plantSelectedBagSeeds([1, 2])).planted, 1);
  assert.equal(f.calls.length, 1);
});

test('duplicate operations are rejected and failed reads release the guard', async () => {
  const f = fixture();
  let finish;
  f.state.read = () => new Promise(resolve => { finish = resolve; });
  const pending = f.plantSelectedBagSeeds([1]);
  await Promise.resolve();
  await assert.rejects(() => f.plantSelectedBagSeeds([1]), /正在执行/);
  finish({ lands: [] });
  assert.equal((await pending).planted, 0);
  f.state.read = async () => { throw new Error('read failed'); };
  await assert.rejects(() => f.plantSelectedBagSeeds([1]), /read failed/);
  f.state.read = null;
  assert.equal((await f.plantSelectedBagSeeds([1])).planted, 3);
});

test('bag planting route enforces access and validates selection before dispatch', async () => {
  const routes = new Map();
  const calls = [];
  registerAdminFarmOperationRoutes({
    app: { post: (path, handler) => routes.set(path, handler) },
    provider: { plantSelectedBagSeeds: async (...args) => { calls.push(args); return { planted: 3 }; } },
    getAccountIdFromRequest: req => req.accountId,
    canAccessAccount: req => req.allowed,
    sendProviderError: (res, error) => res.status(500).json({ error: error.message }),
  });
  for (const [req, expected] of [
    [{}, 400],
    [{ accountId: 'a', allowed: false }, 403],
    [{ accountId: 'a', allowed: true, body: { seedIds: [] } }, 400],
    [{ accountId: 'a', allowed: true, body: { seedIds: [1, 1] } }, 200],
  ]) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await routes.get('/api/farm/plant-bag')(req, res);
    assert.equal(res.code, expected);
  }
  assert.deepEqual(calls, [['a', [1]]]);
});

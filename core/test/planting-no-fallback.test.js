const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ fallback = 'none', count = 0, bagError = false } = {}) {
  const calls = [];
  const module = { exports: {} };
  const seeds = count ? [{ seedId: 20002, name: '种子', count, plantSize: 1 }] : [];
  const modules = {
    '../utils/network': { getUserState: () => ({ accountId: 'bag-only', level: 10 }) },
    '../utils/utils': { toNum: Number, log() {}, logWarn() {} },
    '../models/store': {
      getOnlyPlant2x2: () => false, getPrioritize2x2Crops: () => false,
      getPlantingStrategy: () => 'bag_priority', getPrioritizeGrowthTasks: () => false,
      getBagSeedFallbackStrategy: () => fallback,
      syncBagSeedPriority: () => ({ seeds, priority: seeds.map(seed => seed.seedId) }),
    },
    './warehouse': { getBagSeeds: async () => {
      if (bagError) throw new Error('bag unavailable');
      return seeds;
    } },
    './farm-api': {
      getSeedShopId: async () => { calls.push('shop'); return 1; },
      getShopInfo: async () => ({ goods_list: [] }),
    },
    './farm-land-analyzer': { buildLandMap: lands => new Map(lands.map(land => [land.id, land])) },
    './farm-fertilizer': { runFertilizerByConfig: async ids => calls.push(['fertilize', ...ids]) },
  };
  // Keep bag selection and orchestration real; replace the protocol boundary with a fixed result.
  const source = fs.readFileSync(require.resolve('../src/services/planting-service'), 'utf8');
  vm.runInNewContext(`${source}\nplantSeeds = mockPlantSeeds;`, {
    module, process, require: name => modules[name] || {},
    mockPlantSeeds: async (seedId, ids, { maxPlantCount }) => {
      const plantedIds = ids.slice(0, maxPlantCount);
      calls.push(['plant', seedId, ...plantedIds]);
      return { planted: plantedIds.length, plantedLandIds: plantedIds, occupiedLandIds: plantedIds };
    },
  });
  return { calls, run: () => module.exports.autoPlantEmptyLands([], [1, 2, 3]) };
}

test('disabled fallback leaves empty land without querying the shop when the bag is empty', async () => {
  const f = fixture();
  assert.equal((await f.run()).plantedCount, 0);
  assert.deepEqual(f.calls, []);
});

test('disabled fallback plants available bag seeds and fertilizes them, leaving remaining land empty', async () => {
  const f = fixture({ count: 1 });
  const result = await f.run();
  assert.equal(result.plantedCount, 1);
  assert.equal(result.occupiedCount, 1);
  assert.deepEqual(f.calls, [['plant', 20002, 1], ['fertilize', 1]]);
});

test('configured shop fallback still runs when bag seeds are exhausted', async () => {
  const f = fixture({ fallback: 'level', count: 1 });
  assert.equal((await f.run()).plantedCount, 1);
  assert.deepEqual(f.calls, [['plant', 20002, 1], 'shop', ['fertilize', 1]]);
});

test('bag read failures never trigger shop fallback', async () => {
  const f = fixture({ fallback: 'level', bagError: true });
  assert.equal((await f.run()).plantedCount, 0);
  assert.deepEqual(f.calls, []);
});

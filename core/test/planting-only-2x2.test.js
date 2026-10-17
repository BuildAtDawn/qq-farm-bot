const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ seeds = [], bagError = false, removeError = false, plantError = false, level = 1 } = {}) {
  const calls = [];
  const module = { exports: {} };
  const modules = {
    '../utils/network': { getUserState: () => ({ accountId: 'only', level }) },
    '../utils/proto': {},
    '../utils/utils': { toNum: Number, toTimeSec: Number, getServerTimeSec: () => 1000,
      log() {}, logWarn() {}, sleep: async () => {} },
    '../utils/bag-seed-order': { compareBagSeedGameOrder: (a, b) => a.seedId - b.seedId },
    '../config/gameConfig': { getPlantBySeedId: () => ({ size: 2 }), getPlantById: () => ({ seasons: 1 }), getPlantGrowTime: () => 100 },
    '../models/store': { getOnlyPlant2x2: () => true, getPrioritize2x2Crops: () => false,
      getPlantingStrategy: () => 'task_priority', getPrioritizeGrowthTasks: () => true },
    './warehouse': { getBagSeeds: async () => {
      calls.push(['bag']);
      if (bagError) throw new Error('bag unavailable');
      return seeds;
    } },
    './farm-api': {
      removePlant: async ids => {
        calls.push(['remove', ...ids]);
        if (removeError) throw new Error('remove failed');
      },
      plantSeed: async (seedId, ids) => {
        calls.push(['plant', seedId, ...ids]);
        if (plantError) throw new Error('plant failed');
        const [master, ...slaves] = ids;
        return { land: [{ id: master, land_size: 2, slave_land_ids: slaves },
          ...slaves.map(id => ({ id, master_land_id: master }))] };
      },
      getShopInfo: async () => { throw new Error('must not query shop'); },
      buyGoods: async () => { throw new Error('must not buy seeds'); },
    },
    './farm-land-analyzer': { buildLandMap: lands => new Map(lands.map(land => [land.id, land])) },
    './farm-fertilizer': { runFertilizerByConfig: async ids => calls.push(['fertilize', ...ids]) },
  };
  const source = fs.readFileSync(require.resolve('../src/services/planting-service'), 'utf8');
  vm.runInNewContext(source, { module, require: name => {
    if (name === './task' || name === './growth-planting') throw new Error('must not plant task crops');
    return modules[name] || {};
  }, process, Date, Set, Map });
  return { service: module.exports, calls };
}

const size2Seed = { seedId: 29004, name: '2x2', plantSize: 2, count: 1, requiredLevel: 200 };
const lands = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, unlocked: true, level: 1 }));

test('exclusive mode plants bag 2x2 despite both ordinary priorities and 2x2 priority being disabled', async () => {
  const f = fixture({ seeds: [size2Seed, { seedId: 1, count: 100, plantSize: 1 }] });
  const result = await f.service.autoPlantEmptyLands([], lands.map(land => land.id), lands);
  assert.equal(result.plantedCount, 1);
  assert.equal(result.occupiedCount, 4);
  assert.deepEqual(f.calls, [['bag'], ['plant', 29004, 5, 6, 1, 2], ['fertilize', 5]]);
});

test('no bag 2x2, depleted seeds, ordinary seeds or bag read failure never falls back', async () => {
  for (const options of [{}, { seeds: [{ ...size2Seed, count: 0 }] },
    { seeds: [{ ...size2Seed, plantSize: 1 }] }, { bagError: true }]) {
    const f = fixture(options);
    const result = await f.service.autoPlantEmptyLands([], [1, 2, 5, 6], lands);
    assert.equal(result.plantedCount, 0);
    assert.deepEqual(f.calls, [['bag']]);
  }
});

test('no empty land ends the planting round before reading the bag', async () => {
  const f = fixture({ seeds: [size2Seed] });
  assert.equal((await f.service.autoPlantEmptyLands([], [], lands)).plantedCount, 0);
  assert.deepEqual(f.calls, []);
});

test('fragmented land does not trigger any planting or normal fallback', async () => {
  const f = fixture({ seeds: [size2Seed] });
  assert.equal((await f.service.autoPlantEmptyLands([], [1, 3, 5, 7], lands)).plantedCount, 0);
  assert.deepEqual(f.calls, [['bag']]);
});

test('ready groups are planted even when a higher grade group is still occupied', async () => {
  const f = fixture({ seeds: [size2Seed] });
  const snapshot = lands.map(land => land.id === 7 ? { ...land, level: 5 } : land);
  assert.equal((await f.service.autoPlantEmptyLands([], [1, 2, 5, 6], snapshot)).plantedCount, 1);
  assert.deepEqual(f.calls[1], ['plant', 29004, 5, 6, 1, 2]);
});

test('normal levels remain locked and level 200+ seeds keep their local exemption', async () => {
  for (const [requiredLevel, userLevel, expected] of [[31, 30, 0], [31, 31, 1], [199, 198, 0], [199, 199, 1], [200, 1, 1], [201, 1, 1]]) {
    const f = fixture({ seeds: [{ ...size2Seed, requiredLevel }], level: userLevel });
    const result = await f.service.autoPlantEmptyLands([], [1, 2, 5, 6], lands);
    assert.equal(result.plantedCount, expected, `${requiredLevel}/${userLevel}`);
  }
});

test('failed dead crop removal leaves the footprint occupied and cannot trigger planting', async () => {
  const f = fixture({ seeds: [size2Seed], removeError: true });
  const snapshot = lands.map(land => land.id === 5 ? { ...land, slave_land_ids: [1, 2, 6] } : land);
  const result = await f.service.autoPlantEmptyLands([5], [], snapshot);
  assert.equal(result.removedCount, 0);
  assert.equal(result.plantedCount, 0);
  assert.deepEqual(f.calls, [['remove', 5]]);
});

test('successful removal releases the old merged footprint and replants it in the same round', async () => {
  const f = fixture({ seeds: [size2Seed] });
  const snapshot = lands.map(land => land.id === 5 ? { ...land, slave_land_ids: [1, 2, 6] } : land);
  const result = await f.service.autoPlantEmptyLands([5], [], snapshot);
  assert.equal(result.removedCount, 1);
  assert.equal(result.plantedCount, 1);
  assert.deepEqual(f.calls, [['remove', 5], ['bag'], ['plant', 29004, 5, 6, 1, 2], ['fertilize', 5]]);
});

test('failed 2x2 planting never switches to ordinary seeds or purchases', async () => {
  const f = fixture({ seeds: [size2Seed], plantError: true });
  assert.equal((await f.service.autoPlantEmptyLands([], [1, 2, 5, 6], lands)).plantedCount, 0);
  assert.deepEqual(f.calls, [['bag'], ['plant', 29004, 5, 6, 1, 2]]);
});

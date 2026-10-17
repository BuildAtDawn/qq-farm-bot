const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-fertilizer-2x2-'));
process.env.FARM_DATA_DIR = dataDir;
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const store = require('../src/models/store');
const analyzer = require('../src/services/farm-land-analyzer');
const { conflictingAutomation, setMutationTestActive } = require('../src/services/mutation-test-state');

const NORMAL = 1011;
const ORGANIC = 1012;
const now = 2000000000;

function load(relative, mocks) {
  const filename = path.join(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console,
    require: name => mocks[name] || realRequire(name),
  }, { filename });
  return module.exports;
}

function land(id = 1, size = 2, options = {}) {
  return {
    id, unlocked: true, level: 3,
    plant: { id: size === 2 ? 1029003 : 999999999, season: 1, left_inorc_fert_times: 1,
      phases: [{ phase: 2, begin_time: now - 10 }, { phase: 6, begin_time: now + 10000 }] },
    ...options,
  };
}

function mature(raw) {
  return { ...raw, plant: { ...raw.plant, phases: [{ phase: 6, begin_time: now }] } };
}

function fixture(lands = [land(), land(5, 1)], automation = {}, onFertilize) {
  const auto = { fertilizer: 'smart_normal', fertilizer_2x2_ripen: true, fertilizer_smart_seconds: 300, ...automation };
  const calls = [];
  const stats = [];
  const warnings = [];
  const delays = [];
  const remaining = new Map();
  const api = {
    NORMAL_FERTILIZER_ID: NORMAL, ORGANIC_FERTILIZER_ID: ORGANIC,
    getAllLands: async () => ({ lands }),
    fertilizeOne: async (id, fertilizerId) => {
      calls.push([id, fertilizerId]);
      const raw = lands.find(item => item.id === id);
      const custom = await onFertilize?.(id, fertilizerId, raw, auto);
      if (custom) return custom;
      if (analyzer.getCurrentPhase(raw.plant.phases, false, '', raw.plant.id)?.phase === 6) {
        throw new Error('already mature');
      }
      let updated = { ...raw, plant: { ...raw.plant } };
      if (fertilizerId === NORMAL) {
        updated.plant.left_inorc_fert_times = 0;
      } else {
        const passes = (remaining.get(id) ?? 2) - 1;
        remaining.set(id, passes);
        updated = passes === 0 ? mature(updated) : {
          ...updated, plant: { ...updated.plant,
            phases: [{ phase: 2, begin_time: now - 10 }, { phase: 6, begin_time: now + 5000 }] },
        };
      }
      lands = lands.map(item => item.id === id ? updated : item);
      return { land: [updated], fertilizer: { count: 100000 } };
    },
    fertilize: async (ids, fertilizerId) => {
      let count = 0;
      for (const id of ids) {
        try { await api.fertilizeOne(id, fertilizerId); count++; } catch {}
      }
      return count;
    },
  };
  const service = load('../src/services/farm-fertilizer.js', {
    '../models/store': {
      getAutomation: () => auto,
      getSystemSettings: () => ({ organicFertilizerDelayMinMs: 200, organicFertilizerDelayMaxMs: 300 }),
    },
    '../utils/utils': {
      toNum: value => Number(value) || 0, toTimeSec: value => Number(value) || 0,
      getServerTimeSec: () => now, log() {}, logWarn: (...args) => warnings.push(args),
      randomDelay: async (...args) => delays.push(args),
    },
    './farm-api': api,
    './stats': { recordOperation: (...args) => stats.push(args) },
  });
  return { service, auto, calls, stats, warnings, delays };
}

test('default-off configuration persists per account and survives a process reload', () => {
  assert.equal(store.getDefaultAccountConfig().automation.fertilizer_2x2_ripen, false);
  store.applyConfigSnapshot({}, { accountId: 'a' });
  store.applyConfigSnapshot({}, { accountId: 'b' });
  store.setAutomation('fertilizer_2x2_ripen', true, 'a');
  assert.equal(store.getAutomation('a').fertilizer_2x2_ripen, true);
  assert.equal(store.getAutomation('b').fertilizer_2x2_ripen, false);
  assert.equal(store.getConfigSnapshot('a').automation.fertilizer_2x2_ripen, true);
  const reloaded = spawnSync(process.execPath, ['-e',
    `process.stdout.write(JSON.stringify(require(${JSON.stringify(require.resolve('../src/models/store'))}).getAutomation('a').fertilizer_2x2_ripen))`,
  ], { env: { ...process.env, FARM_DATA_DIR: dataDir }, encoding: 'utf8' });
  assert.equal(reloaded.status, 0, reloaded.stderr);
  assert.equal(JSON.parse(reloaded.stdout), true);
  store.setAutomation('fertilizer_2x2_ripen', false, 'a');
  assert.equal(store.getAutomation('a').fertilizer_2x2_ripen, false);
});

test('2x2 always takes normal plus full organic ripening, leaving single-grid crops on their strategy', async () => {
  for (const fertilizer of ['none', 'normal', 'organic', 'both', 'smart', 'smart_only', 'smart_normal', 'final_normal', 'final_organic']) {
    const f = fixture(undefined, { fertilizer });
    const result = await f.service.runFertilizerByConfig([1, 5]);
    assert.deepEqual(f.calls.filter(([id]) => id === 1), [[1, NORMAL], [1, ORGANIC], [1, ORGANIC]], fertilizer);
    assert.equal(result.organic >= 2, true);
    if (['none', 'smart_only', 'smart_normal', 'final_normal', 'final_organic'].includes(fertilizer)) {
      assert.equal(f.calls.some(([id]) => id === 5), false, fertilizer);
    } else if (['normal', 'smart'].includes(fertilizer)) {
      assert.deepEqual(f.calls.filter(([id]) => id === 5), [[5, NORMAL]], fertilizer);
    }
  }
});

test('disabled override retains the selected strategy and makes no full-ripening calls', async () => {
  for (const fertilizer of ['none', 'normal', 'smart_normal']) {
    const f = fixture(undefined, { fertilizer, fertilizer_2x2_ripen: false });
    await f.service.runFertilizerByConfig([1, 5]);
    assert.deepEqual(f.calls, fertilizer === 'normal' ? [[1, NORMAL], [5, NORMAL]] : []);
  }
});

test('periodic checks ripen pre-existing 2x2 crops even with none/normal, despite skipNormal', async () => {
  for (const fertilizer of ['none', 'normal']) {
    const f = fixture(undefined, { fertilizer });
    const result = await f.service.runFertilizerByConfig([], { skipNormal: true });
    assert.equal(result.normal, 1);
    assert.equal(result.organic, 2);
    assert.deepEqual(f.calls, [[1, NORMAL], [1, ORGANIC], [1, ORGANIC]]);
    assert.deepEqual(f.stats, [['fertilize', 3]]);
    assert.deepEqual(f.delays, [[200, 300]]);
  }
});

test('size is confirmed from config or four occupied lands, never from land level alone', async () => {
  const master = land(1, 1, { slave_land_ids: [2, 3, 4] });
  const slaves = [2, 3, 4].map(id => land(id, 1, { master_land_id: 1 }));
  const f = fixture([master, ...slaves, land(5, 1, { level: 5 })], { fertilizer: 'none' });
  await f.service.runFertilizerByConfig([1, 2, 3, 4, 5, 1]);
  assert.deepEqual(f.calls, [[1, NORMAL], [1, ORGANIC], [1, ORGANIC]]);
});

test('scope, explicit IDs, locked/empty/dead/mature crops and occupied slaves remain protected', async () => {
  const dead = land(6);
  dead.plant.phases = [{ phase: 7, begin_time: now }];
  const lands = [
    land(1, 2, { level: 3 }), land(2, 2, { level: 5 }),
    mature(land(3, 2, { level: 5 })), land(4, 2, { unlocked: false, level: 5 }),
    land(5, 2, { plant: null, level: 5 }), dead,
    land(7, 2, { master_land_id: 99, level: 5 }),
  ];
  const f = fixture(lands, { fertilizer: 'none', fertilizer_land_types: ['purple'] });
  await f.service.runFertilizerByConfig();
  assert.deepEqual(f.calls, [[2, NORMAL], [2, ORGANIC], [2, ORGANIC]]);
  const emptyScope = fixture(undefined, { fertilizer_land_types: [] });
  await emptyScope.service.runFertilizerByConfig();
  assert.deepEqual(emptyScope.calls, []);
  const explicit = fixture([land(1), land(2)], { fertilizer: 'none' });
  await explicit.service.runFertilizerByConfig([2]);
  assert.deepEqual(explicit.calls, [[2, NORMAL], [2, ORGANIC], [2, ORGANIC]]);
});

test('subsequent seasons override final-normal skip, and spent normal applications still allow organic', async () => {
  const raw = land();
  raw.plant.left_inorc_fert_times = 0;
  raw.plant.season = 2;
  const f = fixture([raw], { fertilizer: 'final_normal' });
  const result = await f.service.runFertilizerByConfig([1], { reason: 'multi_season' });
  assert.deepEqual(f.calls, [[1, ORGANIC], [1, ORGANIC]]);
  assert.equal(result.normal, 0);
  assert.equal(result.organic, 2);
});

test('organic failure on one master does not prevent another master from ripening', async () => {
  const f = fixture([land(1), land(2)], { fertilizer: 'none' }, (id, fertilizerId) => {
    if (id === 1 && fertilizerId === ORGANIC) throw new Error('fixture rejected');
  });
  const result = await f.service.runFertilizerByConfig();
  assert.deepEqual(f.calls, [[1, NORMAL], [2, NORMAL], [1, ORGANIC], [2, ORGANIC], [2, ORGANIC]]);
  assert.equal(result.organic, 2);
  assert.equal(f.warnings.length, 1);
});

test('missing snapshots, no progress, depleted inventory and disabled switch stop organic loops', async () => {
  for (const type of ['missing', 'stalled', 'depleted', 'disabled']) {
    const f = fixture([land()], { fertilizer: 'none' }, (_id, fertilizerId, raw, auto) => {
      if (fertilizerId !== ORGANIC) return;
      if (type === 'missing') return {};
      if (type === 'disabled') auto.fertilizer_2x2_ripen = false;
      return { land: [raw], fertilizer: { count: type === 'depleted' ? 0 : 1000 } };
    });
    await f.service.runFertilizerByConfig();
    assert.equal(f.calls.filter(([, id]) => id === ORGANIC).length, type === 'stalled' ? 2 : 1, type);
  }
});

test('2x2-only automation conflicts with mutation testing, including persisted config changes', () => {
  assert.equal(conflictingAutomation({ farm: false, fertilizer: 'none', fertilizer_2x2_ripen: true }), true);
  store.applyConfigSnapshot({ automation: { farm: false, land_upgrade: false, fertilizer: 'none' } }, { accountId: 'mutation' });
  setMutationTestActive('mutation', true);
  try {
    assert.throws(() => store.setAutomation('fertilizer_2x2_ripen', true, 'mutation'), /测变异运行中/);
    assert.equal(store.getAutomation('mutation').fertilizer_2x2_ripen, false);
  } finally { setMutationTestActive('mutation', false); }
});

test('farm rounds check 2x2 ripening with none/normal strategies only when the override is enabled', async () => {
  for (const fertilizer of ['none', 'normal']) {
    for (const enabled of [false, true]) {
      const calls = [];
      const auto = { farm: true, fertilizer, fertilizer_2x2_ripen: enabled };
      const empty = { harvestable: [], needWater: [], needWeed: [], needBug: [], needGoldenBug: [],
        dead: [], empty: [], unlockable: [], upgradable: [], growing: [1] };
      const farm = load('../src/services/farming-orchestrator.js', {
        '../utils/network': { getUserState: () => ({ gid: 1 }), isConnected: () => true,
          networkEvents: { emit() {} } },
        '../utils/utils': { toNum: Number, log() {}, logWarn() {} },
        '../models/store': { getAutomation: () => auto, isAutomationOn: key => !!auto[key], getPrioritize2x2Crops: () => false },
        './farm-api': { getAllLands: async () => ({ lands: [land()] }) },
        './farm-land-analyzer': { analyzeLands: () => empty },
        './capital-mode': { prepareForFarmOperation: async () => {} },
        './farm-fertilizer': { runFertilizerByConfig: async (...args) => {
          calls.push(args); return { normal: 1, organic: 2 };
        } },
      });
      assert.equal(await farm.checkFarm(), enabled);
      assert.equal(calls.length, enabled ? 1 : 0);
      if (enabled) {
        assert.equal(calls[0][0].length, 0);
        assert.equal(calls[0][1].skipNormal, true);
      }
    }
  }
});

test('enabling only 2x2 ripening schedules a post-save check and still respects login readiness', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
  const block = source.slice(source.indexOf('// 施肥策略变化'), source.indexOf('// 好友捣乱从关变开'));
  assert.ok(block.includes('size2RipenEnabled'));
  for (const enabled of [false, true]) {
    const tasks = [];
    const calls = [];
    const context = vm.createContext({
      prevAuto: { fertilizer: 'none', fertilizer_2x2_ripen: false },
      newAuto: { fertilizer: 'none', fertilizer_2x2_ripen: enabled },
      workerScheduler: { setTimeoutTask: (...args) => tasks.push(args) },
      loginReady: false, log() {},
      runFertilizerByConfig: async (...args) => calls.push(args),
    });
    vm.runInContext(block, context);
    assert.equal(tasks.length, enabled ? 1 : 0);
    if (!enabled) continue;
    await tasks[0][2]();
    assert.equal(calls.length, 0);
    context.loginReady = true;
    await tasks[0][2]();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].skipNormal, true);
  }
});

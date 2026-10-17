const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-integration-'));
process.env.FARM_DATA_DIR = dir;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { getMutationRepository } = require('../src/services/mutation-records');
const recorder = require('../src/services/mutation-recorder');
const { createOperationGate } = require('../src/services/mutation-operation-gate');
let fixtureId = 0;
const growing = (id = 1) => ({ id, unlocked: true, plant: { id: 1020001, season: 1,
  phases: [{ phase: 2, begin_time: 100 }, { phase: 2, begin_time: 200 }, { phase: 6, begin_time: 300 }],
  mutant_config_ids: [] } });
const mature = (id = 1, mutants = [1, 5]) => ({ id, unlocked: true, plant: { id: 1020001, season: 1,
  phases: [{ phase: 6, begin_time: 250, mutants: [{ mutant_config_id: 8 }] }], mutant_config_ids: mutants } });

function load(relative, mocks) {
  const filename = path.join(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process, console,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name),
  }, { filename });
  return module.exports;
}
function fixture() {
  const accountId = `account-${++fixtureId}`;
  let lands = [{ id: 1, unlocked: true }];
  let beforeRead = null;
  let duringHarvest = null;
  let failHarvest = false;
  let plantLand = growing();
  let fertilizerReply = null;
  let fertilizerError = null;
  const calls = [];
  const payloads = [];
  const gate = createOperationGate();
  const codec = { create: data => data, encode: data => ({ finish: () => data }), decode: data => data };
  const api = load('../src/services/farm-api.js', {
    '../utils/network': {
      getUserState: () => ({ accountId, gid: 1 }),
      sendMsgAsync: async (_service, method, payload) => {
        calls.push(method);
        payloads.push({ method, payload });
        if (method === 'AllLands') { await beforeRead?.(); return { body: { lands } }; }
        if (method === 'Plant') { lands = [plantLand]; return { body: { land: lands } }; }
        if (method === 'Fertilize') {
          if (fertilizerError) throw new Error(fertilizerError);
          lands = fertilizerReply?.land || [mature()];
          return { body: fertilizerReply || { land: lands, fertilizer: { count: 1000 } } };
        }
        if (method === 'Harvest') {
          await duringHarvest?.();
          if (failHarvest) throw new Error('请求超时');
          lands = [{ id: 1, unlocked: true }];
          return { body: { land: lands } };
        }
        if (method === 'RemovePlant') { lands = [{ id: 1, unlocked: true }]; return { body: { land: lands } }; }
        return { body: payload };
      },
    },
    '../utils/proto': { types: new Proxy({}, { get: () => codec }) },
    '../utils/utils': { toLong: Number, toNum: Number, sleep: async () => {}, logWarn: () => {} },
    './mutation-operation-gate': { farmOperationGate: gate, guardFarmOperation: fn => (...args) => gate.operation(() => fn(...args)) },
  });
  return {
    api, gate, calls, payloads, accountId, repository: getMutationRepository(accountId),
    setLands: value => { lands = value; },
    onRead: fn => { beforeRead = fn; },
    onHarvest: fn => { duringHarvest = fn; },
    failHarvest: () => { failHarvest = true; },
    plantLand: value => { plantLand = value; },
    fertilizerReply: value => { fertilizerReply = value; },
    fertilizerError: value => { fertilizerError = value; },
  };
}

test('ordinary system planting inserts immediately and harvest updates the same row with both mutation fields', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  const row = f.repository.list().rows[0];
  assert.equal(row.status, 'growing');
  assert.equal(row.source, 'system');
  f.setLands([mature()]);
  await f.api.harvest([1]);
  const finished = f.repository.list().rows[0];
  assert.equal(finished.id, row.id);
  assert.equal(finished.status, 'harvested');
  assert.equal(finished.mutationCount, 3);
  assert.deepEqual(finished.mutations.map(item => item.id), [1, 5, 8]);
});

test('real crop configuration is frozen at planting and shared batch fertilizer records before/after stages and consumption', async () => {
  const f = fixture();
  const first = growing();
  first.plant.id = 1020002;
  f.plantLand(first);
  await f.api.plantSeed(20002, [1]);
  const planted = f.repository.list().rows[0];
  assert.equal(planted.plantId, 1020002);
  assert.equal(planted.totalStages, 3);
  assert.deepEqual(planted.stagePlan.map(p => p.name), ['种子', '发芽', '成熟']);
  assert.equal(f.repository.list({ view: 'stages', all: true }).rows[0].checked, true);
  const after = growing();
  after.plant.id = 1020002;
  after.plant.phases.shift();
  after.plant.mutant_config_ids = [1];
  after.plant.phases[0].mutants = [{ mutant_config_id: 1, mutant_time: 190, weather_id: 4 }];
  f.fertilizerReply({ land: [after], fertilizer_use: { consumed: { id: 1012, count: 60 } }, fertilizer: { count: 900 } });
  assert.equal(await f.api.fertilize([1], 1012), 1);
  const found = f.repository.list({ view: 'discoveries' }).rows[0];
  assert.equal(found.stage, 2);
  assert.equal(found.serverMutationAt, 190000);
  assert.equal(found.weatherId, 4);
  assert.equal(found.source, 'fertilizer_after');
  const action = f.repository.list({ view: 'operations' }).rows[0];
  assert.equal(action.beforeStage, 1);
  assert.equal(action.afterStage, 2);
  assert.equal(action.consumedSeconds, 60);
  assert.equal(action.remainingSeconds, 900);
  assert.equal(action.quality, 'known');
  assert.equal(action.id, found.operationId);
  f.fertilizerError('fixture request timeout');
  await assert.rejects(f.api.fertilizeOne(1, 1012), /fixture request timeout/);
  const failed = f.repository.list({ view: 'operations' }).rows.find(r => r.error);
  assert.equal(failed.status, 'unknown');
  assert.equal(failed.consumedSeconds, null);
});

test('missing fertilizer reply snapshots are marked incomplete; strict tests stop and ordinary operations retain success', async () => {
  for (const strict of [false, true]) {
    const f = fixture();
    const first = growing();
    first.plant.id = 1020002;
    f.plantLand(first);
    await f.api.plantSeed(20002, [1]);
    f.fertilizerReply({ fertilizer: { count: 500 } });
    if (strict) await assert.rejects(f.api.fertilizeOne(1, 1012, { strict }), /快照不完整/);
    else assert.ok(await f.api.fertilizeOne(1, 1012));
    const action = f.repository.list({ view: 'operations' }).rows[0];
    assert.equal(action.afterStage, null);
    assert.equal(action.quality, 'after_missing');
    assert.equal(action.consumedSeconds, null);
    assert.equal(f.repository.list({ view: 'discoveries' }).total, 0);
  }
});

test('a fertilizer pre-read never attributes another land mutation to the target operation', async () => {
  const f = fixture();
  const first = growing(1);
  const second = growing(2);
  first.plant.id = second.plant.id = 1020002;
  f.plantLand(first);
  await f.api.plantSeed(20002, [1]);
  recorder.recordPlanting(f.accountId, 20002, { land: [second] }, {}, [2]);
  second.plant.mutant_config_ids = [5];
  f.setLands([first, second]);
  f.fertilizerReply({ land: [first] });
  await f.api.fertilizeOne(1, 1012);
  const other = f.repository.list({ view: 'discoveries' }).rows[0];
  assert.equal(other.landId, 2);
  assert.equal(other.source, 'lands');
  assert.equal(other.operationId, '');
});

test('batch fertilizer sends all IDs in one RPC and keeps aggregate consumption out of per-land totals', async () => {
  const f = fixture();
  const first = growing(1);
  const second = growing(2);
  const third = growing(3);
  for (const raw of [first, second, third]) raw.plant.id = 1020002;
  f.plantLand(first);
  await f.api.plantSeed(20002, [1]);
  recorder.recordPlanting(f.accountId, 20002, { land: [second, third] }, {}, [2, 3]);
  f.setLands([first, second, third]);
  const after = [first, second, third].map(raw => ({ ...raw, plant: { ...raw.plant,
    phases: raw.plant.phases.slice(1), mutant_config_ids: [5] } }));
  f.fertilizerReply({ land: after, fertilizer_use: { consumed: { id: 1012, count: 120 } }, fertilizer: { count: 880 } });
  await f.api.fertilizeBatch([1, 2, 1], 1012);
  const requests = f.payloads.filter(item => item.method === 'Fertilize');
  assert.equal(requests.length, 1);
  assert.deepEqual(Array.from(requests[0].payload.land_ids), [1, 2]);
  assert.equal(requests[0].payload.fertilizer_id, 1012);
  const actions = f.repository.list({ view: 'operations', all: true }).rows;
  assert.equal(actions.length, 2);
  assert.equal(actions[0].batchId, actions[1].batchId);
  for (const action of actions) {
    assert.deepEqual(Array.from(action.batchLandIds), [1, 2]);
    assert.equal(action.batchConsumedSeconds, 120);
    assert.equal(action.consumedSeconds, null);
    assert.equal(action.beforeStage, 1);
    assert.equal(action.afterStage, 2);
    assert.equal(action.quality, 'known');
    assert.equal(action.remainingSeconds, 880);
  }
  const found = f.repository.list({ view: 'discoveries', all: true }).rows;
  assert.deepEqual(found.map(item => item.landId).sort(), [1, 2]);
  for (const discovery of found)
    assert.equal(discovery.operationId, actions.find(action => action.landId === discovery.landId).id);
});

test('batch adapter reuses a validated snapshot and rejects invalid IDs before sending requests', async () => {
  const f = fixture();
  const first = growing();
  const second = growing(2);
  f.fertilizerReply({ land: [mature(), mature(2)] });
  await f.api.fertilizeBatch([1, 2], 1011, { beforeSnapshot: { lands: [first, second] } });
  assert.deepEqual(f.calls, ['Fertilize']);
  for (const ids of [[], [0], [-1], [1.1], [Number.MAX_SAFE_INTEGER + 1], null])
    await assert.rejects(() => f.api.fertilizeBatch(ids, 1011), /无效/);
  assert.equal(f.calls.length, 1);
});

test('batch cancellation or validation failure sends no fertilizer and releases the operation gate', async () => {
  const f = fixture();
  f.plantLand(growing());
  await f.api.plantSeed(20001, [1]);
  const token = f.gate.acquire();
  f.onRead(() => { token.cancelled = true; });
  try {
    await assert.rejects(() => f.gate.run(token, () => f.api.fertilizeBatch([1, 2], 1012)), /已停止/);
    assert.equal(f.calls.includes('Fertilize'), false);
  } finally { f.gate.release(token); }
  f.onRead(null);
  await assert.rejects(() => f.api.fertilizeBatch([1, 2], 1012, {
    validateBeforeSend() { throw new Error('phase boundary passed'); }
  }), /phase boundary/);
  assert.equal(f.calls.includes('Fertilize'), false);
  const nextToken = f.gate.acquire();
  f.gate.release(nextToken);
});

test('a partial batch reply records the missing land as unknown instead of fabricating its stage', async () => {
  const f = fixture();
  const first = growing(1);
  const second = growing(2);
  for (const raw of [first, second]) raw.plant.id = 1020002;
  f.plantLand(first);
  await f.api.plantSeed(20002, [1]);
  recorder.recordPlanting(f.accountId, 20002, { land: [second] }, {}, [2]);
  f.setLands([first, second]);
  f.fertilizerReply({ land: [{ ...first, plant: { ...first.plant, phases: first.plant.phases.slice(1) } }],
    fertilizer_use: { consumed: { id: 1011, count: 60 } } });
  await f.api.fertilizeBatch([1, 2], 1011);
  const actions = f.repository.list({ view: 'operations', all: true }).rows;
  const omitted = actions.find(action => action.landId === 2);
  assert.equal(omitted.status, 'unknown');
  assert.equal(omitted.afterStage, null);
  assert.equal(omitted.quality, 'after_missing');
  assert.equal(omitted.consumedSeconds, null);
  assert.equal(f.calls.filter(method => method === 'Fertilize').length, 1);
});

test('cancelling during a fertilizer pre-read sends no fertilizer request and settles the gate', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  const token = f.gate.acquire();
  f.onRead(() => { token.cancelled = true; });
  try {
    await assert.rejects(f.gate.run(token, () => f.api.fertilizeOne(1, 1012)), /已停止/);
    assert.equal(f.calls.includes('Fertilize'), false);
    assert.equal(f.repository.list({ view: 'operations' }).rows[0].status, 'not_sent');
  } finally { f.gate.release(token); }
});

test('clear rejects active mutation tests, then drops pending harvest results without restoring deleted rows', async () => {
  const f = fixture();
  const { farmOperationGate } = require('../src/services/mutation-operation-gate');
  await f.api.plantSeed(20001, [1]);
  const token = farmOperationGate.acquire();
  try {
    assert.throws(() => recorder.clearMutationRecords(f.accountId), /测变异运行中/);
    assert.equal(f.repository.list().total, 1);
  } finally { farmOperationGate.release(token); }
  f.setLands([mature()]);
  f.onHarvest(() => {
    assert.equal(recorder.clearMutationRecords(f.accountId).deleted, 1);
  });
  await f.api.harvest([1]);
  assert.equal(f.repository.list().total, 0);
  await f.api.plantSeed(20001, [1]);
  assert.equal(f.repository.list().rows[0].id, 2);
});

test('shrinking phase suffix is normal growth, not a changed planting timestamp', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  const next = growing();
  next.plant.phases.shift();
  f.setLands([next]);
  await f.api.getAllLands();
  assert.equal(f.repository.list().rows[0].status, 'growing');
  f.setLands([mature()]);
  await f.api.harvest([1], { strict: true });
  assert.equal(f.repository.list().rows[0].status, 'harvested');
});

test('a reset to an earlier growth stage invalidates the old row without creating history', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  f.setLands([mature()]);
  await f.api.getAllLands();
  f.setLands([growing()]);
  await f.api.getAllLands();
  assert.equal(f.repository.list().rows[0].status, 'unknown');
  f.setLands([mature()]);
  await f.api.harvest([1]);
  assert.equal(f.repository.list().rows[0].mutationCount, null);
});

test('harvesting pre-existing crops is allowed but does not synthesize records', async () => {
  const f = fixture();
  f.setLands([mature()]);
  await f.api.harvest([1]);
  assert.equal(f.repository.list().total, 0);
});

test('in-flight harvest snapshots are protected from concurrent reads of the emptied land', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  f.setLands([mature()]);
  f.onHarvest(async () => {
    assert.equal(f.repository.list().rows[0].status, 'harvesting');
    f.setLands([{ id: 1, unlocked: true }]);
    await f.api.getAllLands();
  });
  await f.api.harvest([1], { strict: true });
  assert.equal(f.repository.list().rows[0].status, 'harvested');
});

test('uncertain harvest is unknown, never reported as zero mutations', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  f.setLands([mature()]);
  f.failHarvest();
  await assert.rejects(f.api.harvest([1]), /请求超时/);
  assert.equal(f.repository.list().rows[0].status, 'unknown');
  assert.equal(f.repository.list().rows[0].mutationCount, null);
});

test('stop during the pre-harvest read prevents sending the actual Harvest command', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  f.setLands([mature()]);
  const token = f.gate.acquire();
  f.onRead(async () => { token.cancelled = true; });
  await assert.rejects(f.gate.run(token, () => f.api.harvest([1], { strict: true })), /已停止/);
  assert.equal(f.calls.includes('Harvest'), false);
  f.gate.release(token);
});

test('normal remove and subsequent replant cannot finalize the removed row', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  await f.api.removePlant([1]);
  await f.api.plantSeed(20001, [1]);
  f.setLands([mature()]);
  await f.api.harvest([1]);
  assert.equal(f.repository.list({ status: 'removed' }).total, 1);
  assert.equal(f.repository.list({ status: 'harvested' }).rows[0].id, 2);
});

test('seed eligibility rejects 2x2, multiseason, unknown, locked levels; preserves >=200 exemption', async () => {
  const seeds = [1, 2, 3, 4, 5, 6].map(seedId => ({ seedId, count: 20, requiredLevel: seedId === 5 ? 31 : seedId === 6 ? 200 : 1 }));
  const service = load('../src/services/mutation-test.js', {
    '../utils/network': { getUserState: () => ({ level: 30 }) },
    './warehouse': { getBagSeeds: async () => seeds },
    '../config/gameConfig': { getPlantBySeedId: id => id === 4 ? null : { size: id === 2 ? 2 : 1, seasons: id === 3 ? 2 : 1 } },
  });
  const allowed = await service.getMutationTestSeeds();
  assert.deepEqual(Array.from(allowed.filter(item => item.supported), item => item.seedId), [1, 6]);
});

test('plant identity never treats the mutable current phase time as an instance ID', () => {
  assert.equal(recorder.plantIdentity(growing()), recorder.plantIdentity(mature()));
});

test('test runner, shared farm RPCs and durable records complete one real adapter cycle offline', async () => {
  const f = fixture();
  const messages = [];
  const service = load('../src/services/mutation-test.js', {
    '../utils/network': { getUserState: () => ({ accountId: f.accountId, gid: 1, level: 30 }), isConnected: () => true },
    '../models/store': { getAutomation: () => ({ farm: false, fertilizer: 'none' }), isAutomationOn: () => false },
    './warehouse': { getBagSeeds: async () => [{ seedId: 20001, count: 1, name: '白萝卜', requiredLevel: 1 }] },
    '../config/gameConfig': { getPlantBySeedId: () => ({ size: 1, seasons: 1 }) },
    './farm-api': f.api,
    './mutation-operation-gate': { farmOperationGate: f.gate },
  });
  const runner = service.initializeMutationTest(message => messages.push(message));
  await runner.start({ seedId: 20001, target: 1, delayMs: 0 });
  await runner.settled();
  assert.equal(runner.snapshot().status, 'completed', runner.snapshot().reason);
  assert.equal(runner.snapshot().harvested, 1);
  const row = f.repository.list().rows[0];
  assert.equal(row.source, 'test');
  assert.equal(row.testId, runner.snapshot().id);
  assert.equal(row.round, 1);
  assert.equal(row.status, 'harvested');
  assert.equal(row.mutationCount, 3);
  assert.equal(messages.at(-1).data.enabled, false);
  assert.equal(f.calls.filter(method => method === 'Plant').length, 1);
});

test('plant response snapshots cannot create spurious records for untargeted land', () => {
  const rows = recorder.recordPlanting('filtered-reply', 20001, { land: [growing(1), growing(2)] }, {}, [1]);
  assert.equal(rows.length, 1);
  assert.equal(getMutationRepository('filtered-reply').list().total, 1);
});

test('optional recording snapshot failure cannot block a normal historical harvest', async () => {
  const f = fixture();
  f.setLands([mature()]);
  f.onRead(async () => { throw new Error('读取超时'); });
  await f.api.harvest([1]);
  assert.ok(f.calls.includes('Harvest'));
  assert.equal(f.repository.list().total, 0);
});

test('strict test harvest aborts if its snapshot cannot be read', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  f.onRead(async () => { throw new Error('读取超时'); });
  await assert.rejects(f.api.harvest([1], { strict: true }), /读取超时/);
  assert.equal(f.calls.includes('Harvest'), false);
});

test('missing optional harvest snapshots mark tracked crops unknown instead of leaving a false growing row', async () => {
  const f = fixture();
  await f.api.plantSeed(20001, [1]);
  f.setLands([mature()]);
  f.onRead(async () => { throw new Error('读取超时'); });
  await f.api.harvest([1]);
  assert.equal(f.repository.list().rows[0].status, 'unknown');
  assert.equal(f.repository.list().rows[0].mutationCount, null);
});

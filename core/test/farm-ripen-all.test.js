const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createRequire } = require('node:module');

const now = 2000000000;
function load(relative, mocks) {
  const filename = path.join(__dirname, relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, Date,
    require: name => mocks[name] || localRequire(name)
  }, { filename });
  return module.exports;
}
const utils = { ...require('../src/utils/utils'), getServerTimeSec: () => now, log() {}, async randomDelay() {} };
const analyzer = load('../src/services/farm-land-analyzer.js', { '../utils/utils': utils });
function land(id = 1, count = 3, normal = 1) {
  return { id, unlocked: true, plant: { id: 999999999, season: 1, left_inorc_fert_times: normal,
    phases: Array.from({ length: count + 1 }, (_, index) => ({
      phase: index === count ? 6 : 2, phase_id: index === count ? 19 : 5 + index,
      begin_time: index === 0 ? now - 100 : now + index * 3600
    })) } };
}
function fixture(lands = [land()], extra = {}) {
  let snapshot = { lands };
  let inventory = [{ id: 1011, count: 1000000 }, { id: 1012, count: 1000000 }];
  let stale = null;
  const calls = [];
  let reads = 0;
  const service = load('../src/services/farm-ripen-all.js', {
    './farm-api': { NORMAL_FERTILIZER_ID: 1011, ORGANIC_FERTILIZER_ID: 1012,
      getAllLands: async () => {
        reads++;
        if (stale) {
          const previous = stale;
          if (!extra.alwaysStale) stale = null;
          return previous;
        }
        return snapshot;
      },
      fertilizeBatch: async (ids, fertilizerId, options = {}) => {
        calls.push([Array.from(ids), fertilizerId]);
        await extra.onSend?.();
        options.validateBeforeSend?.();
        if (extra.fail) throw new Error('fixture fertilizer failure');
        let consumed = 0;
        const updated = Array.from(ids, id => {
          const raw = snapshot.lands.find(item => item.id === id);
          const seconds = raw.plant.phases[1].begin_time - now;
          consumed += seconds;
          return extra.noProgress || extra.noProgressLandId === id ? raw : { ...raw, plant: { ...raw.plant,
            left_inorc_fert_times: fertilizerId === 1011 ? 0 : raw.plant.left_inorc_fert_times,
            phases: raw.plant.phases.slice(1).map(p => ({ ...p, begin_time: p.begin_time - seconds })) } };
        });
        if (extra.staleReads || extra.alwaysStale) stale = snapshot;
        snapshot = { lands: snapshot.lands.map(item => updated.find(land => land.id === item.id) || item) };
        inventory.find(item => item.id === fertilizerId).count -= consumed;
        return extra.missing ? {} : { land: extra.partial ? updated.slice(0, 1) : updated,
          fertilizer_use: { consumed: { id: fertilizerId, count: consumed } } };
      } },
    './warehouse': { getBag: async () => ({ items: inventory }), getBagItems: bag => bag.items },
    './farm-land-analyzer': analyzer,
    '../utils/utils': utils,
    '../models/store': { getSystemSettings: () => ({}) },
    './mutation-operation-gate': { guardFarmOperation: fn => fn },
  });
  return { service, calls, reads: () => reads, setSnapshot: value => { snapshot = value; },
    setInventory: value => { inventory = value; } };
}

test('preview estimates current and subsequent stage seconds, normal second and organic for all other stages', () => {
  const f = fixture();
  const multi = land(1, 4);
  const final = land(2, 1);
  const plan = f.service.buildRipenAllPlan({ lands: [multi, final] }, [
    { id: 1011, count: 7200 }, { id: 1012, count: 10800 }
  ], now);
  assert.deepEqual(Array.from(plan.targets[0].steps, step => step.type), ['organic', 'normal', 'organic', 'organic']);
  assert.deepEqual(Array.from(plan.targets[1].steps, step => step.type), ['normal']);
  assert.equal(plan.cost.normal, 7200);
  assert.equal(plan.cost.organic, 10800);
  assert.equal(plan.inventory.normal, 7200);
  assert.equal(plan.sufficient, true);
  assert.equal(f.calls.length, 0);
});

test('normal spent/unknown skips final stage and uses organic only for earlier stages', () => {
  const f = fixture();
  const unknown = land(3, 1);
  delete unknown.plant.left_inorc_fert_times;
  const plan = f.service.buildRipenAllPlan({ lands: [land(1, 3, 0), land(2, 1, 0), unknown] }, [], now);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.skipped.length, 2);
  assert.equal(plan.cost.normal, 0);
  assert.equal(plan.cost.organic, 10800);
  assert.equal(plan.sufficient, false);
});

test('preview excludes locked/empty/mature/dead and counts a 2x2 master only once', () => {
  const f = fixture();
  const master = { ...land(), slave_land_ids: [2, 3, 4] };
  const plan = f.service.buildRipenAllPlan({ lands: [master,
    { ...land(2), master_land_id: 1 }, land(3), land(4),
    { ...land(5), unlocked: false }, { id: 6, unlocked: true }, land(7, 0),
    { ...land(8), plant: { id: 1, phases: [{ phase: 7, begin_time: now }] } }
  ] }, [], now);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.cost.normal, 3600);
  assert.equal(plan.cost.organic, 7200);
});

test('partial current stage is charged only for its remainder; bad times are skipped', () => {
  const f = fixture();
  const raw = land();
  const plan = f.service.buildRipenAllPlan({ lands: [raw] }, [], now + 1800);
  assert.equal(plan.cost.organic, 5400);
  raw.plant.phases[1].begin_time = 0;
  assert.equal(f.service.buildRipenAllPlan({ lands: [raw] }, [], now).targets.length, 0);
  assert.throws(() => f.service.buildRipenAllPlan({}, [], now), /读取失败/);
});

test('confirmed steps execute organic, normal, organic and cannot replay a cursor or completed plan', async () => {
  const f = fixture();
  const p = await f.service.previewRipenAll();
  assert.equal(f.calls.length, 0);
  let r = await f.service.ripenAllStep(p.token, 0);
  assert.equal(r.done, false);
  await assert.rejects(() => f.service.ripenAllStep(p.token, 0), /失效/);
  r = await f.service.ripenAllStep(p.token, 1);
  r = await f.service.ripenAllStep(p.token, 2);
  assert.equal(r.done, true);
  assert.equal(r.completed, 1);
  assert.equal(r.used.normal, 3600);
  assert.equal(r.used.organic, 7200);
  assert.deepEqual(f.calls.map(call => call[1]), [1012, 1011, 1012]);
  await assert.rejects(() => f.service.ripenAllStep(p.token, 3), /失效/);
});

test('final stage normal runs first and different targets batch by their next fertilizer', async () => {
  const f = fixture([land(1, 1), land(2, 2)]);
  const p = await f.service.previewRipenAll();
  for (let cursor = 0; cursor < 3; cursor++) await f.service.ripenAllStep(p.token, cursor);
  assert.deepEqual(f.calls, [[[1], 1011], [[2], 1012], [[2], 1011]]);
});

test('24 three-stage crops use exactly three batch requests rather than 72 per-land requests', async () => {
  const f = fixture(Array.from({ length: 24 }, (_, index) => land(index + 1)));
  const p = await f.service.previewRipenAll();
  assert.equal(p.actionCount, 3);
  assert.equal(p.applicationCount, 72);
  let result;
  for (let cursor = 0; cursor < p.actionCount; cursor++) result = await f.service.ripenAllStep(p.token, cursor);
  assert.equal(result.done, true);
  assert.equal(result.completed, 24);
  assert.equal(result.updatedLands.length, 24);
  assert.equal(result.used.normal, 24 * 3600);
  assert.equal(result.used.organic, 48 * 3600);
  assert.deepEqual(f.calls.map(call => call[1]), [1012, 1011, 1012]);
  assert.ok(f.calls.every(call => call[0].length === 24));
  assert.equal(f.reads(), 4);
});

test('mixed phase counts and spent allowances share batches without changing each crop strategy', async () => {
  const f = fixture([land(1, 3), land(2, 1), land(3, 2), land(4, 2, 0)]);
  const p = await f.service.previewRipenAll();
  assert.equal(p.actionCount, 4);
  let result;
  for (let cursor = 0; cursor < p.actionCount; cursor++) result = await f.service.ripenAllStep(p.token, cursor);
  assert.equal(result.done, true);
  assert.equal(result.completed, 4);
  assert.deepEqual(f.calls, [[[2], 1011], [[1, 3, 4], 1012], [[1, 3], 1011], [[1, 4], 1012]]);
});

test('different crops and unequal stage durations still use normal at the next stage, not the longest', async () => {
  const first = land(1, 3);
  const second = land(2, 3);
  second.plant.id = 999999998;
  first.plant.phases[2].begin_time = now + 7200;
  first.plant.phases[3].begin_time = now + 36000;
  second.plant.phases[1].begin_time = now + 9000;
  second.plant.phases[2].begin_time = now + 10000;
  second.plant.phases[3].begin_time = now + 11000;
  const f = fixture([first, second]);
  const p = await f.service.previewRipenAll();
  assert.equal(p.cost.normal, 4600);
  assert.equal(p.cost.organic, 42400);
  for (let cursor = 0; cursor < 3; cursor++) await f.service.ripenAllStep(p.token, cursor);
  assert.deepEqual(f.calls, [[[1, 2], 1012], [[1, 2], 1011], [[1, 2], 1012]]);
});

test('known stale AllLands snapshots are retried without resending fertilizer; persistent staleness stops', async () => {
  const f = fixture([land()], { staleReads: true });
  const p = await f.service.previewRipenAll();
  for (let cursor = 0; cursor < 3; cursor++) await f.service.ripenAllStep(p.token, cursor);
  assert.equal(f.calls.length, 3);
  const stuck = fixture([land()], { alwaysStale: true });
  const preview = await stuck.service.previewRipenAll();
  await stuck.service.ripenAllStep(preview.token, 0);
  await assert.rejects(() => stuck.service.ripenAllStep(preview.token, 1), /状态已变化/);
  assert.equal(stuck.calls.length, 1);
});

test('insufficient inventory and changed crop/phase never send fertilizer', async () => {
  for (const mode of ['insufficient', 'replaced', 'new-season', 'phase', 'depleted']) {
    const f = fixture();
    if (mode === 'insufficient') f.setInventory([]);
    const p = await f.service.previewRipenAll();
    const replacement = land();
    if (mode === 'replaced') replacement.plant.id++;
    if (mode === 'new-season') replacement.plant.season++;
    if (mode === 'phase') replacement.plant.phases.shift();
    if (mode === 'depleted') f.setInventory([]);
    f.setSnapshot({ lands: [replacement] });
    await assert.rejects(() => f.service.ripenAllStep(p.token, 0));
    assert.equal(f.calls.length, 0, mode);
  }
});

test('unknown replies, failure, or no phase progress stop permanently after one request', async () => {
  for (const extra of [{ missing: true }, { fail: true }, { noProgress: true }]) {
    const f = fixture([land()], extra);
    const p = await f.service.previewRipenAll();
    if (extra.fail) await assert.rejects(() => f.service.ripenAllStep(p.token, 0));
    else assert.ok((await f.service.ripenAllStep(p.token, 0)).stopped);
    await assert.rejects(() => f.service.ripenAllStep(p.token, 1), /失效/);
    assert.equal(f.calls.length, 1);
  }
});

test('partial batch results keep confirmed land updates and invalidate the plan without retrying', async () => {
  const f = fixture([land(1, 1), land(2, 1)], { partial: true });
  const p = await f.service.previewRipenAll();
  const result = await f.service.ripenAllStep(p.token, 0);
  assert.equal(result.done, false);
  assert.equal(result.completed, 1);
  assert.equal(result.updatedLands.length, 1);
  assert.equal(result.updatedLands[0].id, 1);
  assert.match(result.stopped, /土地 2/);
  await assert.rejects(() => f.service.ripenAllStep(p.token, 1), /失效/);
  assert.deepEqual(f.calls, [[[1, 2], 1011]]);
});

test('a no-progress member cannot make a batch successful even if other members mature', async () => {
  const f = fixture([land(1, 1), land(2, 1)], { noProgressLandId: 2 });
  const p = await f.service.previewRipenAll();
  const result = await f.service.ripenAllStep(p.token, 0);
  assert.equal(result.completed, 1);
  assert.equal(result.done, false);
  assert.match(result.stopped, /阶段推进/);
  assert.equal(result.updatedLands.length, 2);
});

test('all members must pass fresh state and aggregate inventory checks before a batch is sent', async () => {
  for (const mode of ['changed', 'depleted']) {
    const f = fixture([land(1, 1), land(2, 1)]);
    const p = await f.service.previewRipenAll();
    if (mode === 'changed') {
      const changed = land(2, 1);
      changed.plant.season++;
      f.setSnapshot({ lands: [land(1, 1), changed] });
    } else f.setInventory([{ id: 1011, count: 3600 }]);
    await assert.rejects(() => f.service.ripenAllStep(p.token, 0));
    assert.equal(f.calls.length, 0);
  }
});

test('concurrent batch steps cannot send the same fertilizer request twice', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture([land(1, 1), land(2, 1)], { onSend: () => new Promise(resolve => { release = resolve; entered(); }) });
  const p = await f.service.previewRipenAll();
  const pending = f.service.ripenAllStep(p.token, 0);
  await started;
  await assert.rejects(() => f.service.ripenAllStep(p.token, 0), /重复提交/);
  await assert.rejects(() => f.service.previewRipenAll(), /正在执行/);
  release();
  assert.equal((await pending).done, true);
  assert.equal(f.calls.length, 1);
});

test('expired or superseded previews reject without fertilizer use', async () => {
  const f = fixture();
  const old = await f.service.previewRipenAll();
  const current = await f.service.previewRipenAll();
  await assert.rejects(() => f.service.ripenAllStep(old.token, 0), /失效/);
  const realNow = Date.now;
  try {
    Date.now = () => current.expiresAt;
    await assert.rejects(() => f.service.ripenAllStep(current.token, 0), /失效/);
  } finally { Date.now = realNow; }
  assert.equal(f.calls.length, 0);
});

test('bulk routes enforce account ownership and require valid step confirmation parameters', async () => {
  const routes = new Map();
  const calls = [];
  require('../src/controllers/admin-farm-operation-routes').registerAdminFarmOperationRoutes({
    app: { post: (url, handler) => routes.set(url, handler) },
    provider: { previewRipenAll: async (...args) => { calls.push(args); return {}; },
      ripenAllStep: async (...args) => { calls.push(args); return {}; } },
    getAccountIdFromRequest: req => req.account,
    canAccessAccount: req => req.allowed,
    sendProviderError: (res, error) => res.status(500).json({ error: error.message })
  });
  const request = async (action, body, extra = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.data = value; } };
    await routes.get(`/api/farm/ripen-all/${action}`)({ account: 'a', allowed: true, body, ...extra }, res);
    return res;
  };
  assert.equal((await request('preview', {}, { allowed: false })).code, 403);
  assert.equal((await request('step', { token: 't', cursor: 0 }, { account: '' })).code, 400);
  for (const body of [{}, { token: 't', cursor: -1 }, { token: 't', cursor: '0' }])
    assert.equal((await request('step', body)).code, 400);
  assert.equal(calls.length, 0);
  await request('preview', {});
  await request('step', { token: 't', cursor: 0 });
  assert.deepEqual(calls, [['a'], ['a', 't', 0]]);
});

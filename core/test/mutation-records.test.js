const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const { createMutationRepository, exportMutationCsv, accountFile } = require('../src/services/mutation-records');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-records-'));
process.env.FARM_DATA_DIR = dir;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const planting = (landId = 1, identity = 'plant:1:100') => ({
  landId, identity, plantedAt: 1000, seedId: 20001, seedName: '白萝卜', source: 'system',
});

test('IDs are assigned by storage, survive restart and are isolated per account', () => {
  const repo = createMutationRepository('a');
  assert.equal(repo.insert({ ...planting(), id: 900 }).id, 1);
  assert.equal(createMutationRepository('a').insert(planting(2)).id, 2);
  assert.equal(repo.insert(planting(3)).id, 3);
  assert.equal(createMutationRepository('b').list().total, 0);
  assert.equal(createMutationRepository('b').insert(planting()).id, 1);
});

test('harvest without planting is dropped; replacement/mismatch cannot update an old crop', () => {
  const repo = createMutationRepository('matching');
  assert.equal(repo.capture(1, 'old'), null);
  repo.insert(planting(1, 'first'));
  repo.insert(planting(1, 'second'));
  assert.equal(repo.list({ status: 'unknown' }).total, 1);
  assert.equal(repo.capture(1, 'first'), null);
  assert.equal(repo.list({ status: 'unknown' }).total, 2);
  assert.equal(repo.finish(1, [], 2000), false);
});

test('final results are deduplicated, unknown is not zero and repeated finish is idempotent', () => {
  const repo = createMutationRepository('finish');
  const a = repo.insert(planting());
  const b = repo.insert(planting(2));
  const c = repo.insert(planting(3));
  assert.equal(repo.finish(a.id, [{ id: 1, name: '冰冻' }, { id: 5, name: '黄金' }, { id: 1, name: '冰冻' }], 3000), true);
  assert.equal(repo.finish(a.id, [], 4000), false);
  repo.finish(b.id, [], 3000);
  assert.equal(repo.list({ mutation: '1' }).total, 1);
  assert.equal(repo.list({ mutation: 'none' }).rows[0].id, b.id);
  assert.equal(repo.list({ status: 'growing' }).rows[0].mutationCount, null);
  repo.invalidate([3]);
  assert.equal(repo.list({ status: 'removed' }).rows[0].id, c.id);
});

test('exports are chronological with ID tie-break, include all filtered pages and escape formulas', () => {
  const repo = createMutationRepository('export');
  repo.insert({ ...planting(), plantedAt: 3000 });
  repo.insert({ ...planting(2), plantedAt: 1000, seedName: '=danger,"quote"' });
  repo.insert({ ...planting(3), plantedAt: 1000 });
  assert.deepEqual(repo.list({ all: true }).rows.map(row => row.id), [2, 3, 1]);
  assert.equal(repo.list({ pageSize: 1 }).rows.length, 1);
  const csv = exportMutationCsv(repo.list({ all: true }).rows.reverse());
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.split('\r\n')[1].startsWith('"2",'));
  assert.ok(csv.includes(`"'=danger,""quote"""`));
});

test('statistics count only complete harvests, deduplicate each type and ignore pagination and filters', () => {
  const repo = createMutationRepository('statistics');
  const a = repo.insert(planting(1));
  const b = repo.insert(planting(2));
  const c = repo.insert(planting(3));
  repo.finish(a.id, [{ id: 1, name: 'ice' }, { id: 5, name: 'gold' }, { id: 1, name: 'ice' }], 2000);
  repo.finish(b.id, [{ id: 5, name: 'gold' }], 2000);
  repo.finish(c.id, [], 2000);
  repo.insert(planting(4));
  const pending = repo.insert(planting(5));
  repo.prepareHarvest([{ ...pending, mutations: [{ id: 8, name: 'pending' }] }]);
  repo.insert(planting(6));
  repo.invalidate([6]);
  repo.insert(planting(7));
  repo.invalidate([7], 'unknown');
  const expected = {
    completedRecords: 3,
    mutatedRecords: 2,
    mutationRate: 2 / 3 * 100,
    types: [
      { id: 5, name: 'gold', count: 2, percentage: 2 / 3 * 100 },
      { id: 1, name: 'ice', count: 1, percentage: 1 / 3 * 100 },
    ],
  };
  assert.deepEqual(repo.list().statistics, expected);
  assert.deepEqual(repo.list({ mutation: '1', pageSize: 1, page: 99 }).statistics, expected);
  assert.deepEqual(repo.list({ status: 'growing' }).statistics, expected);
  assert.deepEqual(createMutationRepository('statistics').list().statistics, expected);
  repo.finish(pending.id, [{ id: 8, name: 'new' }], 3000);
  assert.equal(repo.list().statistics.completedRecords, 4);
  assert.equal(repo.list().statistics.mutationRate, 75);
});

test('multiple mutations count as one mutated crop but each type uses all completed crops as denominator', () => {
  const repo = createMutationRepository('statistics-multiple');
  const row = repo.insert(planting());
  repo.finish(row.id, [{ id: 5, name: 'gold' }, { id: 1, name: 'ice' }], 2000);
  const stats = repo.list().statistics;
  assert.equal(stats.completedRecords, 1);
  assert.equal(stats.mutatedRecords, 1);
  assert.equal(stats.mutationRate, 100);
  assert.deepEqual(stats.types.map(item => [item.id, item.count, item.percentage]), [[1, 1, 100], [5, 1, 100]]);
});

test('statistics have no percentage without a denominator, distinguish no mutation, and reset after clear', () => {
  const repo = createMutationRepository('statistics-empty');
  const empty = { completedRecords: 0, mutatedRecords: 0, mutationRate: null, types: [] };
  assert.deepEqual(repo.list().statistics, empty);
  const row = repo.insert(planting());
  assert.deepEqual(repo.list().statistics, empty);
  repo.finish(row.id, [], 2000);
  assert.deepEqual(repo.list().statistics, { ...empty, completedRecords: 1, mutationRate: 0 });
  assert.deepEqual(createMutationRepository('statistics-other-account').list().statistics, empty);
  const reader = createMutationRepository('statistics-empty');
  assert.equal(reader.list().statistics.completedRecords, 1);
  repo.clear();
  assert.deepEqual(repo.list().statistics, empty);
  assert.deepEqual(reader.list().statistics, empty);
});

test('incomplete transactions are invisible to readers and prevent unsafe appending', () => {
  const repo = createMutationRepository('partial');
  repo.insert(planting());
  fs.appendFileSync(accountFile('partial', 'records.jsonl'), '{"rows":');
  assert.equal(createMutationRepository('partial').list().total, 1);
  assert.throws(() => repo.insert(planting(2)), /未完成写入/);
  assert.equal(createMutationRepository('partial').list().total, 1);
});

test('account file names cannot traverse directories', () => {
  assert.ok(accountFile('../../escape', 'records.jsonl').startsWith(path.join(dir, 'mutations')));
  assert.throws(() => createMutationRepository(''), /缺少账号/);
});

test('clear physically removes account records, invalidates cached readers and preserves increasing IDs after restart', () => {
  const repo = createMutationRepository('clear');
  const reader = createMutationRepository('clear');
  const other = createMutationRepository('clear-other');
  other.insert(planting());
  const first = repo.insert(planting());
  repo.finish(first.id, [{ id: 5, name: 'golden' }], 2000);
  const pending = repo.insert(planting(2));
  repo.prepareHarvest([{ ...pending, mutations: [] }]);
  assert.equal(reader.list().total, 2);
  assert.deepEqual(repo.clear(), { deleted: 2 });
  assert.equal(reader.list().total, 0);
  assert.deepEqual(reader.list().mutationTypes, []);
  assert.equal(other.list().total, 1);
  assert.equal(repo.finish(pending.id, [], 3000), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(accountFile('clear', 'records.jsonl'), 'utf8')), { rows: [], nextId: 3 });
  assert.equal(createMutationRepository('clear').insert(planting(2)).id, 3);
  assert.equal(repo.list().rows[0].id, 3);
  assert.equal(reader.list().rows[0].id, 3);
  repo.clear();
  assert.equal(repo.clear().deleted, 0);
  assert.equal(createMutationRepository('clear').insert(planting()).id, 4);
});

test('failed atomic replacement leaves records intact and cleans up its temporary file', () => {
  const repo = createMutationRepository('clear-failure');
  repo.insert(planting());
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('fixture rename failure'); };
  try { assert.throws(() => repo.clear(), /fixture rename failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(repo.list().total, 1);
  assert.equal(createMutationRepository('clear-failure').list().total, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(accountFile('clear-failure', 'records.jsonl'))), ['records.jsonl']);
});

test('provider clears offline records locally but delegates running accounts to their single writer', async () => {
  const filename = path.join(__dirname, '../src/runtime/data-provider.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: name => name === '../services/scheduler' ? {} : realRequire(name),
  }, { filename });
  const { createDataProvider } = module.exports;
  const { getMutationRepository } = require('../src/services/mutation-records');
  const calls = [];
  const provider = createDataProvider({
    workers: { online: {} },
    getAccounts: () => ({ accounts: [{ id: 'online' }, { id: 'offline' }] }),
    callWorkerApi: (...args) => { calls.push(args); return { deleted: 7 }; },
  });
  getMutationRepository('offline').insert(planting());
  getMutationRepository('online').insert(planting());
  assert.equal((await provider.clearMutationRecords('offline')).deleted, 1);
  assert.equal(getMutationRepository('offline').list().total, 0);
  assert.equal((await provider.clearMutationRecords('online')).deleted, 7);
  assert.deepEqual(calls, [['online', 'clearMutationRecords']]);
  assert.equal(getMutationRepository('online').list().total, 1);
});

test('real account config and default-plan application cannot re-enable conflicting automation', () => {
  const store = require('../src/models/store');
  const { setMutationTestActive } = require('../src/services/mutation-test-state');
  const id = 'config-guard';
  store.applyConfigSnapshot({ automation: { farm: false, fertilizer: 'none', land_upgrade: false } }, { accountId: id });
  store.setUserDefaultAccountPlan('owner', { automation: { farm: true } });
  setMutationTestActive(id, true);
  try {
    assert.throws(() => store.setAutomation('farm', true, id), /测变异运行中/);
    assert.throws(() => store.applyConfigSnapshot({ automation: { fertilizer: 'normal' } }, { accountId: id }), /测变异运行中/);
    assert.throws(() => store.applyUserDefaultAccountPlan('owner', id), /测变异运行中/);
    assert.equal(store.getAutomation(id).farm, false);
    assert.equal(store.getAutomation(id).fertilizer, 'none');
  } finally {
    setMutationTestActive(id, false);
  }
  store.setAutomation('farm', true, id);
  assert.equal(store.getAutomation(id).farm, true);
});

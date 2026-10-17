const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMutationRepository, exportMutationDetailsCsv, accountFile } = require('../src/services/mutation-records');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-stages-'));
process.env.FARM_DATA_DIR = dir;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let serial = 0;
function fixture(totalStages = 8) {
  const accountId = `stages-${++serial}`;
  const repo = createMutationRepository(accountId);
  const row = repo.insert({
    schemaVersion: 2, plantId: 101, seedId: 201, seedName: 'fixture', landId: 1,
    identity: '101:1', phaseCount: totalStages, phaseBegin: 100,
    stagePlan: Array.from({ length: totalStages }, (_, i) => ({ name: `stage-${i + 1}`, duration: i === totalStages - 1 ? 0 : 60 })),
    totalStages, plantedAt: 100000, testId: 'task-1', source: 'test', round: 1,
  });
  const observe = (stage, ids = [], extra = {}) => repo.observe([{
    landId: 1, identity: row.identity, recordId: row.id, phaseCount: totalStages - stage + 1,
    phaseBegin: 100 + (stage - 1) * 60, observedAt: 100000 + stage * 1000,
    requestedAt: 100000 + stage * 1000, mutationsKnown: true, source: 'fertilizer_after',
    mutations: ids.map(id => ({ id, name: `mutation-${id}`, serverMutationAt: 120000, weatherId: 7 })),
    ...extra,
  }]);
  const list = view => repo.list({ view, all: true }).rows;
  return { accountId, repo, row, observe, list };
}

test('eight-stage crop records multiple new types in one stage and only first discovery across later stages', () => {
  const f = fixture();
  assert.equal(f.list('stages').length, 8);
  assert.ok(f.list('stages').every(row => row.checked === false));
  f.observe(1);
  f.observe(6, [1, 2, 1]);
  f.observe(7, [1, 2, 3]);
  f.observe(7, [1, 2, 3], { observedAt: 109000, requestedAt: 109000 });
  const found = f.list('discoveries');
  assert.deepEqual(found.map(r => [r.mutationId, r.stage]), [[1, 6], [2, 6], [3, 7]]);
  assert.equal(found[0].firstObservedAt, 106000);
  assert.equal(found[0].serverMutationAt, 120000);
  assert.equal(found[0].weatherId, 7);
  const seventh = f.list('stages')[6];
  assert.deepEqual(seventh.newMutations.map(m => m.id), [3]);
  assert.deepEqual(seventh.observedMutations.map(m => m.id), [1, 2, 3]);
  assert.equal(seventh.serverEnteredAt, 460000);
  assert.equal(seventh.firstObservedAt, 107000);
  assert.equal(seventh.lastObservedAt, 109000);
  assert.equal(f.list('stages')[4].checked, false);
  assert.equal(f.list('records')[0].mutationCount, null);
  f.observe(8, [3], { observedAt: 110000, requestedAt: 110000, mature: true });
  f.repo.finish(f.row.id, [{ id: 3, name: 'mutation-3' }], 120000);
  assert.equal(f.list('records')[0].mutationCount, 1);
  assert.equal(f.list('discoveries').length, 3);
  const reloaded = createMutationRepository(f.accountId);
  assert.deepEqual(reloaded.list({ view: 'discoveries', all: true }).rows, f.list('discoveries'));
});

test('unknown/missing observations and skipped phases do not inflate checked denominators', () => {
  const f = fixture();
  f.observe(2, [], { mutationsKnown: false });
  f.observe(4, [5]);
  const stats = f.repo.list({ mutation: '5', page: 99, pageSize: 1 }).stageStatistics;
  assert.equal(stats[1].checked, 0);
  assert.equal(stats[1].mutationRate, null);
  assert.equal(stats[3].checked, 1);
  assert.equal(stats[3].mutationRate, 100);
  assert.equal(stats[2].coverage, 0);
  assert.equal(f.repo.list({ view: 'stages', mutation: 'none' }).total, 0);
  assert.equal(f.repo.list({ view: 'stages', mutation: '5' }).total, 1);
  assert.equal(f.repo.list({ view: 'discoveries', seedId: 999 }).total, 0);
  assert.equal(f.repo.list({ testId: 'other' }).stageStatistics.length, 0);
});

test('new mutations discovered by multiple checks within the same stage preserve individual first times', () => {
  const f = fixture();
  f.observe(3, [1]);
  f.observe(3, [1, 5], { requestedAt: 104000, observedAt: 104000 });
  f.observe(4, [1, 5]);
  const found = f.list('discoveries');
  assert.deepEqual(found.map(row => [row.mutationId, row.stage, row.firstObservedAt]), [[1, 3, 103000], [5, 3, 104000]]);
  assert.deepEqual(f.list('stages')[2].newMutations.map(item => item.id), [1, 5]);
  assert.equal(f.list('stages')[3].newMutations.length, 0);
});

test('unchanged background polling is coalesced while newer request order still rejects stale replies', () => {
  const f = fixture();
  f.observe(3, [1], { source: 'lands' });
  const file = accountFile(f.accountId, 'records.jsonl');
  const size = fs.statSync(file).size;
  f.observe(3, [1], { source: 'lands', requestedAt: 109000, observedAt: 109000 });
  assert.equal(fs.statSync(file).size, size);
  f.observe(4, [1, 2], { requestedAt: 108000, observedAt: 110000 });
  assert.equal(f.list('discoveries').length, 1);
  f.observe(4, [1, 2], { requestedAt: 111000, observedAt: 111000 });
  assert.equal(f.list('discoveries').length, 2);
});

test('observations with stale request order, wrong planting IDs or already-cleared rows cannot alter history', () => {
  const f = fixture();
  f.observe(6, [1]);
  f.observe(3, [9], { requestedAt: 103000 });
  f.observe(7, [9], { recordId: 999 });
  assert.equal(f.list('discoveries').length, 1);
  assert.equal(f.list('records')[0].status, 'growing');
  const reader = createMutationRepository(f.accountId);
  reader.list({ view: 'stages' });
  f.repo.recordOperation({ id: 'operation', recordId: f.row.id, status: 'success' });
  f.repo.clear();
  f.observe(7, [9]);
  assert.equal(f.repo.recordOperation({ id: 'late', recordId: f.row.id }), false);
  for (const view of ['records', 'stages', 'discoveries', 'operations']) {
    assert.equal(reader.list({ view }).total, 0);
  }
  assert.equal(JSON.parse(fs.readFileSync(accountFile(f.accountId, 'records.jsonl'), 'utf8')).nextId, 2);
});

test('legacy history stays untouched; absent phase plans leave first discoveries explicitly unassigned', () => {
  const repo = createMutationRepository(`legacy-${++serial}`);
  repo.insert({ landId: 1, identity: '1:1', phaseCount: 3, phaseBegin: 1, plantedAt: 1 });
  repo.observe([{ landId: 1, identity: '1:1', phaseCount: 2, phaseBegin: 2,
    observedAt: 10, mutationsKnown: true, mutations: [{ id: 5, name: 'gold' }] }]);
  assert.equal(repo.list({ view: 'stages' }).total, 0);
  assert.equal(repo.list({ view: 'discoveries' }).total, 0);
  const row = repo.insert({ schemaVersion: 2, totalStages: null, stagePlan: [],
    landId: 2, identity: '2:1', phaseCount: 3, phaseBegin: 1, plantedAt: 2 });
  repo.observe([{ landId: 2, identity: '2:1', phaseCount: 2, phaseBegin: 2,
    observedAt: 10, mutationsKnown: true, mutations: [{ id: 5, name: 'gold' }] }]);
  const found = repo.list({ view: 'discoveries' }).rows[0];
  assert.equal(found.recordId, row.id);
  assert.equal(found.stage, null);
  assert.equal(found.attribution, 'stage_unknown');
});

test('incomplete multi-table writes are invisible and exports preserve IDs, times and missing data', () => {
  const f = fixture();
  f.observe(3, [1, 5]);
  f.repo.recordOperation({ id: 'op', recordId: f.row.id, fertilizerId: 1012,
    beforeStage: 2, afterStage: 3, requestedAt: 100000, finishedAt: 101000, consumedSeconds: 120 });
  for (const view of ['stages', 'discoveries', 'operations']) {
    const csv = exportMutationDetailsCsv(f.list(view), view);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('"种植记录ID"'));
    assert.ok(csv.includes('"1"'));
    assert.ok(csv.includes('1970-01-01T00:01:40.000Z'));
  }
  assert.ok(exportMutationDetailsCsv(f.list('stages'), 'stages').includes('mutation-1'));
  fs.appendFileSync(accountFile(f.accountId, 'records.jsonl'), '{"rows":[],"discoveries":[');
  const reader = createMutationRepository(f.accountId);
  assert.equal(reader.list({ view: 'discoveries' }).total, 2);
  assert.throws(() => f.observe(4, [1, 5]), /未完成写入/);
});

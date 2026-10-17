const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { registerAdminFarmOperationRoutes } = require('../src/controllers/admin-farm-operation-routes');

function fixture({ readError = false } = {}) {
  let lands = [];
  let reads = 0;
  const calls = [];
  const module = { exports: {} };
  const modules = {
    './farm-land-analyzer': { buildLandDetails: reply => reply },
    './farm-api': { getAllLands: async () => {
      reads++;
      if (readError) throw new Error('read failed');
      return { lands };
    }, removePlant: async ids => calls.push(Array.from(ids)) },
    './mutation-operation-gate': { farmOperationGate: { operation: fn => fn() } },
    '../utils/utils': { log() {} },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/farm-plant-removal'), 'utf8'), {
    module, require: name => modules[name],
  });
  return { ...module.exports, calls, setLands: value => { lands = value; }, getReads: () => reads };
}

const lands = [
  { id: 1, unlocked: true, status: 'growing' },
  { id: 2, unlocked: true, status: 'harvestable' },
  { id: 3, unlocked: true, status: 'dead' },
  { id: 4, unlocked: true, status: 'dead', occupiedByMaster: true, masterLandId: 3 },
  { id: 5, unlocked: true, status: 'empty' },
  { id: 6, unlocked: false, status: 'locked' },
  { id: 7, unlocked: true, status: 'unknown' },
];

test('dead-only removal selects fresh dead crop masters and excludes every live crop', async () => {
  const f = fixture();
  f.setLands(lands);
  assert.equal((await f.removeFarmPlants(true)).removed, 1);
  assert.deepEqual(f.calls, [[3]]);
  f.setLands(lands.map(land => ({ ...land, status: 'growing' })));
  assert.equal((await f.removeFarmPlants(true)).removed, 0);
  assert.deepEqual(f.calls, [[3]]);
  assert.equal(f.getReads(), 2);
});

test('all removal includes all crop phases once per master, excluding empty and locked lands', async () => {
  const f = fixture();
  f.setLands(lands);
  assert.equal((await f.removeFarmPlants()).removed, 3);
  assert.deepEqual(f.calls, [[1, 2, 3]]);
});

test('empty farms do not send a removal request', async () => {
  const f = fixture();
  assert.equal((await f.removeFarmPlants(true)).removed, 0);
  assert.equal((await f.removeFarmPlants()).removed, 0);
  assert.deepEqual(f.calls, []);
});

test('failed land reads are surfaced instead of claiming no removable crops', async () => {
  const f = fixture({ readError: true });
  await assert.rejects(() => f.removeFarmPlants(true), /read failed/);
  assert.deepEqual(f.calls, []);
});

test('dead-only route enforces account access and dispatches only the dead-only worker action', async () => {
  const routes = new Map();
  const calls = [];
  registerAdminFarmOperationRoutes({
    app: { post: (path, handler) => routes.set(path, handler) },
    provider: { removeDeadPlants: async id => { calls.push(id); return { removed: 2 }; } },
    getAccountIdFromRequest: req => req.accountId,
    canAccessAccount: req => req.allowed,
    sendProviderError: (res, error) => res.status(500).json({ error: error.message }),
  });
  for (const [req, expected] of [[{}, 400], [{ accountId: 'a', allowed: false }, 403], [{ accountId: 'a', allowed: true }, 200]]) {
    const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await routes.get('/api/land/remove-dead')(req, res);
    assert.equal(res.code, expected);
    if (expected === 200) assert.equal(res.body.data.removed, 2);
  }
  assert.deepEqual(calls, ['a']);
});

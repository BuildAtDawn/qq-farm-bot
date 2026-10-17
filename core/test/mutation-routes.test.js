const assert = require('node:assert/strict');
const test = require('node:test');
const { registerAdminMutationRoutes } = require('../src/controllers/admin-mutation-routes');

function fixture() {
  const routes = new Map();
  const calls = [];
  const provider = Object.fromEntries(['getMutationRecords', 'clearMutationRecords', 'getMutationTest', 'getMutationTestSeeds', 'startMutationTest', 'stopMutationTest']
    .map(name => [name, async (...args) => {
      calls.push([name, ...args]);
      return name === 'getMutationRecords' ? { rows: [], total: 0 }
        : name === 'getMutationTestSeeds' ? [{ seedId: 1, supported: true }, { seedId: 2, supported: false }] : { enabled: false };
    }]));
  registerAdminMutationRoutes({
    app: { get: (url, fn) => routes.set(`get ${url}`, fn), post: (url, fn) => routes.set(`post ${url}`, fn) },
    provider, getAccountIdFromRequest: req => req.accountId, canAccessAccount: req => req.allowed !== false,
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
  });
  async function request(route, options = {}) {
    const res = { code: 200, headers: {}, status(code) { this.code = code; return this; },
      json(data) { this.data = data; }, send(data) { this.data = data; },
      setHeader(key, value) { this.headers[key] = value; } };
    await routes.get(route)({ accountId: 'a', query: {}, body: {}, ...options }, res);
    return res;
  }
  return { request, routes, calls, provider };
}
test('every mutation read/export/control route enforces account authorization', async () => {
  const f = fixture();
  for (const route of f.routes.keys()) {
    assert.equal((await f.request(route, { accountId: '' })).code, 400);
    assert.equal((await f.request(route, { allowed: false })).code, 403);
  }
  assert.equal(f.calls.length, 0);
});
test('clear requires explicit confirmation and uses only the authorized account, not filters or body account', async () => {
  const f = fixture();
  for (const body of [{}, { confirm: false }, { confirm: 'true' }]) {
    assert.equal((await f.request('post /api/mutations/clear', { body })).code, 400);
  }
  assert.equal(f.calls.length, 0);
  const result = await f.request('post /api/mutations/clear', {
    accountId: 'a', body: { confirm: true, accountId: 'b' }, query: { mutation: '5' },
  });
  assert.equal(result.data.ok, true);
  assert.deepEqual(f.calls, [['clearMutationRecords', 'a']]);
  f.provider.clearMutationRecords = () => { throw new Error('测变异运行中'); };
  const failed = await f.request('post /api/mutations/clear', { body: { confirm: true } });
  assert.equal(failed.data.ok, false);
  assert.match(failed.data.error, /测变异运行中/);
});
test('export ignores client pagination, list cannot request all records, seed options exclude unsupported crops', async () => {
  const f = fixture();
  await f.request('get /api/mutations', { query: { all: true, mutation: '5', page: '2' } });
  assert.equal(f.calls[0][2].all, undefined);
  assert.equal(f.calls[0][2].mutation, '5');
  const result = await f.request('get /api/mutations/export', { query: { page: 99, status: 'harvested' } });
  assert.equal(f.calls[1][2].all, true);
  assert.equal(f.calls[1][2].status, 'harvested');
  assert.match(result.headers['Content-Type'], /text\/csv/);
  assert.ok(result.data.startsWith('\uFEFF'));
  assert.deepEqual((await f.request('get /api/mutation-test/seeds')).data.data, [{ seedId: 1, supported: true }]);
});

test('phase views and exports forward crop/task/record filters without opening unrestricted queries', async () => {
  const f = fixture();
  for (const view of ['stages', 'discoveries', 'operations']) {
    const result = await f.request('get /api/mutations/export', {
      query: { view, seedId: '20002', testId: 'task', recordId: '1', page: 99 },
    });
    const query = f.calls.at(-1)[2];
    assert.equal(query.view, view);
    assert.equal(query.seedId, '20002');
    assert.equal(query.testId, 'task');
    assert.equal(query.recordId, '1');
    assert.equal(query.all, true);
    assert.match(result.data, /种植记录ID/);
  }
  await f.request('get /api/mutations', { query: { view: '__proto__', all: true } });
  assert.equal(f.calls.at(-1)[2].view, 'records');
  assert.equal(f.calls.at(-1)[2].all, undefined);
});

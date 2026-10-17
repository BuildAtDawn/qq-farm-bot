const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAdminWishShareActivityRoutes } = require('../src/controllers/admin-wish-share-activity-routes');

function fixture() {
  const routes = new Map();
  const calls = [];
  let connected = true;
  const provider = { getStatus: () => ({ connection: { connected } }) };
  for (const method of ['getMilkTea', 'operateMilkTea', 'milkTeaRecords']) {
    provider[method] = async (...args) => { calls.push([method, ...args]); return { fixture: true }; };
  }
  registerAdminWishShareActivityRoutes({
    app: { get: (url, fn) => routes.set(`GET ${url}`, fn), post: (url, fn) => routes.set(`POST ${url}`, fn) },
    provider, getAccountIdFromRequest: req => req.accountId, canAccessAccount: req => req.allowed,
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
  });
  return { routes, calls, provider, disconnect: () => { connected = false; } };
}
function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
}

test('all milk tea endpoints enforce account ownership and connected status', async () => {
  const f = fixture();
  for (const key of ['GET /api/activity/milk-tea', 'POST /api/activity/milk-tea/operate', 'POST /api/activity/milk-tea/records']) {
    for (const request of [{ allowed: true }, { accountId: 'a', allowed: false }]) {
      const res = response();
      await f.routes.get(key)(request, res);
      assert.equal(res.data.ok, false);
      assert.ok([400, 403].includes(res.code));
    }
  }
  assert.equal(f.calls.length, 0);
  f.disconnect();
  for (const key of f.routes.keys()) {
    if (!key.includes('milk-tea')) continue;
    const res = response();
    await f.routes.get(key)({ accountId: 'a', allowed: true }, res);
    assert.equal(res.data.ok, false);
  }
  assert.equal(f.calls.length, 0);
});

test('manual endpoints forward to the same validated worker service and preserve failures', async () => {
  const f = fixture();
  const req = { accountId: 'a', allowed: true };
  const res = response();
  await f.routes.get('GET /api/activity/milk-tea')(req, res);
  assert.deepEqual(res.data, { ok: true, activity: { fixture: true } });
  await f.routes.get('POST /api/activity/milk-tea/operate')({ ...req, body: { action: 'buy', params: { goodsId: 301, count: 2 } } }, res);
  await f.routes.get('POST /api/activity/milk-tea/records')({ ...req, body: { kind: 'rank', params: { page: 2 } } }, res);
  assert.deepEqual(f.calls, [['getMilkTea', 'a'], ['operateMilkTea', 'a', 'buy', { goodsId: 301, count: 2 }], ['milkTeaRecords', 'a', 'rank', { page: 2 }]]);
  f.provider.operateMilkTea = async () => { throw new Error('不支持钻石购买'); };
  await f.routes.get('POST /api/activity/milk-tea/operate')({ ...req, body: { action: 'buy' } }, res);
  assert.equal(res.data.ok, false);
  assert.match(res.data.error, /不支持钻石/);
});

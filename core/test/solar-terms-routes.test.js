const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAdminWishShareActivityRoutes } = require('../src/controllers/admin-wish-share-activity-routes');

function fixture(overrides = {}) {
  const routes = new Map();
  const calls = [];
  const provider = {
    getStatus: () => ({ connection: { connected: true } }),
    getSolarTermsV2Info: async id => { calls.push(['v2', id]); return { version: 'v2', terms: [{ id: 401 }] }; },
    getSolarTermsInfo: async () => ({ terms: [] }),
    answerSolarTerm: async (...args) => { calls.push(['answer', ...args]); return { ok: true, correct: true }; },
    claimSolarTermsReward: async () => ({ ok: true, solarTerms: { terms: [] } }),
    ...overrides,
  };
  registerAdminWishShareActivityRoutes({
    app: { get: (path, handler) => routes.set(`GET ${path}`, handler), post: (path, handler) => routes.set(`POST ${path}`, handler) },
    provider, getAccountIdFromRequest: req => req.accountId, canAccessAccount: req => req.allowed,
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
  });
  async function request(method, body, req = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; } };
    await routes.get(method)({ accountId: 'fixture', allowed: true, body, ...req }, res);
    return res;
  }
  return { request, calls };
}

test('answer route preserves zero answer and enforces account authorization and connection', async () => {
  const f = fixture();
  for (const [req, status] of [[{ accountId: '' }, 400], [{ allowed: false }, 403]]) {
    assert.equal((await f.request('POST /api/activity/solar-terms/answer', { termId: 401, optionIndex: 0 }, req)).statusCode, status);
  }
  assert.deepEqual(f.calls, []);
  const result = await f.request('POST /api/activity/solar-terms/answer', { termId: 401, optionIndex: 0 });
  assert.equal(result.data.correct, true);
  assert.deepEqual(f.calls, [['answer', 'fixture', 401, 0]]);
  const disconnected = fixture({ getStatus: () => ({ connection: { connected: false } }) });
  assert.equal((await disconnected.request('POST /api/activity/solar-terms/answer', { termId: 401, optionIndex: 0 })).data.ok, false);
  assert.deepEqual(disconnected.calls, []);
});

test('answer route rejects null, missing, string and out-of-range indices rather than coercing to zero', async () => {
  const f = fixture();
  for (const value of [null, undefined, '', '0', false, 4, -1, 0.5]) {
    const result = await f.request('POST /api/activity/solar-terms/answer', { termId: 401, optionIndex: value });
    assert.equal(result.statusCode, 400);
  }
  assert.equal((await f.request('POST /api/activity/solar-terms/answer', { termId: '401', optionIndex: 0 })).statusCode, 400);
  assert.deepEqual(f.calls, []);
});

test('basic claim returns current V2 snapshot so the quiz remains visible', async () => {
  const f = fixture();
  const result = await f.request('POST /api/activity/solar-terms/claim', { termId: 401 });
  assert.equal(result.data.ok, true);
  assert.equal(result.data.solarTerms.version, 'v2');
});

test('V2 read failure is visible and does not turn an already successful basic claim into failure', async () => {
  const f = fixture({ getSolarTermsV2Info: async () => { throw new Error('fixture query failure'); } });
  const claim = await f.request('POST /api/activity/solar-terms/claim', { termId: 401 });
  assert.equal(claim.data.ok, true);
  assert.match(claim.data.refreshWarning, /刷新失败/);
  const read = await f.request('GET /api/activity/solar-terms');
  assert.equal(read.data.ok, true);
  assert.match(read.data.solarTerms.warning, /新版答题状态读取失败/);
});

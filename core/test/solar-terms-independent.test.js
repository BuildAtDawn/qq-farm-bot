const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isSolarTermClaimable } = require('../src/services/activity');
const store = require('../src/models/store');
test('solar rewards require the individual server window and claimable status', () => {
  const term = { status: 2, startTime: 100, endTime: 200 };
  for (const now of [99, 201]) assert.equal(isSolarTermClaimable(term, now), false);
  for (const now of [100, 150, 200]) assert.equal(isSolarTermClaimable(term, now), true);
  for (const status of [0, 1, 3, 5]) assert.equal(isSolarTermClaimable({ ...term, status }, 150), false);
  for (const invalid of [{ startTime: 0 }, { endTime: 99 }, { endTime: NaN }]) assert.equal(isSolarTermClaimable({ ...term, ...invalid }, 150), false);
});
test('permanent solar automation survives the retired star activity and later dates', () => {
  for (const now of [1792029600, 1800000000, 1900000000]) {
    const automation = { star_solar_claim: true, star_passport_claim: true };
    store._test.disableHiddenActivityAutomation(automation, now);
    assert.equal(automation.star_solar_claim, true);
    assert.equal(automation.star_passport_claim, false);
  }
});
test('solar automation reads its own service instead of the retired star snapshot', () => {
  const worker = fs.readFileSync(require.resolve('../src/core/worker'), 'utf8');
  assert.match(worker, /if \(claimSolarTerms\) \{\s+const solar = await getSolarTermsInfo\(\)/);
  assert.doesNotMatch(worker, /const needsStarActivity = [^;]*claimSolarTerms/);
});
test('independent solar routes use the solar provider and preserve account authorization', async () => {
  const routes = new Map();
  const calls = [];
  const { registerAdminWishShareActivityRoutes } = require('../src/controllers/admin-wish-share-activity-routes');
  registerAdminWishShareActivityRoutes({
    app: { get: (path, handler) => routes.set(`GET ${path}`, handler), post: (path, handler) => routes.set(`POST ${path}`, handler) },
    provider: { getStatus: () => ({ connection: { connected: true } }),
      getSolarTermsInfo: async id => { calls.push(['read', id]); return { terms: [] }; },
      claimSolarTermsReward: async (id, term) => { calls.push(['claim', id, term]); return { ok: true, solarTerms: { terms: [] } }; } },
    getAccountIdFromRequest: () => 'fixture-account', canAccessAccount: req => req.allowed,
    sendProviderError: (_, error) => { throw error; },
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; } };
  await routes.get('GET /api/activity/solar-terms')({ allowed: false }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
  await routes.get('GET /api/activity/solar-terms')({ allowed: true }, res);
  assert.deepEqual(res.data, { ok: true, solarTerms: { terms: [] } });
  await routes.get('POST /api/activity/solar-terms/claim')({ allowed: true, body: { termId: 42 } }, res);
  assert.deepEqual(calls, [['read', 'fixture-account'], ['claim', 'fixture-account', 42]]);
});
test('solar display resolves official names, time-derived expiration and the next term', () => {
  const protobuf = require('protobufjs/minimal');
  const { normalizeSolarTermsInfo } = require('../src/services/activity');
  const encodeTerm = (id, status, start, end, title = '') => {
    const w = protobuf.Writer.create();
    w.uint32(8).int32(id).uint32(16).int32(status).uint32(24).int64(start).uint32(32).int64(end);
    if (title) w.uint32(50).string(title);
    return w.finish();
  };
  const w = protobuf.Writer.create();
  for (const bytes of [encodeTerm(101, 4, 100, 200), encodeTerm(401, 1, 400, 500), encodeTerm(402, 1, 450, 550), encodeTerm(304, 5, 210, 290)]) w.uint32(10).bytes(bytes);
  w.uint32(16).int64(300);
  const data = normalizeSolarTermsInfo(w.finish());
  assert.equal(data.currentTerm, null);
  assert.equal(data.nextTerm.title, '重阳');
  assert.deepEqual(data.terms.map(x => x.title), ['重阳', '霜降', '寒露', '端午']);
  assert.equal(data.terms.find(x => x.id === 101).statusLabel, '已结束');
  assert.equal(data.terms[0].statusLabel, '未开始');
  assert.equal(data.claimableCount, 0);
  assert.equal(require('../src/config/gameConfig').getItemById(22254).name, '天山红枫种子');
  assert.equal(require('../src/config/gameConfig').getItemImageById(22254), '/game-config/seed_images_named/22254.png');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-monitor-routes-'));
process.env.FARM_DATA_DIR = dataDir;
const { registerAdminSettingsRoutes } = require('../src/controllers/admin-settings-routes');
const { writeMonitorState } = require('../src/services/friend-monitor-state');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function harness() {
  const routes = new Map();
  let reads = 0;
  registerAdminSettingsRoutes({
    app: Object.fromEntries(['get', 'post', 'put'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    store: {
      getConfigSnapshot: id => { reads++; assert.equal(id, 'a1'); return { friendMonitor: { enabled: true, friendGids: [9] } }; },
      readFriendListCache: id => { assert.equal(id, 'a1'); return [{ gid: 9, name: 'friend' }]; },
    },
    provider: { refreshAccountCode: async () => ({ ok: false }) },
    getAccountIdFromRequest: req => req.headers?.['x-account-id'] || '',
    canAccessAccount: (req, id) => req.currentUser?.username === 'alice' && id === 'a1',
  });
  return { reads: () => reads, invoke: async (req, route = 'get /api/settings/friend-monitor') => {
    let status = 200;
    let body;
    const res = { status: code => { status = code; return res; }, json: value => { body = value; return res; } };
    await routes.get(route)(req, res);
    return { status, body };
  } };
}

test('monitor status access checks happen before state/config reads', async () => {
  const f = harness();
  assert.equal((await f.invoke({ currentUser: { username: 'alice' } })).status, 400);
  assert.equal((await f.invoke({ headers: { 'x-account-id': 'a1' }, currentUser: { username: 'bob' } })).status, 403);
  assert.equal(f.reads(), 0);
});

test('monitor status returns only selected friends with durable previous/current data', async () => {
  const f = harness();
  writeMonitorState('a1', { friends: { 9: { previous: { lands: [] }, current: { name: 'friend', lands: [] } }, 10: { current: { name: 'unselected' } } } });
  const result = await f.invoke({ headers: { 'x-account-id': 'a1' }, currentUser: { username: 'alice' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.records.map(item => item.gid), [9]);
  assert.ok(result.body.data.records[0].previous);
  assert.ok(result.body.data.records[0].current);
  assert.equal(result.body.data.friends[0].name, 'friend');
});

test('manual relogin failures cannot be reported as successful API operations', async () => {
  const f = harness();
  const result = await f.invoke({ headers: { 'x-account-id': 'a1' }, currentUser: { username: 'alice' } }, 'post /api/settings/auto-code-refresh/run');
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /重登失败/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { registerAdminFriendRoutes } = require('../src/controllers/admin-friend-routes');

function routeFixture({ failure, allowed = true } = {}) {
  const routes = new Map();
  const calls = [];
  let known = [11, 22];
  const blacklist = [];
  registerAdminFriendRoutes({
    app: { get() {}, post: (url, handler) => routes.set(url, handler) },
    provider: {
      async delFriend(...args) {
        calls.push(['delete', ...args]);
        if (failure) throw failure;
      },
      broadcastConfig: id => calls.push(['broadcast', id]),
    },
    store: {
      getKnownFriendGids: () => known,
      setKnownFriendGids(id, gids) { known = gids; calls.push(['known', id, gids]); },
      addFriendToBlacklist(id, gid) { blacklist.push(gid); calls.push(['blacklist', id, gid]); },
    },
    getAccountIdFromRequest: req => req.headers['x-account-id'],
    canAccessAccount: () => allowed,
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
  });
  return {
    calls, blacklist, getKnown: () => known,
    async remove(gid = '11', accountId = 'a') {
      const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
      await routes.get('/api/friend/:gid/delete')({ params: { gid }, headers: { 'x-account-id': accountId } }, response);
      return response;
    },
  };
}

test('successful game deletion removes the known GID, blacklists and broadcasts after the request', async () => {
  const f = routeFixture();
  const response = await f.remove();
  assert.equal(response.body.ok, true);
  assert.deepEqual(f.getKnown(), [22]);
  assert.deepEqual(f.blacklist, [11]);
  assert.equal(f.calls[0][0], 'delete');
  assert.deepEqual(f.calls.at(-1), ['broadcast', 'a']);
});

test('failed game deletion preserves local config', async () => {
  const f = routeFixture({ failure: new Error('game rejected') });
  const response = await f.remove();
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, 'game rejected');
  assert.deepEqual(f.getKnown(), [11, 22]);
  assert.deepEqual(f.blacklist, []);
  assert.deepEqual(f.calls, [['delete', 'a', 11]]);
});

test('invalid GIDs and inaccessible accounts never call the game', async () => {
  const f = routeFixture();
  for (const gid of ['0', '-1', 'Infinity', '1.5', 'bad']) {
    assert.equal((await f.remove(gid)).statusCode, 400);
  }
  assert.equal((await f.remove('11', '')).statusCode, 400);
  assert.deepEqual(f.calls, []);
  const forbidden = routeFixture({ allowed: false });
  assert.equal((await forbidden.remove()).statusCode, 403);
  assert.deepEqual(forbidden.calls, []);
});

function serviceFixture(failure) {
  let cache = [{ gid: '11' }, { gid: 22 }];
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === './friend-api') return { async delFriend(gid) { if (failure) throw failure; return { gid }; } };
      if (name === './friend-land-analyzer') return {
        getFriendsListCache: () => cache,
        setFriendsListCache: value => { cache = value; },
      };
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/friend.js'), 'utf8'), context);
  return { ...context.module.exports, getCache: () => cache };
}

test('worker friend facade removes only the deleted friend from its memory cache', async () => {
  const f = serviceFixture();
  await f.delFriend(11);
  assert.deepEqual(Array.from(f.getCache(), friend => friend.gid), [22]);
});

test('worker friend facade preserves memory cache when deletion fails', async () => {
  const f = serviceFixture(new Error('game rejected'));
  await assert.rejects(f.delFriend(11), /game rejected/);
  assert.deepEqual(Array.from(f.getCache(), friend => friend.gid), ['11', 22]);
});

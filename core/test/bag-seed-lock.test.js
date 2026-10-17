const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const test = require('node:test');
const { types, loadProto } = require('../src/utils/proto');
const { registerAdminBagRoutes } = require('../src/controllers/admin-bag-routes');

function fixture(rawItems, options = {}) {
  const calls = [];
  const seedIds = [20001, 29004];
  const config = {
    getPlantBySeedId: id => seedIds.includes(id) ? { name: '种子', size: id === 29004 ? 2 : 1 } : null,
    getItemById: id => ({ name: `物品${id}`, type: seedIds.includes(id) ? 5 : 11 }),
    isSeedItem: id => seedIds.includes(id), getPlantByFruitId: id => [40525, 40002].includes(id) ? { name: '果实' } : null,
    getFruitName: id => `果实${id}`,
    getItemImageById: () => '', getSeedImageBySeedId: () => '', getSeedLevel: id => id === 29004 ? 200 : 1,
  };
  const path = require.resolve('../src/services/warehouse');
  const realRequire = createRequire(path);
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path, 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === '../config/gameConfig') return config;
      if (name === '../models/store') return { isAutomationOn: key => options.automation?.[key] === true };
      if (name === '../utils/utils') return { ...realRequire(name), log() {}, logWarn() {}, sleep: async () => {}, getServerTimeSec: () => options.now ?? 1792029600 };
      if (name === '../utils/network') return {
        networkEvents: { on() {}, emit() {} }, getUserState: () => ({}),
        async sendMsgAsync(service, method, body) {
          calls.push({ service, method, body });
          if (method === 'Bag') return { body: types.BagReply.encode({ item_bag: { items: rawItems } }).finish() };
          if (method === 'LockItems' || method === 'UnlockItems') {
            const request = types[`${method}Request`].decode(body);
            for (const uid of request.item_uids)
              rawItems.find(item => item.uid === Number(uid)).locked = method === 'LockItems';
            return { body: types[`${method}Reply`].encode({ item_uids: request.item_uids }).finish() };
          }
          return { body: types[`${method}Reply`].encode({}).finish() };
        },
      };
      return realRequire(name);
    }, console, Buffer, Date, Set, Map, Number,
  });
  return { warehouse: module.exports, calls };
}

test('item lock field and both UID protocols survive a binary round trip', async () => {
  await loadProto();
  const bag = types.BagReply.decode(types.BagReply.encode({ item_bag: { items: [{ id: 20001, uid: 123, count: 8, locked: true }] } }).finish());
  assert.equal(bag.item_bag.items[0].locked, true);
  for (const name of ['LockItems', 'UnlockItems']) {
    for (const suffix of ['Request', 'Reply']) {
      const type = types[`${name}${suffix}`];
      assert.deepEqual(type.decode(type.encode({ item_uids: [123, 9876543210] }).finish()).item_uids.map(Number), [123, 9876543210]);
    }
  }
});

test('locking validates all UIDs first, deduplicates and skips unchanged stacks', async () => {
  await loadProto();
  const f = fixture([{ id: 20001, uid: 11, count: 3 }, { id: 20001, uid: 12, count: 4, locked: true }, { id: 100003, uid: 13, count: 1 }]);
  await assert.rejects(f.warehouse.setItemsLocked([11, 13], true), /仅支持种子/);
  await assert.rejects(f.warehouse.setItemsLocked([11, 99], true), /未找到/);
  await assert.rejects(f.warehouse.setItemsLocked([0], true), /UID/);
  await assert.rejects(f.warehouse.setItemsLocked([11], 'false'), /布尔/);
  assert.equal(f.calls.filter(call => call.method === 'LockItems').length, 0);
  assert.equal((await f.warehouse.setItemsLocked([11, 11, 12], true)).changed, 1);
  const rpc = f.calls.find(call => call.method === 'LockItems');
  assert.equal(rpc.service, 'gamepb.itempb.ItemService');
  assert.deepEqual(types.LockItemsRequest.decode(rpc.body).item_uids.map(Number), [11]);
  assert.equal((await f.warehouse.setItemsLocked([11, 12], true)).changed, 0);
  assert.equal((await f.warehouse.setItemsLocked([11, 12], false)).changed, 2);
});

test('merged bag exposes partial locks and planting inventory excludes locked stacks of every size', async () => {
  await loadProto();
  const f = fixture([{ id: 20001, uid: 11, count: 3 }, { id: 20001, uid: 12, count: 4, locked: true }, { id: 29004, uid: 14, count: 2, locked: true }]);
  const bag = await f.warehouse.getBagDetail();
  const seed = bag.items.find(item => item.id === 20001);
  assert.equal(seed.count, 7); assert.equal(seed.lockedCount, 4); assert.equal(seed.unlockedCount, 3); assert.equal(seed.locked, false);
  assert.equal(bag.originalItems.find(item => item.uid === 12).locked, true);
  let seeds = await f.warehouse.getBagSeeds();
  assert.equal(seeds.length, 1); assert.equal(seeds[0].count, 3);
  await f.warehouse.setItemsLocked([14], false);
  seeds = await f.warehouse.getBagSeeds();
  const size2 = seeds.find(item => item.seedId === 29004);
  assert.equal(size2.count, 2); assert.equal(size2.plantSize, 2); assert.equal(size2.requiredLevel, 200);
});

test('locked seed cannot be sold or consumed with an explicit UID', async () => {
  await loadProto();
  const f = fixture([{ id: 20001, uid: 11, count: 3 }, { id: 20001, uid: 12, count: 4, locked: true }]);
  await assert.rejects(f.warehouse.sellItems([{ id: 20001, uid: 12, count: 4 }]), /锁定/);
  await assert.rejects(f.warehouse.useItem(20001, 1, 12), /锁定/);
  assert.equal(f.calls.some(call => ['Sell', 'Use'].includes(call.method)), false);
  await f.warehouse.sellItems([{ id: 20001, uid: 11, count: 3 }]);
  assert.equal(f.calls.some(call => call.method === 'Sell'), true);
});

test('automatic selling preserves both item locks and milk tea fruit reservation', async () => {
  await loadProto();
  for (const [craft, now, expected] of [
    [true, 1792029600, [40002]],
    [false, 1792029600, [40525, 40002]],
    [true, 1794671999, [40525, 40002]],
  ]) {
    const f = fixture([
      { id: 40525, uid: 11, count: 3 },
      { id: 40002, uid: 12, count: 4 },
      { id: 40002, uid: 13, count: 5, locked: true },
    ], { automation: { sell: true, milk_tea_craft: craft }, now });
    await f.warehouse.sellAllFruits();
    const sold = f.calls.filter(call => call.method === 'Sell').flatMap(call => types.SellRequest.decode(call.body).items);
    assert.deepEqual(sold.map(item => Number(item.id)), expected);
    assert.ok(sold.every(item => Number(item.uid) !== 13));
  }
});

test('lock route enforces account access and validates arguments before forwarding', async () => {
  const routes = new Map(); const calls = [];
  registerAdminBagRoutes({
    app: { get() {}, post: (path, fn) => routes.set(path, fn) },
    provider: { async setItemsLocked(...args) { calls.push(args); return { changed: 1 }; } },
    getAccountIdFromRequest: req => req.accountId, canAccessAccount: req => req.allowed,
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
  });
  const route = routes.get('/api/bag/lock');
  function response() { return { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; } }; }
  for (const [req, code] of [
    [{ allowed: true }, 400], [{ accountId: 'a', allowed: false }, 403],
    [{ accountId: 'a', allowed: true, body: { itemUids: [1], locked: 'true' } }, 400],
    [{ accountId: 'a', allowed: true, body: { itemUids: [Number.MAX_SAFE_INTEGER + 1], locked: true } }, 400],
  ]) { const res = response(); await route(req, res); assert.equal(res.code, code); }
  assert.equal(calls.length, 0);
  const res = response();
  await route({ accountId: 'a', allowed: true, body: { itemUids: [11], locked: false } }, res);
  assert.deepEqual(calls, [['a', [11], false]]); assert.equal(res.data.ok, true);
});

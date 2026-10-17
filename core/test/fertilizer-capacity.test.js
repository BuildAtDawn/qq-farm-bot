const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { fertilizerRefillInfo, containerSnapshot, planFertilizerUse } = require('../src/services/fertilizer-capacity');
const { types, loadProto } = require('../src/utils/proto');
const { registerAdminBagRoutes } = require('../src/controllers/admin-bag-routes');
const itemInfo = require('../src/gameConfig/ItemInfo.json');
const H = 3600;

test('standard refill definitions match official packaged items and packs remain distinct', () => {
  for (const [id, hours] of [[80001, 1], [80002, 4], [80003, 8], [80004, 12], [80011, 1], [80012, 4], [80013, 8], [80014, 12]]) {
    const info = itemInfo.find(item => item.id === id);
    const refill = fertilizerRefillInfo(id);
    assert.match(info.name, new RegExp(`${hours}小时`));
    assert.equal(refill.pool, info.interaction_type === 'fertilizerpro' ? 'organic' : 'normal');
    assert.equal(refill.secondsPerItem, hours * H);
    assert.equal(refill.capacitySeconds, 999 * H);
  }
  assert.equal(fertilizerRefillInfo(100003), null);
  assert.equal(fertilizerRefillInfo(100004), null);
  assert.equal(fertilizerRefillInfo(100005), null);
});

test('capacity uses exact seconds, allows the exact limit and never borrows the other pool', () => {
  const items = [{ id: 1011, count: 991 * H }, { id: 1012, count: 995 * H }, { id: 80003, uid: 5, count: 20 }, { id: 80012, uid: 6, count: 20 }];
  assert.equal(planFertilizerUse(items, 80003, 1).afterSeconds, 999 * H);
  assert.equal(planFertilizerUse(items, 80012, 1).afterSeconds, 999 * H);
  assert.throws(() => planFertilizerUse(items, 80003, 2), /最多可使用 1/);
  items[0].count++;
  assert.throws(() => planFertilizerUse(items, 80003, 1), /最多可使用 0/);
  items[0].count = 999 * H;
  items[1].count = 0;
  assert.equal(planFertilizerUse(items, 80012, 20).afterSeconds, 80 * H);
  assert.throws(() => planFertilizerUse(items, 80003, 1), /容量不足/);
  assert.equal(containerSnapshot([]).normal.seconds, 0);
});

test('plans allocate only unlocked UID stacks and reject invalid quantities and stale stock', () => {
  const items = [{ id: 80001, uid: 3, count: 5, locked: true }, { id: 80001, uid: 4, count: 2 }, { id: 80001, uid: 5, count: 3 }];
  assert.deepEqual(planFertilizerUse(items, 80001, 4).allocations, [{ uid: 4, count: 2 }, { uid: 5, count: 2 }]);
  assert.throws(() => planFertilizerUse(items, 80001, 6), /库存不足/);
  assert.throws(() => planFertilizerUse(items, 80001, 3, 4), /库存不足/);
  assert.throws(() => planFertilizerUse(items, 80001, 1, 3), /锁定/);
  for (const count of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => planFertilizerUse(items, 80001, count), /正整数/);
  assert.throws(() => containerSnapshot([{ id: 1011, count: -1 }]), /数据无效/);
  assert.throws(() => containerSnapshot([{ id: 1011, count: 'bad' }]), /数据无效/);
});

function warehouseFixture(items, options = {}) {
  const calls = [];
  const path = require.resolve('../src/services/warehouse');
  const realRequire = createRequire(path);
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path, 'utf8'), {
    module, exports: module.exports, console, Buffer,
    require(name) {
      if (name === '../config/gameConfig') return {
        getItemById: id => itemInfo.find(item => item.id === id) || options.extraInfo?.[id], getItemImageById: () => '',
        getPlantBySeedId: () => null, getPlantByFruitId: () => null, isSeedItem: () => false,
      };
      if (name === '../utils/utils') return { ...realRequire(name), log() {}, logWarn() {}, sleep: async () => {} };
      if (name === '../utils/network') return {
        networkEvents: { on() {}, emit() {} }, getUserState: () => ({}),
        async sendMsgAsync(_service, method, body) {
          if (method === 'Bag') {
            if (options.bagError) throw new Error('fixture bag failed');
            return { body: types.BagReply.encode({ item_bag: { items } }).finish() };
          }
          const request = types[`${method}Request`].decode(body);
          calls.push({ method, request });
          if (options.onUse) await options.onUse();
          return { body: types[`${method}Reply`].encode({}).finish() };
        },
      };
      return realRequire(name);
    },
  });
  return { warehouse: module.exports, calls };
}

test('worker re-reads capacity and preserves selected counts across multiple UIDs', async () => {
  await loadProto();
  const items = [{ id: 1011, count: 990 * H }, { id: 80001, uid: 8, count: 2 }, { id: 80001, uid: 9, count: 4 }];
  const f = warehouseFixture(items);
  const bag = await f.warehouse.getBagDetail();
  assert.equal(bag.fertilizerContainers.normal.seconds, 990 * H);
  assert.equal(bag.items.find(item => item.id === 80001).fertilizerRefill.secondsPerItem, H);
  await f.warehouse.useItem(80001, 3);
  assert.deepEqual(f.calls.map(call => [Number(call.request.item.uid), Number(call.request.item.count)]), [[8, 2], [9, 1]]);
  items[0].count = 999 * H;
  await assert.rejects(f.warehouse.useItem(80001, 1), /容量不足/);
  assert.equal(f.calls.length, 2);
});

test('manual refill blocks concurrent manual and automatic refills and releases on failure', async () => {
  await loadProto();
  let release;
  const options = { onUse: () => new Promise(resolve => { release = resolve; }) };
  const f = warehouseFixture([{ id: 80001, uid: 8, count: 20 }], options);
  const first = f.warehouse.useItem(80001, 1);
  for (let i = 0; i < 20; i++) {
    if (release) break;
    await Promise.resolve();
  }
  assert.equal(typeof release, 'function');
  await assert.rejects(f.warehouse.useItem(80001, 1), /正在补充/);
  assert.equal(await f.warehouse.openFertilizerGiftPacksSilently(), 0);
  release();
  await first;
  options.onUse = async () => { throw new Error('fixture use failed'); };
  await assert.rejects(f.warehouse.useItem(80001, 1), /fixture use failed/);
  options.onUse = null;
  await f.warehouse.useItem(80001, 1);
  options.bagError = true;
  await assert.rejects(f.warehouse.useItem(80001, 1), /fixture bag failed/);
  options.bagError = false;
  await f.warehouse.useItem(80001, 1);
});

test('automatic filling retains its 990-hour threshold with correct four-hour item duration', async () => {
  await loadProto();
  const f = warehouseFixture([{ id: 1011, count: 983 * H }, { id: 80002, uid: 8, count: 20 }]);
  assert.equal(await f.warehouse.openFertilizerGiftPacksSilently(), 1);
  assert.equal(f.calls[0].method, 'BatchUse');
  assert.equal(Number(f.calls[0].request.items[0].count), 1);
});

test('partial UID-stack failure is reported explicitly and stops further use', async () => {
  await loadProto();
  let attempts = 0;
  const f = warehouseFixture([{ id: 80001, uid: 8, count: 1 }, { id: 80001, uid: 9, count: 1 }, { id: 80001, uid: 10, count: 1 }], {
    onUse: async () => { if (++attempts === 2) throw new Error('fixture failed'); },
  });
  await assert.rejects(f.warehouse.useItem(80001, 3), /已使用 1 个化肥道具，其余未使用/);
  assert.equal(attempts, 2);
});

test('unconfirmed fertilizer duration is never guessed as one hour in manual or automatic use', async () => {
  await loadProto();
  const f = warehouseFixture([{ id: 80099, uid: 8, count: 20 }], {
    extraInfo: { 80099: { name: '未知时长化肥', interaction_type: 'fertilizer', type: 7 } },
  });
  await assert.rejects(f.warehouse.useItem(80099, 1), /未确认.*时长/);
  assert.equal(await f.warehouse.openFertilizerGiftPacksSilently(), 0);
  assert.equal(f.calls.length, 0);
});

test('manual use route rejects fractional, nonpositive and invalid UID input before provider calls', async () => {
  const routes = {};
  let calls = 0;
  registerAdminBagRoutes({
    app: { get() {}, post(path, handler) { routes[path] = handler; } },
    provider: { getBag() { calls++; } },
    getAccountIdFromRequest: () => 'a', canAccessAccount: () => true,
  });
  for (const body of [{ itemId: 80001, count: 0 }, { itemId: 80001, count: -1 }, { itemId: 80001, count: 1.5 }, { itemId: 80001, count: 1, uid: -1 }]) {
    const res = { status(code) { this.code = code; return this; }, json(value) { this.value = value; } };
    await routes['/api/bag/use']({ body }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(calls, 0);
});

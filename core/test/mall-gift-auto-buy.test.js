const test = require('node:test');
const assert = require('node:assert/strict');
const { getCouponGiftPurchase, createCouponGiftBuyer } = require('../src/services/mall-gift-auto-buy');
const goods = { goods_id: 1061, name: '奶茶点券礼包', type: 5, enabled: true,
  is_activity: true, end_time: 1792030600, is_limited: true,
  price: Buffer.from([8, 234, 7, 16, 25]), limit: Buffer.from([8, 4, 16, 1, 24, 3]) };
test('buys remaining quota only with valid coupon price, period and sufficient balance', () => {
  assert.equal(getCouponGiftPurchase(goods, 50, 1792029600), 2);
  assert.equal(getCouponGiftPurchase(goods, 49, 1792029600), 0);
  assert.equal(getCouponGiftPurchase(goods, 50, 1792030600), 0);
  for (const patch of [{ enabled: false }, { end_time: 0 }, { is_limited: false },
    { price: Buffer.from([8, 236, 7, 16, 25]) }, { limit: Buffer.from([8, 4, 16, 3, 24, 3]) }]) {
    assert.equal(getCouponGiftPurchase({ ...goods, ...patch }, 100, 1792029600), 0);
  }
});
test('respects switch, serializes overlapping runs, uses cooldown and server quota', async () => {
  let enabled = false; let purchases = 0; let timestamp = 1792029600000;
  const buyer = createCouponGiftBuyer({
    getAutomation: () => ({ mall_coupon_gift_buy: enabled }), getBalance: () => 100,
    getGoods: async () => [goods], purchase: async (id, count) => {
      assert.equal(id, 1061); assert.equal(count, 2); purchases++;
    }, report: () => {}, now: () => timestamp,
  });
  await buyer(); assert.equal(purchases, 0);
  enabled = true;
  await Promise.all([buyer(), buyer()]); assert.equal(purchases, 1);
  await buyer(); assert.equal(purchases, 1);
  timestamp = 1792030600000; // expired
  await buyer(); assert.equal(purchases, 1);
});
test('recorded gift response recognizes coupon pack and rejects all diamond packs', async () => {
  const { loadProto, types } = require('../src/utils/proto');
  await loadProto();
  const fixture = require('./fixtures/mall-gift-goods.json');
  const decoded = fixture.goods.map(raw => types.MallGoods.decode(Buffer.from(raw, 'base64')));
  const coupon = decoded.find(item => item.goods_id === 1061);
  assert.ok(coupon);
  assert.equal(getCouponGiftPurchase(coupon, 75, 1792041632), 3);
  for (const item of decoded.filter(item => item.goods_id !== 1061)) {
    assert.equal(getCouponGiftPurchase(item, 100000, 1792041632), 0);
  }
  assert.ok(decoded.some(item => item.goods_id === 10001));
  assert.ok(decoded.every(item => item.item_ids.every(raw => Number(types.CoreItem.decode(raw).count) > 0)));
});
test('disabling during query prevents purchase and purchase failures remain observable', async () => {
  let enabled = true; let purchased = false; const reports = [];
  const dependencies = {
    getAutomation: () => ({ mall_coupon_gift_buy: enabled }), getBalance: () => 100,
    getGoods: async () => { enabled = false; return [goods]; },
    purchase: async () => { purchased = true; throw new Error('recorded failure'); },
    report: (...args) => reports.push(args), now: () => 1792029600000,
  };
  await createCouponGiftBuyer(dependencies)();
  assert.equal(purchased, false);
  enabled = true;
  await createCouponGiftBuyer({ ...dependencies, getGoods: async () => [goods] })();
  assert.equal(purchased, true);
  assert.match(reports[0][0], /recorded failure/);
  assert.equal(reports[0][1], 'error');
});
test('never queries outside milk tea window or buys other coupon packs', async () => {
  assert.equal(getCouponGiftPurchase({ ...goods, goods_id: 9999 }, 100, 1792029600), 0);
  for (const time of [1792029599000, 1794844800000]) {
    let queried = false;
    const buyer = createCouponGiftBuyer({
      getAutomation: () => ({ mall_coupon_gift_buy: true }), getBalance: () => 100,
      getGoods: async () => { queried = true; return [goods]; },
      purchase: async () => assert.fail('must not purchase'), report: () => {}, now: () => time,
    });
    await buyer();
    assert.equal(queried, false);
  }
});

test('uses live coupon balance and retries insufficient funds on the next check', async () => {
  const { getCouponGiftBalance } = require('../src/services/mall-gift-auto-buy');
  const state = { coupon: 49 };
  let time = 1792029600000;
  const purchases = [];
  const reports = [];
  const buyer = createCouponGiftBuyer({
    getAutomation: () => ({ mall_coupon_gift_buy: true }),
    getBalance: () => getCouponGiftBalance(state), getGoods: async () => [goods],
    purchase: async (...args) => purchases.push(args),
    report: (...args) => reports.push(args), now: () => time,
  });
  await buyer();
  assert.equal(purchases.length, 0);
  assert.equal(reports[0][1], 'skip');
  assert.match(reports[0][0], /50.*49/);
  state.coupon = 50;
  time += 600000;
  await buyer();
  assert.deepEqual(purchases, [[1061, 2]]);
  assert.equal(getCouponGiftBalance({ ticket: 100 }), 0);
});

test('save-triggered check bypasses cooldown while preserving concurrency and switch checks', async () => {
  let purchases = 0;
  let enabled = true;
  const buyer = createCouponGiftBuyer({
    getAutomation: () => ({ mall_coupon_gift_buy: enabled }), getBalance: () => 100,
    getGoods: async () => [goods], purchase: async () => { purchases++; },
    report: () => {}, now: () => 1792029600000,
  });
  await buyer();
  await buyer();
  assert.equal(purchases, 1);
  await Promise.all([buyer(true), buyer(true)]);
  assert.equal(purchases, 2);
  enabled = false;
  await buyer(true);
  assert.equal(purchases, 2);
});

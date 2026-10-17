const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseMallLimitInfo,
  parseMallPriceInfo,
  parseMallPriceValue,
} = require('../src/services/mall');

test('parses mall price from the item count instead of the currency id', () => {
  assert.equal(parseMallPriceValue(Buffer.from('08ec071019', 'hex')), 25);
  assert.deepEqual(parseMallPriceInfo(Buffer.from('08ec071019', 'hex')), {
    currencyId: 1004,
    price: 25,
  });
  assert.deepEqual(parseMallPriceInfo(Buffer.from('08ea071019', 'hex')), {
    currencyId: 1002,
    price: 25,
  });
});

test('parses daily and activity purchase limits from current mall protocol', () => {
  assert.deepEqual(parseMallLimitInfo(Buffer.from('08011802', 'hex')), {
    limitType: 1,
    limitCount: 2,
    boughtNum: 0,
  });
  assert.deepEqual(parseMallLimitInfo(Buffer.from('080410031803', 'hex')), {
    limitType: 4,
    limitCount: 3,
    boughtNum: 3,
  });
});

test('optional gift slot failure does not hide the existing fertilizer shop', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const { loadProto, types } = require('../src/utils/proto');
  await loadProto();
  const file = require.resolve('../src/services/mall');
  const realRequire = createRequire(file);
  const logs = [];
  const slots = [];
  let giftFailure = true;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, Buffer, console,
    require(name) {
      if (name === '../utils/utils') return { ...realRequire(name), log: (...args) => logs.push(args) };
      if (name === '../utils/network') return { getUserState: () => ({}), sendMsgAsync: async (_service, _method, bytes) => {
        const slot = types.GetMallListBySlotTypeRequest.decode(bytes).slot_type;
        slots.push(slot);
        if (slot === 5 && giftFailure) throw new Error('gift slot unavailable');
        const goods = [types.MallGoods.encode({ goods_id: slot === 1 ? 1002 : 1061 }).finish()];
        return { body: types.GetMallListBySlotTypeResponse.encode({ goods_list: goods }).finish() };
      } };
      return realRequire(name);
    },
  });
  assert.deepEqual(Array.from(await module.exports.getAllMallGoods(), item => Number(item.goods_id)), [1002]);
  assert.deepEqual(slots, [1, 5]);
  assert.equal(logs.length, 1);
  assert.match(logs[0][1], /gift slot unavailable/);
  giftFailure = false;
  assert.deepEqual(Array.from(await module.exports.getAllMallGoods(), item => Number(item.goods_id)), [1002, 1061]);
});

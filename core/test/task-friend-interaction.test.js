const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function fixture(options = {}) {
  const calls = [];
  const state = { enabled: true, quiet: false, blacklist: [], protected: false, remaining: 10, ...options };
  const analysis = {
    needWeed: [], needBug: [], needWater: [], canPutWeed: [4, 5, 6], ...options.analysis,
  };
  const action = name => async (gid, ids) => {
    calls.push([name, gid, Array.from(ids)]);
    if (state.fail === name) throw new Error('fixture timeout');
    return { ok: state.writeFailed ? 0 : 1 };
  };
  const mocks = {
    '../models/store': { getFriendBlacklist: () => state.blacklist },
    '../utils/network': { getUserState: () => ({ gid: 1 }) },
    '../utils/utils': { toNum: Number, log() {}, logWarn() {} },
    './stats': { recordOperation: (...args) => calls.push(['stat', ...args]) },
    './friend-land-analyzer': {
      getFriendsList: async () => options.friends || [{ gid: 2, name: '好友' }, { gid: 3 }],
      analyzeFriendLands: () => analysis,
    },
    './friend-monitor-protection': { isMonitoredFriendProtected: () => state.protected },
    './friend-api': {
      inFriendQuietHours: () => state.quiet,
      handleFriendEnterError() {},
      enterFriendFarm: async (gid, { shouldContinue }) => {
        calls.push(['enter', gid]);
        if (options.cancelInQueue) state.enabled = false;
        if (!shouldContinue()) throw new Error('cancelled');
        if (state.fail === 'enter') throw new Error('entry failed');
        return { lands: [] };
      },
      leaveFriendFarm: async gid => calls.push(['leave', gid]),
      checkCanOperateRemote: async (gid, id) => {
        calls.push(['check', gid, id]);
        if (options.cancelAfterCheck) state.enabled = false;
        return { canOperate: !state.remoteDenied };
      },
    },
    './friend-operation-limits': {
      checkDailyReset() {},
      getRemainingTimes: () => state.remaining,
      getBadRemainingTimes: () => state.sharedRemaining ?? state.remaining,
      PUT_WEED_OPERATION_ID: 10006, BAD_DAILY_LIMIT: 100,
      helpWeed: action('helpWeed'), helpInsecticide: action('helpBug'),
      helpWater: action('helpWater'), putDailyTaskWeed: (gid, landId) => action('putWeed')(gid, [landId]),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/task-friend-interaction.js'), 'utf8'), {
    module, process: { env: {} }, require: name => {
      assert.ok(mocks[name], `unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  return { state, calls, run: () => module.exports.completeDailyFriendInteraction(() => state.enabled) };
}

test('help is preferred and stops after one successful action on one land', async () => {
  for (const [field, operation] of [['needWeed', 'helpWeed'], ['needBug', 'helpBug'], ['needWater', 'helpWater']]) {
    const f = fixture({ analysis: { [field]: [8, 9] } });
    assert.equal(await f.run(), true);
    assert.deepEqual(f.calls.filter(call => call[0] === operation), [[operation, 2, [8]]]);
    assert.equal(f.calls.some(call => call[0] === 'putWeed'), false);
    assert.deepEqual(f.calls.at(-1), ['leave', 2]);
  }
});

test('no help available places exactly one weed, on one land, in one farm', async () => {
  const f = fixture();
  assert.equal(await f.run(), true);
  assert.deepEqual(f.calls.filter(call => call[0] === 'putWeed'), [['putWeed', 2, [4]]]);
  assert.equal(f.calls.filter(call => call[0] === 'enter').length, 1);
  assert.deepEqual(f.calls.at(-1), ['leave', 2]);
});

test('blacklisted/self friends are skipped while the daily objective may weed a protected farm', async () => {
  const blocked = fixture({ blacklist: [2], friends: [{ gid: 1 }, { gid: 2 }, { gid: 3 }] });
  await blocked.run();
  assert.deepEqual(blocked.calls.find(call => call[0] === 'enter'), ['enter', 3]);
  const protectedFarm = fixture({ protected: true });
  assert.equal(await protectedFarm.run(), true);
  assert.deepEqual(protectedFarm.calls.filter(call => call[0] === 'putWeed'), [['putWeed', 2, [4]]]);
  const help = fixture({ protected: true, analysis: { needWater: [9] } });
  assert.equal(await help.run(), true);
});

test('quotas, quiet hours, missing friends and remote denial do not bypass protections', async () => {
  for (const options of [{ remaining: 0 }, { sharedRemaining: 0 }, { quiet: true }, { friends: [] }, { remoteDenied: true }, { analysis: { canPutWeed: [] } }]) {
    const f = fixture(options);
    assert.equal(await f.run(), false);
    assert.equal(f.calls.some(call => call[0] === 'putWeed'), false);
  }
});

test('a help need never falls back to trouble even when help is denied or fails', async () => {
  for (const options of [{ remoteDenied: true }, { fail: 'helpWater' }]) {
    const f = fixture({ ...options, analysis: { needWater: [9] } });
    assert.equal(await f.run(), false);
    assert.equal(f.calls.some(call => call[0] === 'putWeed'), false);
    assert.ok(f.calls.some(call => call[0] === 'leave'));
  }
});

test('disable while queued or checking remote state prevents the write', async () => {
  for (const options of [{ enabled: false }, { cancelInQueue: true }, { cancelAfterCheck: true }]) {
    const f = fixture(options);
    assert.equal(await f.run(), false);
    assert.equal(f.calls.some(call => call[0] === 'putWeed'), false);
    if (options.cancelAfterCheck) assert.deepEqual(f.calls.at(-1), ['leave', 2]);
  }
});

test('ambiguous write failure stops instead of affecting another friend and always leaves', async () => {
  const f = fixture({ fail: 'putWeed' });
  assert.equal(await f.run(), false);
  assert.equal(f.calls.filter(call => call[0] === 'putWeed').length, 1);
  assert.deepEqual(f.calls.at(-1), ['leave', 2]);
});

test('daily weed exception is single-land, quota-counted and cannot unlock ordinary mutations', async () => {
  const calls = [];
  const codec = { create: value => value, encode: value => ({ finish: () => value }), decode: value => value };
  const module = { exports: {} };
  const mocks = {
    '../utils/utils': {
      toNum: value => Number(value) || 0, toLong: Number,
      log() {}, sleep: async () => {}, randomDelay: async () => {},
      getServerTimeSec: () => 1792166400,
    },
    '../utils/network': {
      getUserState: () => ({}), networkEvents: { emit() {} },
      sendMsgAsync: async (_service, method, payload) => {
        calls.push([method, payload]);
        return { body: { operation_limits: [] } };
      },
    },
    '../utils/proto': { types: new Proxy({}, { get: () => codec }) },
    './friend-monitor-protection': { assertFriendMutationAllowed() { throw new Error('监听保护'); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/friend-operation-limits.js'), 'utf8'), {
    module, require: name => {
      assert.ok(mocks[name], `unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  const operations = module.exports;
  await assert.rejects(operations.putWeedsDetailed(9, [1]), /监听保护/);
  await assert.rejects(operations.putInsectsDetailed(9, [1]), /监听保护/);
  await assert.rejects(operations.stealHarvest(9, [1]), /监听保护/);
  await assert.rejects(operations.putPlantItemsDetailed(9, [1], codec, codec, 'PutWeeds', { bypass: true }), /监听保护/);
  assert.equal(calls.length, 0);
  assert.equal((await operations.putDailyTaskWeed(9, 5)).ok, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'PutWeeds');
  assert.deepEqual(Array.from(calls[0][1].land_ids), [5]);
  assert.equal(operations.getBadRemainingTimes(operations.PUT_WEED_OPERATION_ID), 99);
  await assert.rejects(operations.putDailyTaskWeed(9, [1, 2]), /无效/);
  operations.updateOperationLimits([{ id: operations.BAD_SHARED_LIMIT_ID, day_times: 100, day_times_lt: 100 }]);
  assert.equal((await operations.putDailyTaskWeed(9, 6)).ok, 0);
  assert.equal(calls.length, 1);
  await assert.rejects(operations.putWeedsDetailed(9, [1]), /监听保护/);
});

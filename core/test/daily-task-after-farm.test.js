const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-daily-task-'));
process.env.FARM_DATA_DIR = dataDir;
const store = require('../src/models/store');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function schedulerFixture() {
  const tasks = new Map();
  return {
    tasks,
    clear: key => tasks.delete(key),
    clearAll: () => tasks.clear(),
    setTimeoutTask: (key, delay, callback) => tasks.set(key, { delay, callback }),
    setIntervalTask: (key, delay, callback) => tasks.set(key, { delay, callback }),
  };
}

function farmFixture(events, getAllLands = async () => ({ lands: [] })) {
  const scheduler = schedulerFixture();
  const context = { module: { exports: {} } };
  const state = { farm: true, farm_push: true, connected: true, gid: 1 };
  const mocks = {
    '../config/config': { CONFIG: { farmCheckInterval: 2000 } },
    '../utils/network': { networkEvents: events, getUserState: () => state, isConnected: () => state.connected },
    '../utils/utils': { log: () => {}, logWarn: () => {} },
    '../models/store': { isAutomationOn: key => state[key] },
    './scheduler': { createScheduler: () => scheduler },
    './farm-api': { getAllLands },
    './farm-scheduler': { startFertilizerBuyCheckTimer: () => {}, stopFertilizerBuyCheckTimer: () => {} },
    './mutation-operation-gate': { farmOperationGate: require('../src/services/mutation-operation-gate').createOperationGate() },
  };
  context.require = name => mocks[name] || {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/farming-orchestrator.js'), 'utf8'), context);
  return { ...context.module.exports, scheduler, state };
}

function dailyFixture(events = new EventEmitter()) {
  const source = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
  const block = source.slice(source.indexOf('/** 每日任务是否启用 */'), source.indexOf('// ==================== 活动自动控制'));
  const calls = [];
  const automation = { task: true, task_after_farm: false };
  const scheduler = schedulerFixture();
  const context = {
    dailyRoutineRunning: false, loginReady: true, friendSyncPaused: false,
    lastDailyRunDate: '', networkEvents: events, workerScheduler: scheduler,
    getAutomation: () => automation, log: (...args) => calls.push(['error', ...args]),
    runBadOnceOnStartup: async () => {},
    require(name) {
      assert.equal(name, '../services/mall-gift-auto-buy');
      return { autoBuyCouponGifts: async () => {
        calls.push(['coupon']);
        if (context.couponError) throw new Error('coupon fixture failure');
      } };
    },
  };
  const services = {
    checkAndClaimEmails: 'email', checkAndClaimTasks: 'task',
    openFertilizerGiftPacksSilently: 'fertilizer', performDailyShare: 'share',
    performDailyMonthCardGift: 'monthcard', buyFreeGifts: 'freegift', performDailyVipGift: 'vip',
  };
  for (const [key, label] of Object.entries(services)) {
    context[key] = async (...args) => { calls.push([label, ...args]); };
  }
  vm.createContext(context);
  vm.runInContext(`${block}\nthis.api = { runDailyRoutines, startDailyRoutineTimer, stopDailyRoutineTimer };`, context);
  return { ...context.api, events, context, automation, calls, scheduler };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('post-farm task switch defaults off and survives account config persistence', () => {
  assert.equal(store.getDefaultAccountConfig().automation.task_after_farm, false);
  store.applyConfigSnapshot({ automation: { task_after_farm: true } }, { accountId: 'fixture' });
  assert.equal(store.getAutomation('fixture').task_after_farm, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
  assert.equal(saved.accountConfigs.fixture.automation.task_after_farm, true);
  assert.equal(store.getAutomation('other').task_after_farm, false);
});

test('successful farm rounds notify exactly once after the operation completes, including idle rounds', async () => {
  const events = new EventEmitter();
  const calls = [];
  let finish;
  const farm = farmFixture(events, () => new Promise(resolve => { finish = resolve; }));
  events.on('farmCheckCompleted', () => calls.push('daily'));
  const pending = farm.checkFarm();
  assert.deepEqual(calls, []);
  await farm.checkFarm(); // A concurrent round must not produce another completion.
  finish({ lands: [] });
  await pending;
  assert.deepEqual(calls, ['daily']);
  const idleFarm = farmFixture(events);
  await idleFarm.checkFarm();
  assert.deepEqual(calls, ['daily', 'daily']);
});

test('disabled, offline, unidentified and failed farm rounds never trigger daily tasks', async () => {
  for (const patch of [{ farm: false }, { connected: false }, { gid: 0 }]) {
    const events = new EventEmitter();
    let count = 0;
    events.on('farmCheckCompleted', () => count++);
    const farm = farmFixture(events);
    Object.assign(farm.state, patch);
    await farm.checkFarm();
    assert.equal(count, 0);
  }
  const events = new EventEmitter();
  let count = 0;
  events.on('farmCheckCompleted', () => count++);
  const farm = farmFixture(events, async () => { throw new Error('fixture failure'); });
  await farm.checkFarm();
  assert.equal(count, 0);
});

test('the switch applies immediately to periodic and push-triggered farm rounds', async () => {
  const daily = dailyFixture();
  daily.startDailyRoutineTimer();
  await flush();
  daily.calls.length = 0;
  const farm = farmFixture(daily.events);
  farm.startFarmCheckLoop();
  await farm.scheduler.tasks.get('farm_check_loop').callback();
  await flush();
  assert.deepEqual(daily.calls, []);

  daily.automation.task_after_farm = true;
  await farm.scheduler.tasks.get('farm_check_loop').callback();
  await flush();
  assert.deepEqual(daily.calls.map(call => call[0]), ['email', 'task', 'share', 'monthcard', 'freegift', 'vip']);
  assert.equal(daily.calls[0][1], false, 'preserve daily-service cooldowns');
  daily.calls.length = 0;

  farm.stopFarmCheckLoop();
  farm.startFarmCheckLoop({ externalScheduler: true });
  daily.events.emit('landsChanged', [{ id: 1 }]);
  await farm.scheduler.tasks.get('farm_push_check').callback();
  await flush();
  assert.equal(daily.calls.filter(call => call[0] === 'task').length, 1);

  daily.calls.length = 0;
  daily.automation.task_after_farm = false;
  await farm.checkFarm();
  await flush();
  assert.deepEqual(daily.calls, []);
});

test('daily runs honor the task switch and account readiness', async () => {
  const daily = dailyFixture();
  daily.startDailyRoutineTimer();
  await flush();
  daily.calls.length = 0;
  daily.automation.task_after_farm = true;
  daily.automation.task = false;
  daily.events.emit('farmCheckCompleted');
  await flush();
  assert.ok(daily.calls.some(call => call[0] === 'email'));
  assert.equal(daily.calls.some(call => call[0] === 'task'), false);
  for (const patch of [{ loginReady: false }, { loginReady: true, friendSyncPaused: true }]) {
    daily.calls.length = 0;
    Object.assign(daily.context, patch);
    daily.events.emit('farmCheckCompleted');
    await flush();
    assert.deepEqual(daily.calls, []);
  }
});

test('overlapping daily triggers are merged and failures release the running guard', async () => {
  const daily = dailyFixture();
  let finish;
  let count = 0;
  daily.context.checkAndClaimEmails = () => {
    count++;
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = daily.runDailyRoutines();
  const overlapping = daily.runDailyRoutines();
  assert.equal(count, 1);
  finish();
  await Promise.all([pending, overlapping]);
  daily.context.checkAndClaimEmails = async () => { throw new Error('fixture failure'); };
  await daily.runDailyRoutines();
  assert.equal(daily.calls.filter(call => call[0] === 'error').length, 1);
  daily.context.checkAndClaimEmails = async () => {};
  daily.calls.length = 0;
  await daily.runDailyRoutines();
  assert.equal(daily.calls.filter(call => call[0] === 'task').length, 1);
});

test('restarting daily timers registers one listener and stopping removes it', async () => {
  const daily = dailyFixture();
  daily.startDailyRoutineTimer();
  await flush();
  daily.startDailyRoutineTimer();
  await flush();
  assert.equal(daily.events.listenerCount('farmCheckCompleted'), 1);
  daily.stopDailyRoutineTimer();
  assert.equal(daily.events.listenerCount('farmCheckCompleted'), 0);
  assert.equal(daily.scheduler.tasks.has('daily_routine_interval'), false);
  daily.calls.length = 0;
  daily.automation.task_after_farm = true;
  daily.events.emit('farmCheckCompleted');
  await flush();
  assert.deepEqual(daily.calls, []);
});

test('coupon gifts stay opt-in and cannot interrupt existing daily rewards', async () => {
  const daily = dailyFixture();
  await daily.runDailyRoutines();
  assert.equal(daily.calls.some(call => call[0] === 'coupon'), false);
  daily.calls.length = 0;
  daily.automation.mall_coupon_gift_buy = true;
  daily.context.couponError = true;
  await daily.runDailyRoutines();
  assert.deepEqual(daily.calls.map(call => call[0]), ['email', 'task', 'share', 'monthcard', 'freegift', 'vip', 'coupon', 'error']);
  assert.equal(daily.context.dailyRoutineRunning, false);
});

test('same-day coupon retries require an enabled, ready and unpaused account', async () => {
  const daily = dailyFixture();
  daily.startDailyRoutineTimer();
  await flush();
  const tick = daily.scheduler.tasks.get('daily_routine_interval').callback;
  for (const [enabled, ready, paused, expected] of [
    [false, true, false, 0], [true, true, false, 1],
    [true, false, false, 0], [true, true, true, 0],
  ]) {
    daily.calls.length = 0;
    daily.automation.mall_coupon_gift_buy = enabled;
    daily.context.loginReady = ready;
    daily.context.friendSyncPaused = paused;
    tick();
    await flush();
    assert.equal(daily.calls.filter(call => call[0] === 'coupon').length, expected);
  }
});

test('enabling coupon gifts schedules a forced check but rechecks account state before running', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
  const start = source.indexOf('if (!prevAuto?.mall_coupon_gift_buy && newAuto?.mall_coupon_gift_buy)');
  const end = source.indexOf('// 每日任务从关变开', start);
  assert.ok(start >= 0 && end > start);
  for (const [prev, next, enabled, ready, paused, expected] of [
    [false, true, true, true, false, 1], [true, true, true, true, false, 0],
    [false, false, false, true, false, 0], [false, true, false, true, false, 0],
    [false, true, true, false, false, 0], [false, true, true, true, true, 0],
  ]) {
    const scheduler = schedulerFixture();
    const calls = [];
    vm.runInNewContext(source.slice(start, end), {
      prevAuto: { mall_coupon_gift_buy: prev }, newAuto: { mall_coupon_gift_buy: next },
      loginReady: ready, friendSyncPaused: paused, workerScheduler: scheduler,
      getAutomation: () => ({ mall_coupon_gift_buy: enabled }),
      require: () => ({ autoBuyCouponGifts: async force => { calls.push(force); } }),
    });
    const task = scheduler.tasks.get('mall_coupon_gift_buy_after_save');
    if (task) { assert.equal(task.delay, 2000); task.callback(); }
    await flush();
    assert.deepEqual(calls, expected ? [true] : []);
  }
});

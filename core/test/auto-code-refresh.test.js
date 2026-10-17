const test = require('node:test');
const assert = require('node:assert/strict');

const { createAutoCodeRefreshService } = require('../src/runtime/auto-code-refresh');

function createService(account, logs) {
  return createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: () => ({ enabled: false, intervalMinutes: 60 }),
    },
    getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
    log: (...args) => logs.push(args),
    addAccountLog: () => {},
  });
}

test('QQ accounts do not emit a missing wxid warning during Code refresh scheduling', () => {
  const logs = [];
  const service = createService({ id: 'qq-1', name: 'QQ account', platform: 'qq' }, logs);

  service.scheduleAccount('qq-1');

  assert.deepEqual(logs, []);
});

test('WeChat accounts still report a missing wxid during Code refresh scheduling', () => {
  const logs = [];
  const service = createService({ id: 'wx-1', name: 'WeChat account', platform: 'wx' }, logs);

  service.scheduleAccount('wx-1');

  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], '自动刷新 Code 未启动: 账号缺少 wxid');
});

function recoveryFixture(options = {}) {
  let now = 1000000;
  let connected = false;
  const config = { enabled: false, intervalMinutes: 60, offlineEnabled: true, offlineDelaySeconds: 60 };
  let account = { id: 'wx1', platform: 'wx', name: 'fixture', wxid: 'fixture-wx', loginBuffer: 'fixture-buffer', ...options.account };
  const tasks = new Map();
  const starts = [];
  const reminders = [];
  let calls = 0;
  const service = createAutoCodeRefreshService({
    store: { getAutoCodeRefresh: () => config }, getAccounts: () => ({ accounts: account ? [account] : [] }),
    addOrUpdateAccount: next => { account = next; },
    resolveWorkerControls: () => ({ restartWorker: next => { starts.push(next); return true; } }),
    log: () => {}, addAccountLog: () => {}, triggerOfflineReminder: value => reminders.push(value),
    now: () => now, isAccountConnected: () => connected, isAccountRunning: () => true,
    scheduler: { clear: key => tasks.delete(key), dispose: () => tasks.clear(),
      setTimeoutTask: (key, delay, run) => tasks.set(key, { delay, run }),
      setIntervalTask: (key, delay, run) => tasks.set(key, { delay, run }) },
    requestFarmCode: async () => { calls++; return options.request ? options.request() : 'fixture-code'; },
  });
  return { service, config, tasks, starts, reminders, calls: () => calls,
    setNow: value => { now = value; }, setConnected: value => { connected = value; }, deleteAccount: () => { account = null; } };
}

test('offline recovery works independently of periodic relogin and repeated events keep initial deadline', async () => {
  const f = recoveryFixture();
  f.service.scheduleAccount('wx1');
  assert.equal(f.tasks.has('refresh_wx1'), false);
  assert.equal(f.service.scheduleRelogin('wx1', 'kickout'), true);
  const original = f.tasks.get('relogin_wx1');
  assert.equal(original.delay, 60000);
  f.setNow(1060000);
  f.service.scheduleRelogin('wx1', 'offline');
  assert.equal(f.tasks.get('relogin_wx1'), original);
  await original.run();
  assert.equal(f.starts.length, 1);
});

test('manual stop cancels pending recovery even without a worker; in-flight refresh cannot restart after stop', async () => {
  let resolve;
  const f = recoveryFixture({ request: () => new Promise(done => { resolve = done; }) });
  f.service.scheduleRelogin('wx1');
  f.service.stopAccount('wx1');
  assert.equal(f.tasks.has('relogin_wx1'), false);
  const task = f.service.refreshAccountCode('wx1', 'manual_start');
  f.service.stopAccount('wx1');
  resolve('fixture');
  assert.equal(await task, false);
  assert.equal(f.starts.length, 0);
});

test('recovery cancellation on online state/config change/deletion and overlapping refresh dedupe', async () => {
  const f = recoveryFixture();
  f.service.scheduleRelogin('wx1');
  f.setConnected(true);
  await f.tasks.get('relogin_wx1').run();
  assert.equal(f.calls(), 0);
  f.setConnected(false);
  f.service.scheduleRelogin('wx1');
  f.config.offlineEnabled = false;
  f.service.scheduleAccount('wx1');
  assert.equal(f.tasks.has('relogin_wx1'), false);
  assert.equal(await f.service.refreshAccountCode('wx1', 'ws_400'), false);
  await Promise.all([f.service.refreshAccountCode('wx1', 'manual'), f.service.refreshAccountCode('wx1', 'manual')]);
  assert.equal(f.calls(), 1);
  f.deleteAccount();
  assert.equal(await f.service.refreshAccountCode('wx1', 'manual'), false);
});

test('offline refresh failures retry finitely; invalid credentials stop and notify immediately', async () => {
  const f = recoveryFixture({ request: async () => { throw new Error('network'); } });
  f.service.scheduleRelogin('wx1');
  await f.tasks.get('relogin_wx1').run();
  assert.equal(f.reminders.length, 1);
  for (let i = 0; i < 2; i++) await f.tasks.get('relogin_wx1').run();
  assert.equal(f.calls(), 3);
  assert.equal(f.service.scheduleRelogin('wx1'), true);
  assert.equal(f.reminders.length, 1);
  const expired = recoveryFixture({ request: async () => { throw new Error('凭证过期，请重新扫码'); } });
  expired.service.scheduleRelogin('wx1');
  await expired.tasks.get('relogin_wx1').run();
  assert.equal(expired.service.scheduleRelogin('wx1'), true);
  assert.equal(expired.reminders.length, 1);
});

test('successful Code retrieval waits for actual login and online status suppresses notification', async () => {
  const f = recoveryFixture();
  f.service.scheduleRelogin('wx1');
  await f.tasks.get('relogin_wx1').run();
  assert.equal(f.reminders.length, 0);
  assert.equal(f.tasks.get('login_check_wx1').delay, 60000);
  assert.equal(f.service.scheduleRelogin('wx1', 'ws_400'), true);
  assert.equal(f.calls(), 1);
  const check = f.tasks.get('login_check_wx1');
  f.setConnected(true);
  f.service.cancelRelogin('wx1');
  await check.run();
  assert.equal(f.reminders.length, 0);
  assert.equal(f.tasks.has('login_check_wx1'), false);
});

test('started worker failing to login notifies once, retries finitely and respects manual stop', async () => {
  const f = recoveryFixture();
  f.service.scheduleRelogin('wx1');
  for (let i = 0; i < 3; i++) {
    await f.tasks.get('relogin_wx1').run();
    await f.tasks.get('login_check_wx1').run();
  }
  assert.equal(f.reminders.length, 1);
  assert.equal(f.service.scheduleRelogin('wx1'), true);
  const stopped = recoveryFixture();
  stopped.service.scheduleRelogin('wx1');
  await stopped.tasks.get('relogin_wx1').run();
  const check = stopped.tasks.get('login_check_wx1');
  stopped.service.stopAccount('wx1');
  await check.run();
  assert.equal(stopped.reminders.length, 0);
});

test('offline recovery exposes the original deadline and switches to logging in until connected', async () => {
  let resolve;
  const f = recoveryFixture({ request: () => new Promise(done => { resolve = done; }) });
  assert.equal(f.service.getAccountLoginState('wx1'), null);
  f.service.scheduleRelogin('wx1');
  assert.deepEqual(f.service.getAccountLoginState('wx1'), { runtimeState: 'relogin_waiting', reloginAt: 1060000 });
  f.setNow(1020000);
  f.service.scheduleRelogin('wx1');
  assert.equal(f.service.getAccountLoginState('wx1').reloginAt, 1060000);
  const task = f.tasks.get('relogin_wx1').run();
  assert.deepEqual(f.service.getAccountLoginState('wx1'), { runtimeState: 'logging_in', reloginAt: null });
  resolve('fixture-code');
  await task;
  assert.equal(f.service.getAccountLoginState('wx1').runtimeState, 'logging_in');
  f.setConnected(true);
  f.service.cancelRelogin('wx1');
  assert.equal(f.service.getAccountLoginState('wx1'), null);
});

test('manual stop clears waiting and in-flight login state immediately', async () => {
  let resolve;
  const f = recoveryFixture({ request: () => new Promise(done => { resolve = done; }) });
  f.service.scheduleRelogin('wx1');
  f.service.stopAccount('wx1');
  assert.equal(f.service.getAccountLoginState('wx1'), null);
  const task = f.service.refreshAccountCode('wx1', 'manual_start');
  assert.equal(f.service.getAccountLoginState('wx1').runtimeState, 'logging_in');
  f.service.stopAccount('wx1');
  assert.equal(f.service.getAccountLoginState('wx1'), null);
  resolve('fixture-code');
  assert.equal(await task, false);
});

test('changing seconds reschedules from disconnection; disabling recovery removes the countdown', () => {
  const f = recoveryFixture();
  f.service.scheduleRelogin('wx1');
  f.setNow(1010000);
  f.config.offlineDelaySeconds = 25;
  f.service.scheduleAccount('wx1');
  assert.equal(f.tasks.get('relogin_wx1').delay, 15000);
  assert.equal(f.service.getAccountLoginState('wx1').reloginAt, 1025000);
  f.config.offlineEnabled = false;
  f.service.scheduleAccount('wx1');
  assert.equal(f.service.getAccountLoginState('wx1'), null);
});

test('WeChat credential checks run every minute independently of periodic relogin', async (t) => {
  const adapter = require('../src/services/wx-login-adapter');
  const original = adapter.keepWxCredentialAlive;
  t.after(() => { adapter.keepWxCredentialAlive = original; });
  let calls = 0;
  adapter.keepWxCredentialAlive = async (account, options) => {
    assert.equal(account.id, 'wx1');
    assert.deepEqual(options, { onlyIfDue: true });
    calls++;
    return { Success: true, skipped: true };
  };
  const f = recoveryFixture({ account: { refreshtoken: 'fixture-token' } });
  f.service.scheduleAccount('wx1');
  assert.equal(f.tasks.get('wx_keepalive_wx1').delay, 60000);
  assert.equal(f.tasks.has('refresh_wx1'), false);
  await f.tasks.get('wx_keepalive_wx1').run();
  assert.equal(calls, 1);
  f.service.stopAccount('wx1');
  assert.equal(f.tasks.has('wx_keepalive_wx1'), false);
});

test('starting an account requests Code without unconditional credential renewal', async (t) => {
  const adapter = require('../src/services/wx-login-adapter');
  const originalCode = adapter.getFarmCode;
  const originalRenew = adapter.keepWxCredentialAlive;
  t.after(() => {
    adapter.getFarmCode = originalCode;
    adapter.keepWxCredentialAlive = originalRenew;
  });
  adapter.keepWxCredentialAlive = async () => assert.fail('login must not force renewal');
  adapter.getFarmCode = async (wxid, options) => {
    assert.equal(wxid, 'wx');
    assert.equal(options.accountId, 'wx1');
    return { Success: true, Data: { code: 'fresh-code' } };
  };
  const account = { id: 'wx1', platform: 'wx', wxid: 'wx', loginBuffer: 'buffer', refreshtoken: 'refresh' };
  const service = createAutoCodeRefreshService({
    store: {}, getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: next => assert.equal(next.code, 'fresh-code'),
    resolveWorkerControls: () => ({ restartWorker: () => true }),
    log: () => {}, addAccountLog: () => {},
  });
  t.after(() => service.dispose());
  assert.equal(await service.refreshAccountCode('wx1', 'manual_start'), true);
});

test('seconds field defaults to 60, ignores legacy minutes and clamps configured bounds', () => {
  const { normalizeAutoCodeRefresh } = require('../src/config/account-maintenance');
  assert.equal(normalizeAutoCodeRefresh().offlineDelaySeconds, 60);
  assert.equal(normalizeAutoCodeRefresh({ offlineDelayMinutes: 8 }).offlineDelaySeconds, 60);
  assert.equal('offlineDelayMinutes' in normalizeAutoCodeRefresh({ offlineDelayMinutes: 8 }), false);
  for (const [value, expected] of [[1, 1], [25, 25], [1.6, 2], [0, 1], [-10, 1], [90000, 86400], ['bad', 60]]) {
    assert.equal(normalizeAutoCodeRefresh({ offlineDelaySeconds: value, offlineDelayMinutes: 8 }).offlineDelaySeconds, expected);
  }
});

test('global policy rescheduling does not revive manually stopped accounts', () => {
  const f = recoveryFixture();
  f.config.enabled = true;
  f.service.scheduleAccount('wx1');
  assert.equal(f.tasks.get('refresh_wx1').delay, 3600000);
  f.config.intervalMinutes = 15;
  f.service.rescheduleAll();
  assert.equal(f.tasks.get('refresh_wx1').delay, 900000);
  f.service.stopAccount('wx1');
  f.service.rescheduleAll();
  assert.equal(f.tasks.size, 0);
  f.service.scheduleAccount('wx1');
  assert.equal(f.tasks.get('refresh_wx1').delay, 900000);
});

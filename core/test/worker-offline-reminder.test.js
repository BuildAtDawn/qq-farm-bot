const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createWorkerManager } = require('../src/runtime/worker-manager');

function createHarness(t, overrides = {}) {
  const proc = new EventEmitter();
  proc.send = () => {};
  proc.kill = () => {};
  const workers = {};
  const reminders = [];
  const accountLogs = [];
  const manager = createWorkerManager({
    fork: () => proc,
    runtimeMode: 'fork',
    processRef: { pkg: false, env: {}, execPath: process.execPath },
    mainEntryPath: '',
    workerScriptPath: '',
    workers,
    globalLogs: [],
    log: () => {},
    addAccountLog: (...args) => accountLogs.push(args),
    normalizeStatusForPanel: value => value,
    buildConfigSnapshotForAccount: () => ({}),
    getOfflineAutoDeleteMs: () => Infinity,
    triggerOfflineReminder: params => reminders.push(params),
    addOrUpdateAccount: () => {},
    getAccounts: () => ({ accounts: [] }),
    deleteAccount: () => {},
    ...overrides,
  });
  t.after(() => manager.dispose());
  manager.startWorker({ id: 'a1', name: '测试账号', username: 'owner', code: 'code' });
  return { proc, workers, reminders, accountLogs, manager };
}

test('WS 400 登录失效立即触发下线提醒并携带所属用户', (t) => {
  const { proc, reminders } = createHarness(t);
  proc.emit('message', { type: 'ws_error', code: 400, message: 'token expired' });

  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].username, 'owner');
  assert.match(reminders[0].reason, /^ws_400:/);
});

test('Worker 意外退出触发提醒，正常停止退出不触发', (t) => {
  const unexpected = createHarness(t);
  unexpected.proc.emit('exit', 1, null);
  assert.equal(unexpected.reminders.length, 1);
  assert.match(unexpected.reminders[0].reason, /^worker_exit:/);

  const normal = createHarness(t);
  normal.workers.a1.stopping = true;
  normal.proc.emit('exit', 0, null);
  assert.equal(normal.reminders.length, 0);
});

test('踢下线后 Worker 退出不会重复发送提醒', (t) => {
  const { proc, reminders } = createHarness(t);
  proc.emit('message', { type: 'account_kicked', reason: '异地登录' });
  proc.emit('exit', 0, null);

  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].username, 'owner');
  assert.equal(reminders[0].reason, 'kickout:异地登录');
});

test('mutation task state guards configuration until completion or Worker exit', (t) => {
  const { assertMutationConfig } = require('../src/services/mutation-test-state');
  const { proc } = createHarness(t);
  proc.emit('message', { type: 'mutation_test_state', data: { enabled: true } });
  assert.throws(() => assertMutationConfig('a1', { automation: { farm: true } }), /测变异运行中/);
  proc.emit('message', { type: 'mutation_test_state', data: { enabled: false } });
  assertMutationConfig('a1', { automation: { farm: true } });
  proc.emit('message', { type: 'mutation_test_state', data: { enabled: true } });
  proc.emit('exit', 1);
  assertMutationConfig('a1', { automation: { farm: true } });
});

test('forced Worker termination releases the mutation configuration guard', async (t) => {
  const { assertMutationConfig } = require('../src/services/mutation-test-state');
  const { proc, manager } = createHarness(t);
  proc.emit('message', { type: 'mutation_test_state', data: { enabled: true } });
  manager.stopWorker('a1');
  await new Promise(resolve => setTimeout(resolve, 1100));
  assertMutationConfig('a1', { automation: { farm: true } });
});

test('WS400 schedules configured recovery instead of immediately refreshing; online status cancels recovery', t => {
  const scheduled = [];
  const cancelled = [];
  let immediate = 0;
  const { proc } = createHarness(t, {
    scheduleAutoRelogin: (...args) => scheduled.push(args),
    cancelAutoRelogin: id => cancelled.push(id),
    refreshAccountCode: () => { immediate++; },
  });
  proc.emit('message', { type: 'ws_error', code: 400 });
  proc.emit('message', { type: 'ws_error', code: 400 });
  assert.equal(immediate, 0);
  assert.equal(scheduled.length, 1);
  proc.emit('message', { type: 'status_sync', data: { connection: { connected: true } } });
  assert.deepEqual(cancelled, ['a1']);
});

test('unexpected worker exit triggers recovery; explicit manual stop cancels even after worker removal', t => {
  const scheduled = [];
  const stopped = [];
  const { proc, manager } = createHarness(t, {
    scheduleAutoRelogin: (...args) => scheduled.push(args), onManualStop: id => stopped.push(id),
  });
  proc.emit('exit', 1);
  assert.equal(scheduled.length, 1);
  manager.stopWorker('a1');
  assert.deepEqual(stopped, ['a1']);
});

test('manual stop while restart waits for exit cannot resurrect the worker', t => {
  const { proc, manager, workers } = createHarness(t);
  manager.restartWorker({ id: 'a1', name: 'fixture', code: 'fixture' });
  assert.equal(workers.a1.restarting, true);
  manager.stopWorker('a1');
  assert.equal(workers.a1.restarting, false);
  proc.emit('exit', 0);
  assert.equal(workers.a1, undefined);
});

test('scheduled offline recovery suppresses immediate notifications across kick, WS error and exit', t => {
  for (const message of [{ type: 'ws_error', code: 400 }, { type: 'account_kicked', reason: 'fixture' }]) {
    const f = createHarness(t, { scheduleAutoRelogin: () => true });
    f.proc.emit('message', message);
    f.proc.emit('exit', 1);
    assert.equal(f.reminders.length, 0);
  }
  const exited = createHarness(t, { scheduleAutoRelogin: () => true });
  exited.proc.emit('exit', 1);
  assert.equal(exited.reminders.length, 0);
});

test('Worker tracks login pending until confirmed connection or an explicit login failure', t => {
  const { proc, workers } = createHarness(t);
  assert.equal(workers.a1.loginPending, true);
  proc.emit('message', { type: 'status_sync', data: { connection: { connected: false } } });
  assert.equal(workers.a1.loginPending, true);
  proc.emit('message', { type: 'status_sync', data: { connection: { connected: true } } });
  assert.equal(workers.a1.loginPending, false);
  proc.emit('message', { type: 'status_sync', data: { connection: { connected: false } } });
  assert.equal(workers.a1.loginPending, false);

  const failed = createHarness(t);
  failed.proc.emit('message', { type: 'ws_error', code: 400 });
  assert.equal(failed.workers.a1.loginPending, false);
});

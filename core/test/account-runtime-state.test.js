const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataProvider } = require('../src/runtime/data-provider');

function fixture(options = {}) {
  const accounts = [{ id: 'wx1', platform: 'wx', loginBuffer: 'private-buffer', refreshtoken: 'private-token' }];
  return createDataProvider({ workers: {}, store: {}, getAccounts: () => structuredClone({ accounts }), ...options });
}

test('account list distinguishes login, connection, offline and stopping states without leaking credentials', () => {
  for (const [worker, expected] of [
    [null, 'stopped'],
    [{ status: null, loginPending: true }, 'logging_in'],
    [{ status: { connection: { connected: false } }, loginPending: true }, 'logging_in'],
    [{ status: { connection: { connected: true } } }, 'running'],
    [{ status: { connection: { connected: false } }, loginPending: false }, 'offline'],
    [{ stopping: true }, 'stopping'],
    [{ stopping: true, restarting: true }, 'logging_in'],
  ]) {
    const provider = fixture({ workers: worker ? { wx1: worker } : {} });
    const account = provider.getAccounts().accounts[0];
    assert.equal(account.runtimeState, expected);
    assert.equal(account.reloginAt, null);
    assert.equal(account.running, !!worker);
    assert.equal(account.loginBuffer, undefined);
    assert.equal(account.refreshtoken, undefined);
  }
});

test('credential login and recovery deadline remain visible even without a Worker', () => {
  for (const state of [{ runtimeState: 'logging_in', reloginAt: null }, { runtimeState: 'relogin_waiting', reloginAt: 123456 }]) {
    const provider = fixture({ getAccountLoginState: () => state });
    const account = provider.getAccounts().accounts[0];
    assert.equal(account.runtimeState, state.runtimeState);
    assert.equal(account.reloginAt, state.reloginAt);
    assert.equal(account.running, false);
  }
});

test('stopping during credential login prevents the fallback from starting the account again', async () => {
  let resolve;
  let starts = 0;
  let stops = 0;
  const provider = fixture({
    refreshAccountCode: () => new Promise(done => { resolve = done; }),
    startWorker: () => { starts++; }, stopWorker: () => { stops++; },
  });
  const task = provider.startAccount('wx1');
  provider.stopAccount('wx1');
  resolve(false);
  assert.equal(await task, false);
  assert.equal(starts, 0);
  assert.equal(stops, 1);
});

test('repeated starts during login do not duplicate credential requests', async () => {
  let resolve;
  let calls = 0;
  const provider = fixture({ refreshAccountCode: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const first = provider.startAccount('wx1');
  assert.equal(await provider.startAccount('wx1'), true);
  assert.equal(calls, 1);
  resolve(true);
  assert.equal(await first, true);
});

test('startup login uses the same stop protection and retains its startup reason', async () => {
  let resolve;
  let starts = 0;
  const provider = fixture({
    refreshAccountCode: (id, reason) => {
      assert.equal(reason, 'startup');
      return new Promise(done => { resolve = done; });
    },
    startWorker: () => { starts++; }, stopWorker: () => {},
  });
  const task = provider.startAccount('wx1', 'startup');
  provider.stopAccount('wx1');
  resolve(false);
  assert.equal(await task, false);
  assert.equal(starts, 0);
});

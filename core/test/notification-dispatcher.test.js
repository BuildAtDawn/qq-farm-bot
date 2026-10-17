const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-dispatcher-'));
process.env.FARM_DATA_DIR = dataDir;
const { createNotificationDispatcher } = require('../src/runtime/notification-dispatcher');
const { buildMonitorSnapshot, maturityGroups } = require('../src/services/friend-monitor-plan');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function harness(options = {}) {
  let now = 1791687600000;
  let persisted = options.outbox || {};
  const accounts = [{ id: 'a1', username: 'alice', name: '小号' }];
  const config = { smtpEnabled: true, barkEnabled: true, barkAccountKeys: { a1: 'offline-key' }, events: options.events };
  const monitor = { enabled: true, friendGids: [9], barkKeys: { 9: 'friend-key' }, forecastEnabled: true, matureEnabled: true };
  const snapshot = buildMonitorSnapshot([{ id: 1, unlocked: true, plant: { id: 101, phases: [
    { phase: 2, begin_time: now / 1000 }, { phase: 6, begin_time: now / 1000 + 600 },
  ] } }], { gid: 9, name: '大号', nowSec: now / 1000 });
  const state = { friends: { 9: { current: snapshot } } };
  const calls = [];
  const deps = {
    store: { getAccounts: () => ({ accounts }), getOfflineReminder: username => {
      assert.equal(username, 'alice'); return config;
    }, getConfigSnapshot: () => ({ friendMonitor: monitor }) },
    now: () => now, readState: () => state, readOutbox: () => structuredClone(persisted),
    writeOutbox: data => { persisted = structuredClone(data); },
    scheduler: { setIntervalTask: () => {}, dispose: () => {} },
    senders: {
      sendSmtpEmail: async () => { calls.push('smtp'); return { ok: true }; },
      sendBarkMessage: async payload => { calls.push('bark'); assert.match(payload.content, /大号|fixture/); return { ok: calls.filter(item => item === 'bark').length > 1 }; },
    },
    ...options.deps,
  };
  const service = createNotificationDispatcher(deps);
  const payload = { gid: 9, planKey: snapshot.planKey, groupKeys: maturityGroups(snapshot).map(group => group.key), eventId: 'fixture-crop', expiresAt: now + 600000 };
  return { service, deps, payload, calls, accounts, config, monitor, state, snapshot,
    setNow: value => { now = value; }, now: () => now, persisted: () => persisted };
}

test('only failed channels retry; restart and concurrent duplicate enqueue preserve sent-channel state', async () => {
  const f = harness();
  await Promise.all([f.service.enqueue('a1', 'friend_crop_forecast', f.payload), f.service.enqueue('a1', 'friend_crop_forecast', f.payload)]);
  assert.deepEqual([...f.calls].sort(), ['bark', 'smtp']);
  f.setNow(f.now() + 31000);
  const next = createNotificationDispatcher(f.deps);
  await next.tick();
  assert.deepEqual(f.calls, ['smtp', 'bark', 'bark']);
  await next.enqueue('a1', 'friend_crop_forecast', f.payload);
  assert.equal(f.calls.length, 3);
});

test('per-event channel subscriptions and ownership isolation', async () => {
  const f = harness({ events: { friend_crop_forecast: ['smtp'], friend_crop_mature: [] } });
  await f.service.enqueue('a1', 'friend_crop_forecast', f.payload);
  await f.service.enqueue('a1', 'friend_crop_mature', f.payload);
  await f.service.enqueue('other', 'friend_crop_forecast', f.payload);
  assert.deepEqual(f.calls, ['smtp']);
  f.accounts[0].username = 'bob';
  f.setNow(f.now() + 31000);
  await f.service.tick();
  assert.equal(f.calls.length, 1);
});

test('restart waits for fresh worker observation; changed plans and disabled monitor cancel obsolete events', async () => {
  let ready = false;
  const f = harness({ deps: { canDeliverCrop: () => ready } });
  await f.service.enqueue('a1', 'friend_crop_forecast', f.payload);
  assert.equal(f.calls.length, 0);
  ready = true;
  f.state.friends[9].current = { ...f.snapshot, planKey: 'changed' };
  await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(Object.values(f.persisted())[0].cancelled, true);
  f.monitor.enabled = false;
  await f.service.enqueue('a1', 'friend_crop_mature', { ...f.payload, eventId: 'near' });
  assert.equal(f.calls.length, 0);
});

test('expired forecasts are not replayed and exhausted channels stop after three attempts', async () => {
  const f = harness({ deps: { senders: { sendSmtpEmail: async () => ({ ok: false }), sendBarkMessage: async () => ({ ok: false }) } } });
  await f.service.enqueue('a1', 'friend_crop_forecast', f.payload);
  f.setNow(f.now() + 31000);
  await f.service.tick();
  f.setNow(f.now() + 121000);
  await f.service.tick();
  f.setNow(f.now() + 121000);
  await f.service.tick();
  assert.equal(Object.values(f.persisted())[0].channels.smtp.attempts, 3);
  f.setNow(f.now() + 1000000);
  await f.service.tick();
  assert.deepEqual(f.persisted(), {});
});

test('offline notifications use the same outbox without requiring an online monitor', async () => {
  const f = harness({ deps: { canDeliverCrop: () => false } });
  await f.service.enqueue('a1', 'account_offline', { eventId: 'offline', message: { title: 'fixture', content: 'fixture' } });
  assert.deepEqual([...f.calls].sort(), ['bark', 'smtp']);
});

test('Bark routes offline and crop events to distinct recipient keys with event levels', async () => {
  const calls = [];
  const f = harness({ deps: { senders: { sendBarkMessage: async payload => { calls.push(payload); return { ok: true }; } } } });
  f.config.smtpEnabled = false;
  await f.service.enqueue('a1', 'account_offline', { eventId: 'offline', message: { title: 'fixture', content: 'fixture' } });
  await f.service.enqueue('a1', 'friend_crop_forecast', f.payload);
  f.monitor.barkKeys[9] = 'changed-friend-key';
  f.config.barkLevels = { friend_crop_mature: 'passive' };
  await f.service.enqueue('a1', 'friend_crop_mature', { ...f.payload, eventId: 'near' });
  assert.deepEqual(calls.map(payload => [payload.key, payload.level]), [
    ['offline-key', 'timeSensitive'], ['friend-key', 'timeSensitive'], ['changed-friend-key', 'passive'],
  ]);
  delete f.monitor.barkKeys[9];
  await f.service.enqueue('a1', 'friend_crop_forecast', { ...f.payload, eventId: 'missing-key' });
  f.accounts.push({ id: 'a2', username: 'alice', name: 'other' });
  await f.service.enqueue('a2', 'account_offline', { eventId: 'missing-account-key', message: { title: 'fixture', content: 'fixture' } });
  assert.equal(calls.length, 3);
});

test('offline retry is cancelled after account reconnects', async () => {
  let connected = false;
  const calls = [];
  const f = harness({ deps: { isAccountConnected: () => connected, senders: { sendBarkMessage: async () => { calls.push('bark'); return { ok: false }; } } } });
  f.config.smtpEnabled = false;
  await f.service.enqueue('a1', 'account_offline', { eventId: 'offline', message: { title: 'fixture', content: 'fixture' } });
  connected = true;
  f.setNow(f.now() + 31000);
  await f.service.tick();
  assert.equal(calls.length, 1);
  assert.equal(Object.values(f.persisted())[0].cancelled, true);
});

test('only Bark maturity reminders receive the public redirect URL and retries use current system settings', async () => {
  const bark = [];
  const emails = [];
  const settings = { publicWebOrigin: 'https://123.com' };
  const f = harness({ deps: { senders: {
    sendBarkMessage: async payload => { bark.push(payload); return { ok: bark.length > 1 }; },
    sendSmtpEmail: async payload => { emails.push(payload); return { ok: true }; },
  } } });
  f.deps.store.getSystemSettings = () => settings;
  await f.service.enqueue('a1', 'friend_crop_mature', f.payload);
  assert.equal(bark[0].url, 'https://123.com/open-weixin.html');
  settings.publicWebOrigin = 'https://updated.example';
  f.setNow(f.now() + 31000);
  await f.service.tick();
  assert.equal(bark[1].url, 'https://updated.example/open-weixin.html');
  await f.service.enqueue('a1', 'friend_crop_forecast', { ...f.payload, eventId: 'forecast-url' });
  await f.service.enqueue('a1', 'account_offline', { eventId: 'offline-url', message: { title: 'fixture', content: 'fixture' } });
  assert.equal(bark[2].url, undefined);
  assert.equal(bark[3].url, undefined);
  assert.ok(emails.every(payload => payload.url === undefined));
  settings.publicWebOrigin = '';
  await f.service.enqueue('a1', 'friend_crop_mature', { ...f.payload, eventId: 'no-domain' });
  assert.equal(bark[4].url, undefined);
});

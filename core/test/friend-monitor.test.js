const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-monitor-'));
process.env.FARM_DATA_DIR = dataDir;
const { createFriendMonitor } = require('../src/services/friend-monitor');
const { buildMonitorSnapshot, maturityGroups, formatMaturityTime, buildCropNotification } = require('../src/services/friend-monitor-plan');
const { normalizeFriendMonitor, normalizeAutoCodeRefresh } = require('../src/config/account-maintenance');
const { readMonitorState, writeMonitorState } = require('../src/services/friend-monitor-state');
const store = require('../src/models/store');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const START = Date.parse('2026-10-11T03:00:00Z') / 1000;
function land(id, matureAt, patch = {}) {
  return { id, unlocked: true, plant: { id: 101, season: 1, phases: [
    { phase: 2, phase_id: 10, begin_time: START - 100 },
    { phase: 6, phase_id: 19, begin_time: matureAt },
  ], ...patch } };
}

function fakeScheduler() {
  const tasks = new Map();
  return { tasks, clear: key => tasks.delete(key), clearAll: () => tasks.clear(),
    setTimeoutTask: (key, delay, run) => tasks.set(key, { delay, run }) };
}

function fixture(options = {}) {
  let now = START;
  const config = { ...normalizeFriendMonitor({ enabled: true, friendGids: [9], intervalMinSec: 1000, intervalMaxSec: 1000, leadSeconds: 120 }), ...options.config };
  const events = new EventEmitter();
  const sent = [];
  let stored = options.state || { friends: {} };
  const scheduler = fakeScheduler();
  const monitor = createFriendMonitor({
    accountId: 'a1', getConfig: () => config, events, nowSec: () => now, random: () => 0,
    scheduler, readState: () => structuredClone(stored), writeState: (_, value) => { stored = structuredClone(value); },
    emit: (event, payload) => {
      sent.push({ event, payload });
      if (!options.noAck) monitor.acknowledge(payload.gid, payload.eventId);
    }, canVisit: () => true,
    enter: options.enter || (async gid => events.emit('friendLandsObserved', { gid, name: '大号', lands: [land(1, now + 3600)], source: 'visit_enter' })),
    leave: options.leave || (async () => {}),
  });
  monitor.start();
  return { monitor, config, scheduler, sent, setNow: value => { now = value; }, stored: () => stored,
    observe: lands => monitor.observe({ gid: 9, name: '大号', lands, source: 'visit_enter' }) };
}

test('precise maturity comparison ignores phase progression, countdowns and fruit theft', () => {
  const f = fixture();
  f.observe([land(1, START + 3600)]);
  assert.equal(f.sent.length, 1);
  f.setNow(START + 20);
  f.observe([land(1, START + 3600, { stole_num: 2, phases: [
    { phase: 2, phase_id: 12, begin_time: START + 10 }, { phase: 6, phase_id: 19, begin_time: START + 3600 },
  ] })]);
  assert.equal(f.sent.length, 1);
  assert.equal(f.stored().friends[9].previous.observedAt, START);
  assert.equal(f.stored().friends[9].current.observedAt, START + 20);
  f.observe([land(1, START + 3599)]);
  assert.equal(f.sent.length, 2);
  assert.notEqual(f.sent[0].payload.planKey, f.sent[1].payload.planKey);
});

test('every maturity minute batch is checked and reminded separately, repeated observations dedupe', () => {
  const f = fixture();
  const lands = [land(1, START + 600), land(2, START + 625), land(3, START + 1800)];
  f.observe(lands);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].payload.groupKeys.length, 2);
  assert.equal(f.scheduler.tasks.get('next_scan').delay, 480000);
  f.setNow(START + 480);
  f.observe(lands);
  f.observe(lands);
  assert.equal(f.sent.filter(item => item.event === 'friend_crop_mature').length, 1);
  f.setNow(START + 1680);
  f.observe(lands);
  assert.equal(f.sent.filter(item => item.event === 'friend_crop_mature').length, 2);
});

test('first observation inside lead window sends only near notification; restart preserves dedupe', () => {
  const f = fixture();
  f.observe([land(1, START + 60)]);
  assert.deepEqual(f.sent.map(item => item.event), ['friend_crop_mature']);
  const next = fixture({ state: f.stored() });
  next.observe([land(1, START + 60)]);
  assert.equal(next.sent.length, 0);
});

test('changed maturity cancels old timing and new season/plant changes produce forecasts', () => {
  const f = fixture();
  f.observe([land(1, START + 600)]);
  f.observe([land(1, START + 2000)]);
  assert.equal(f.scheduler.tasks.get('next_scan').delay, 1000000);
  f.setNow(START + 480);
  f.observe([land(1, START + 2000)]);
  assert.equal(f.sent.filter(item => item.event === 'friend_crop_mature').length, 0);
  f.observe([land(1, START + 2000, { season: 2 })]);
  f.observe([land(1, START + 2000, { season: 2, id: 102 })]);
  assert.equal(f.sent.length, 4);
});

test('partial pushes do not rotate complete snapshots; empty farm clears schedule without fabricated times', () => {
  const f = fixture();
  f.observe([land(1, START + 600)]);
  assert.equal(f.monitor.observe({ gid: 9, source: 'lands_notify', lands: [] }), false);
  assert.equal(f.stored().friends[9].current.lands.length, 1);
  f.observe([]);
  assert.equal(f.stored().friends[9].current.lands.length, 0);
  assert.equal(f.sent.length, 1);
  assert.equal(f.scheduler.tasks.get('next_scan').delay, 1000000);
});

test('failed near scans preserve both snapshots and back off instead of looping every second', async () => {
  const f = fixture({ enter: async () => { throw new Error('timeout'); } });
  f.observe([land(1, START + 600)]);
  f.setNow(START + 480);
  const snapshot = structuredClone(f.stored().friends[9].current);
  await f.monitor.tick();
  assert.deepEqual(f.stored().friends[9].current, snapshot);
  assert.equal(f.stored().friends[9].lastError, '巡查失败，等待重试');
  assert.equal(f.scheduler.tasks.get('next_scan').delay, 30000);
});

test('stopping monitor during a visit prevents events and always leaves the farm', async () => {
  let resolve;
  let left = 0;
  const f = fixture({ enter: () => new Promise(done => { resolve = done; }), leave: async () => { left++; } });
  const task = f.monitor.tick();
  f.monitor.stop();
  f.observe([land(1, START + 600)]);
  resolve();
  await task;
  assert.equal(f.sent.length, 0);
  assert.equal(left, 1);
  assert.equal(f.scheduler.tasks.size, 0);
});

test('merged lands count one crop and actual occupied plots; no maturity is invented for unknown plant', () => {
  const snapshot = buildMonitorSnapshot([
    { ...land(1, START + 600), slave_land_ids: [2, 3, 4] },
    { id: 2, unlocked: true, master_land_id: 1 }, { id: 3, unlocked: true, master_land_id: 1 }, { id: 4, unlocked: true, master_land_id: 1 },
    land(5, START + 630), { id: 6, unlocked: true, plant: { id: 9999999, phases: [{ phase: 2, begin_time: START + 1 }] } },
  ], { gid: 9, nowSec: START });
  const groups = maturityGroups(snapshot);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].crops.reduce((n, crop) => n + crop.count, 0), 2);
  assert.equal(groups[0].crops.reduce((n, crop) => n + crop.landCount, 0), 5);
  assert.equal(snapshot.lands.find(item => item.landId === 6).matureAt, 0);
});

test('2x2 slave lands with omitted master ids use existing land linkage and cannot duplicate crops', () => {
  const snapshot = buildMonitorSnapshot([
    { ...land(1, START + 600), slave_land_ids: [2, 3, 4] },
    land(2, START + 600), land(3, START + 600), land(4, START + 600),
  ], { gid: 9, nowSec: START });
  const group = maturityGroups(snapshot)[0];
  assert.equal(group.crops[0].count, 1);
  assert.equal(group.crops[0].size, 2);
  assert.equal(group.crops[0].landCount, 4);
  assert.match(buildCropNotification('friend_crop_forecast', { friendName: '大号', accountName: '小号', groups: [group], nowSec: START }).content, /1 株（占 4 块地）/);
});

test('Beijing calendar boundaries and remaining-time template', () => {
  const late = Date.parse('2026-10-11T15:59:40Z') / 1000;
  assert.equal(formatMaturityTime(late + 30, late), '明天 00:00 · 不足 1 分钟');
  assert.match(formatMaturityTime(late + 2 * 86400, late), /2 天后 23:59/);
  assert.match(formatMaturityTime(late, late), /已成熟/);
  const groups = maturityGroups(buildMonitorSnapshot([land(1, START + 600)], { gid: 9, nowSec: START }));
  const message = buildCropNotification('friend_crop_forecast', { friendName: '大号', accountName: '小号', groups, nowSec: START });
  assert.equal(message.title, '成熟预告｜大号');
  assert.match(message.content, /今天 11:10 · 还有 10 分钟/);
  assert.match(message.content, /监听账号：小号/);
});

test('store persists isolated monitor settings, excludes friend selections from default plans and cleans deleted account state', () => {
  const created = store.addOrUpdateAccount({ name: 'monitor', username: 'alice', code: 'fixture' }).accounts.at(-1);
  store.applyConfigSnapshot({ friendMonitor: { enabled: true, friendGids: [9, 9, -1], leadSeconds: 0 } }, { accountId: created.id });
  assert.deepEqual(store.getConfigSnapshot(created.id).friendMonitor.friendGids, [9]);
  assert.equal(store.getConfigSnapshot(created.id).friendMonitor.leadSeconds, 0);
  assert.equal(store.getConfigSnapshot('other').friendMonitor.enabled, false);
  const plan = store.setUserDefaultAccountPlan('alice', store.getConfigSnapshot(created.id));
  assert.equal('friendMonitor' in plan.config, false);
  writeMonitorState(created.id, { friends: { 9: { previous: null, current: { lands: [] } } } });
  assert.ok(readMonitorState(created.id).friends[9]);
  store.deleteAccount(created.id);
  assert.deepEqual(readMonitorState(created.id).friends, {});
});

test('normalization preserves legacy scheduled config and defaults offline recovery to off', () => {
  assert.deepEqual(normalizeAutoCodeRefresh({ enabled: true, intervalMinutes: 45 }), {
    enabled: true, intervalMinutes: 45, offlineEnabled: false, offlineDelaySeconds: 60,
  });
  const cfg = normalizeFriendMonitor({ friendGids: [1, '1', Number.NaN, -1], intervalMinSec: 300, intervalMaxSec: 100 });
  assert.deepEqual(cfg.friendGids, [1]);
  assert.equal(cfg.intervalMaxSec, 300);
});

test('unacknowledged events survive restart and are replayed only after a successful fresh observation', () => {
  const f = fixture({ noAck: true });
  f.observe([land(1, START + 600)]);
  assert.equal(Object.keys(f.stored().friends[9].pendingEvents).length, 1);
  const next = fixture({ state: f.stored() });
  assert.equal(next.sent.length, 0);
  next.observe([land(1, START + 600)]);
  assert.equal(next.sent.length, 1);
  assert.equal(next.sent[0].payload.eventId, f.sent[0].payload.eventId);
  assert.equal(Object.keys(next.stored().friends[9].pendingEvents).length, 0);
  next.observe([land(1, START + 600)]);
  assert.equal(next.sent.length, 1);
});

test('listener protection blocks shared manual and automatic mutations before any RPC', async () => {
  const { assertFriendMutationAllowed, isMonitoredFriendProtected } = require('../src/services/friend-monitor-protection');
  const mutations = require('../src/services/friend-operation-limits');
  const visits = require('../src/services/friend-visit');
  const previousId = process.env.FARM_ACCOUNT_ID;
  process.env.FARM_ACCOUNT_ID = 'protected-fixture';
  try {
    store.applyConfigSnapshot({ friendMonitor: { enabled: true, friendGids: [9], protectFriends: true } }, { accountId: 'protected-fixture' });
    assert.throws(() => assertFriendMutationAllowed(9), /监听保护/);
    assert.equal(isMonitoredFriendProtected(10), false);
    await assert.rejects(mutations.stealHarvest(9, [1]), /监听保护/);
    await assert.rejects(mutations.putInsectsDetailed(9, [1]), /监听保护/);
    await assert.rejects(mutations.putWeedsDetailed(9, [1]), /监听保护/);
    assert.equal((await visits.doFriendOperation(9, 'steal')).ok, false);
    assert.equal((await visits.doFriendOperation(9, 'bad')).ok, false);
    assert.deepEqual(await visits.visitFriendForSteal({ gid: 9 }, {}, 1, 'protected-fixture'), { acted: false, entered: false });
    store.applyConfigSnapshot({ friendMonitor: { protectFriends: false } }, { accountId: 'protected-fixture' });
    assert.doesNotThrow(() => assertFriendMutationAllowed(9));
    store.applyConfigSnapshot({ friendMonitor: { enabled: false, protectFriends: true } }, { accountId: 'protected-fixture' });
    assert.doesNotThrow(() => assertFriendMutationAllowed(9));
  } finally {
    if (previousId === undefined) delete process.env.FARM_ACCOUNT_ID;
    else process.env.FARM_ACCOUNT_ID = previousId;
  }
});

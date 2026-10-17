const { createScheduler } = require('./scheduler');
const { normalizeFriendMonitor } = require('../config/account-maintenance');
const { buildMonitorSnapshot, maturityGroups, digest } = require('./friend-monitor-plan');
const { readMonitorState, writeMonitorState } = require('./friend-monitor-state');

function createFriendMonitor({ accountId, getConfig, events, enter, leave, canVisit,
  nowSec, emit, onObserved = () => {}, log = () => {}, random = Math.random,
  readState = readMonitorState, writeState = writeMonitorState,
  scheduler = createScheduler('friend_monitor') }) {
  const state = readState(accountId);
  let active = false;
  let generation = 0;
  let ticking = false;
  const deadlines = new Map();
  const retryAfter = new Map();
  const save = () => writeState(accountId, state);
  const config = () => normalizeFriendMonitor(getConfig());
  const selected = gid => active && config().enabled && config().friendGids.includes(Number(gid));
  const interval = () => {
    const cfg = config();
    return cfg.intervalMinSec + Math.floor(random() * (cfg.intervalMaxSec - cfg.intervalMinSec + 1));
  };

  function queueEvent(record, event, payload) {
    record.pendingEvents ||= {};
    record.pendingEvents[payload.eventId] = { event, payload };
    save();
    emit(event, payload);
  }

  function replayPending(record, groups) {
    for (const [id, pending] of Object.entries(record.pendingEvents || {})) {
      const valid = pending.payload.expiresAt > nowSec() * 1000
        && pending.payload.groupKeys.every(key => groups.some(group => group.key === key))
        && (pending.event !== 'friend_crop_forecast' || pending.payload.planKey === record.current.planKey);
      if (!valid) delete record.pendingEvents[id];
      else emit(pending.event, pending.payload);
    }
  }

  function nextDue(gid) {
    const cfg = config();
    const record = state.friends[gid];
    let due = deadlines.get(gid) ?? nowSec();
    if (cfg.matureEnabled && record?.current) {
      for (const group of maturityGroups(record.current)) {
        if (group.matureAt >= nowSec() - 60 && !record.nearNotified?.[group.key]) {
          due = Math.min(due, group.matureAt - cfg.leadSeconds);
        }
      }
    }
    return Math.max(due, retryAfter.get(gid) || 0);
  }

  function schedule() {
    scheduler.clear('next_scan');
    if (!active || !config().enabled || ticking) return;
    const gids = config().friendGids;
    if (!gids.length) return;
    const nearest = Math.min(...gids.map(nextDue));
    scheduler.setTimeoutTask('next_scan', Math.max(1000, (nearest - nowSec()) * 1000), tick);
  }

  function observe(observation) {
    const gid = Number(observation?.gid);
    if (!selected(gid) || observation.source !== 'visit_enter' || !Array.isArray(observation.lands)) return false;
    const now = nowSec();
    const cfg = config();
    const record = state.friends[gid] || { previous: null, current: null, nearNotified: {} };
    record.nearNotified ||= {};
    const current = buildMonitorSnapshot(observation.lands, { gid, name: observation.name || record.current?.name || `GID:${gid}`, nowSec: now });
    const groups = maturityGroups(current);
    const near = cfg.matureEnabled ? groups.filter(group => group.matureAt >= now - 60
      && group.matureAt - cfg.leadSeconds <= now && !record.nearNotified[group.key]) : [];
    const future = groups.filter(group => group.matureAt > now
      && (!cfg.matureEnabled || group.matureAt - cfg.leadSeconds > now));
    record.previous = record.current;
    record.current = current;
    record.lastError = '';
    record.lastAttemptAt = now;
    // Delivery state is metadata, never a third farm snapshot. Remove obsolete batches.
    record.nearNotified = Object.fromEntries(Object.entries(record.nearNotified || {})
      .filter(([key]) => groups.some(group => group.key === key)));
    state.friends[gid] = record;
    deadlines.set(gid, now + interval());
    retryAfter.delete(gid);
    save();
    onObserved(gid);
    replayPending(record, groups);

    for (const group of near) {
      const groupKeys = [group.key];
      record.nearNotified[group.key] = now;
      queueEvent(record, 'friend_crop_mature', {
        gid, planKey: current.planKey, groupKeys, eventId: digest([gid, groupKeys]),
        expiresAt: (group.matureAt + 60) * 1000,
      });
    }
    if (cfg.forecastEnabled && record.forecastKey !== current.planKey) {
      if (future.length) {
        record.forecastKey = current.planKey;
        queueEvent(record, 'friend_crop_forecast', {
          gid, planKey: current.planKey, groupKeys: future.map(group => group.key),
          eventId: digest([gid, current.planKey]), expiresAt: future[0].matureAt * 1000,
        });
      }
      record.forecastKey = current.planKey;
    }
    save();
    schedule();
    return true;
  }

  async function tick() {
    if (!active || ticking) return;
    ticking = true;
    const version = generation;
    try {
      for (const gid of config().friendGids) {
        if (!active || version !== generation) break;
        if (nextDue(gid) > nowSec()) continue;
        if (!canVisit(gid)) {
          deadlines.set(gid, nowSec() + interval());
          retryAfter.set(gid, nowSec() + 30);
          continue;
        }
        let entered = false;
        try {
          await enter(gid, { shouldContinue: () => active && version === generation && selected(gid) && canVisit(gid) && nextDue(gid) <= nowSec() });
          entered = true;
          // enterFriendFarm emits a complete observation through the shared event bus.
        } catch {
          const record = state.friends[gid] || { previous: null, current: null, nearNotified: {} };
          record.lastError = '巡查失败，等待重试';
          record.lastAttemptAt = nowSec();
          state.friends[gid] = record;
          retryAfter.set(gid, nowSec() + 30);
          save();
          log('好友', `监听好友 ${gid} 巡查失败`, { module: 'friend_monitor', result: 'error', friendGid: gid });
        } finally {
          if (entered) await leave(gid);
          deadlines.set(gid, nowSec() + interval());
        }
      }
    } finally {
      ticking = false;
      schedule();
    }
  }

  function start() {
    if (!active) {
      active = true;
      events.on('friendLandsObserved', safeObserve);
    }
    generation += 1;
    const gids = config().friendGids;
    for (const gid of deadlines.keys()) if (!gids.includes(gid)) deadlines.delete(gid);
    for (const gid of gids) if (!deadlines.has(gid)) deadlines.set(gid, nowSec());
    for (const gid of Object.keys(state.friends)) if (!gids.includes(Number(gid))) delete state.friends[gid];
    try { save(); } catch { log('好友', '监听状态保存失败', { module: 'friend_monitor', result: 'error' }); }
    schedule();
  }

  function stop() {
    active = false;
    generation += 1;
    deadlines.clear();
    retryAfter.clear();
    scheduler.clearAll();
    events.off('friendLandsObserved', safeObserve);
  }

  function acknowledge(gid, eventId) {
    const record = state.friends[Number(gid)];
    if (record?.pendingEvents?.[eventId]) {
      delete record.pendingEvents[eventId];
      save();
    }
  }

  function safeObserve(observation) {
    try { observe(observation); } catch {
      log('好友', '监听巡查数据处理失败', { module: 'friend_monitor', result: 'error', friendGid: Number(observation?.gid) || 0 });
    }
  }

  return { start, stop, observe, tick, acknowledge, snapshot: () => state };
}

module.exports = { createFriendMonitor };

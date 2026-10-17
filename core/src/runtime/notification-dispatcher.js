const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const { createScheduler } = require('../services/scheduler');
const { enabledNotificationChannels, sendNotificationChannels, resolveNotificationConfig } = require('../services/notification-channels');
const { digest, maturityGroups, buildCropNotification } = require('../services/friend-monitor-plan');
const { readMonitorState } = require('../services/friend-monitor-state');
const { normalizeFriendMonitor } = require('../config/account-maintenance');

function createNotificationDispatcher({ store, log = () => {}, now = Date.now, senders,
  canDeliverCrop = () => true,
  isAccountConnected = () => false,
  readState = readMonitorState, readOutbox, writeOutbox, scheduler = createScheduler('notification_dispatcher') }) {
  const file = getDataFile('notification_outbox.json');
  const outbox = (readOutbox || (() => readJsonFile(file, {})))();
  const save = () => (writeOutbox || (data => writeJsonFileAtomic(file, data)))(outbox);
  const running = new Map();
  let disposed = false;

  function context(entry) {
    const account = (store.getAccounts().accounts || []).find(item => String(item.id) === entry.accountId);
    if (!account || String(account.username || '') !== entry.owner) return null;
    const saved = store.getOfflineReminder(account.username || '');
    if (entry.event === 'account_offline') return isAccountConnected(account.id) ? null
      : { config: resolveNotificationConfig(saved, account.id, entry.event), message: entry.message };
    const monitor = normalizeFriendMonitor(store.getConfigSnapshot(account.id).friendMonitor);
    const config = resolveNotificationConfig(saved, account.id, entry.event, monitor, entry.gid, store.getSystemSettings?.());
    if (!monitor.enabled || !monitor.friendGids.includes(entry.gid)
      || (entry.event === 'friend_crop_forecast' ? !monitor.forecastEnabled : !monitor.matureEnabled)) return null;
    const snapshot = readState(account.id).friends[entry.gid]?.current;
    if (!snapshot) return null;
    const all = maturityGroups(snapshot);
    const groups = all.filter(group => entry.groupKeys.includes(group.key));
    if (!groups.length || groups.length !== entry.groupKeys.length) return null;
    if (entry.event === 'friend_crop_forecast' && snapshot.planKey !== entry.planKey) return null;
    return { config, message: buildCropNotification(entry.event, {
      friendName: snapshot.name || `GID:${entry.gid}`, accountName: account.name || account.id,
      groups, nowSec: Math.floor(now() / 1000), templates: config.templates,
    }) };
  }

  async function deliver(key) {
    if (disposed) return;
    if (running.has(key)) return running.get(key);
    const task = (async () => {
      const entry = outbox[key];
      if (!entry || entry.expiresAt <= now()) return;
      if (entry.event !== 'account_offline' && !canDeliverCrop(entry.accountId, entry.gid)) return;
      const ctx = context(entry);
      if (!ctx) {
        entry.cancelled = true;
        save();
        return;
      }
      const allowed = enabledNotificationChannels(ctx.config, entry.event);
      const channels = Object.entries(entry.channels).filter(([channel, state]) => allowed.includes(channel)
        && !state.sent && state.attempts < 3 && state.nextAt <= now()).map(([channel]) => channel);
      if (!channels.length) return;
      // Persist attempts before network I/O; successful channels are never retried with failed ones.
      for (const channel of channels) entry.channels[channel].attempts += 1;
      save();
      const result = await sendNotificationChannels(ctx.config, ctx.message, senders, channels);
      for (const item of result.results) {
        const state = entry.channels[item.channel];
        state.sent = item.ok;
        state.nextAt = now() + (state.attempts === 1 ? 30000 : 120000);
        log(item.ok ? '系统' : '错误', `${entry.event} ${item.channel}: ${item.msg}`, { accountId: entry.accountId });
      }
      save();
      return result;
    })();
    running.set(key, task);
    try { return await task; } finally { running.delete(key); }
  }

  async function enqueue(accountId, event, payload = {}) {
    if (!['account_offline', 'friend_crop_forecast', 'friend_crop_mature'].includes(event) || disposed) return;
    const account = (store.getAccounts().accounts || []).find(item => String(item.id) === String(accountId));
    if (!account) return;
    const monitor = event === 'account_offline' ? null : store.getConfigSnapshot(account.id).friendMonitor;
    const config = resolveNotificationConfig(store.getOfflineReminder(account.username || ''), account.id, event, monitor, payload.gid);
    const channels = enabledNotificationChannels(config, event);
    if (!channels.length) return;
    const eventId = String(payload.eventId || '');
    if (!eventId) return;
    const key = digest([accountId, event, eventId]);
    if (!outbox[key]) {
      outbox[key] = {
        accountId: String(accountId), owner: String(account.username || ''), event,
        gid: Number(payload.gid) || 0, planKey: payload.planKey || '', groupKeys: payload.groupKeys || [],
        message: event === 'account_offline' ? payload.message : undefined,
        expiresAt: Math.min(Number(payload.expiresAt) || now() + 24 * 3600000, now() + 24 * 3600000),
        channels: Object.fromEntries(channels.map(channel => [channel, { sent: false, attempts: 0, nextAt: now() }])),
      };
      save();
    }
    if (!outbox[key].cancelled) return deliver(key);
  }

  async function tick() {
    for (const [key, entry] of Object.entries(outbox)) {
      if (entry.expiresAt <= now()) { delete outbox[key]; continue; }
      if (!entry.cancelled) await deliver(key);
    }
    save();
  }

  scheduler.setIntervalTask('retry', 10000, tick, { preventOverlap: true });
  return { enqueue, tick, dispose: () => { disposed = true; scheduler.dispose(); } };
}

module.exports = { createNotificationDispatcher };

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function normalizeAutoCodeRefresh(input = {}) {
  input = input && typeof input === 'object' ? input : {};
  return {
    enabled: input.enabled === true,
    intervalMinutes: boundedInteger(input.intervalMinutes, 60, 1, 1440),
    offlineEnabled: input.offlineEnabled === true,
    offlineDelaySeconds: boundedInteger(input.offlineDelaySeconds, 60, 1, 86400),
  };
}

function normalizeFriendMonitor(input = {}) {
  input = input && typeof input === 'object' ? input : {};
  const intervalMinSec = boundedInteger(input.intervalMinSec, 180, 10, 86400);
  return {
    enabled: input.enabled === true,
    friendGids: [...new Set((Array.isArray(input.friendGids) ? input.friendGids : [])
      .map(Number).filter(gid => Number.isSafeInteger(gid) && gid > 0))],
    barkKeys: Object.fromEntries(Object.entries(input.barkKeys && typeof input.barkKeys === 'object' ? input.barkKeys : {})
      .filter(([gid]) => Number.isSafeInteger(Number(gid)) && Number(gid) > 0)
      .map(([gid, key]) => [gid, typeof key === 'string' ? key.trim().slice(0, 256) : ''])),
    intervalMinSec,
    intervalMaxSec: Math.max(intervalMinSec, boundedInteger(input.intervalMaxSec, 300, 10, 86400)),
    leadSeconds: boundedInteger(input.leadSeconds, 120, 0, 86400),
    forecastEnabled: input.forecastEnabled !== false,
    matureEnabled: input.matureEnabled !== false,
    protectFriends: input.protectFriends !== false,
  };
}

function normalizeNotificationEvents(input = {}) {
  input = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(['account_offline', 'friend_crop_forecast', 'friend_crop_mature'].map(event => [
    event, [...new Set((Array.isArray(input[event]) ? input[event] : ['smtp', 'bark'])
      .filter(channel => ['smtp', 'bark'].includes(channel)))],
  ]));
}

const BARK_LEVELS = ['passive', 'active', 'timeSensitive', 'critical'];
function normalizeBarkLevels(input = {}) {
  return Object.fromEntries(['account_offline', 'friend_crop_forecast', 'friend_crop_mature'].map(event => [
    event, BARK_LEVELS.includes(input?.[event]) ? input[event] : event === 'friend_crop_mature' ? 'critical' : 'timeSensitive',
  ]));
}

module.exports = { normalizeAutoCodeRefresh, normalizeFriendMonitor, normalizeNotificationEvents, normalizeBarkLevels, BARK_LEVELS };

const { getConfigSnapshot } = require('../models/store');
const { normalizeFriendMonitor } = require('../config/account-maintenance');

function isMonitoredFriendProtected(gid, accountId) {
  const config = normalizeFriendMonitor(getConfigSnapshot(accountId).friendMonitor);
  return config.enabled && config.protectFriends && config.friendGids.includes(Number(gid));
}

function assertFriendMutationAllowed(gid, accountId) {
  if (isMonitoredFriendProtected(gid, accountId)) throw new Error('该好友已开启监听保护，禁止偷菜和捣乱');
}

module.exports = { isMonitoredFriendProtected, assertFriendMutationAllowed };

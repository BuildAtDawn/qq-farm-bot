const friendApi = require('./friend-api');
const { getOperationLimits } = require('./friend-operation-limits');
const {
  getFriendsList,
  getFriendLandsDetail,
  getFriendDogInfo,
  batchGetFriendDogInfo,
  fetchFriendsDogInfo,
  getFriendsListCache,
  setFriendsListCache,
} = require('./friend-land-analyzer');
const { doFriendOperation } = require('./friend-visit');
const { runGoldenBugPlacement } = require('./golden-bug-service');
const {
  checkFriends,
  runScheduledStealCheck,
  startFriendCheckLoop,
  stopFriendCheckLoop,
  refreshFriendCheckLoop,
  runBadOnceOnStartup,
  isHelpExpLimitReached,
  clearFriendsListCache,
  syncFriendsFromGids,
} = require('./friend-orchestrator');

async function delFriend(gid) {
  const reply = await friendApi.delFriend(gid);
  const cached = getFriendsListCache();
  if (Array.isArray(cached)) {
    setFriendsListCache(cached.filter(friend => Number(friend.gid) !== Number(gid)));
  }
  return reply;
}

module.exports = {
  checkFriends,
  runScheduledStealCheck,
  startFriendCheckLoop,
  stopFriendCheckLoop,
  refreshFriendCheckLoop,
  runBadOnceOnStartup,
  runGoldenBugPlacement,
  isHelpExpLimitReached,
  getOperationLimits,
  getFriendsList,
  getFriendLandsDetail,
  doFriendOperation,
  clearFriendsListCache,
  getFriendDogInfo,
  batchGetFriendDogInfo,
  syncFriendsFromGids,
  bootstrapQqFriendGids: friendApi.bootstrapQqFriendGids,
  fetchFriendsDogInfo,
  delFriend,
};

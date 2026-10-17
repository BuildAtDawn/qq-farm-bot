const { getFriendBlacklist } = require('../models/store');
const { getUserState } = require('../utils/network');
const { toNum, log, logWarn } = require('../utils/utils');
const { getFriendsList, analyzeFriendLands } = require('./friend-land-analyzer');
const { enterFriendFarm, leaveFriendFarm, checkCanOperateRemote, handleFriendEnterError, inFriendQuietHours } = require('./friend-api');
const {
  checkDailyReset, getRemainingTimes, getBadRemainingTimes,
  PUT_WEED_OPERATION_ID, BAD_DAILY_LIMIT,
  helpWeed, helpInsecticide, helpWater, putDailyTaskWeed,
} = require('./friend-operation-limits');
const { recordOperation } = require('./stats');

async function completeDailyFriendInteraction(shouldContinue) {
  if (!shouldContinue() || inFriendQuietHours()) return false;
  const ownGid = toNum(getUserState().gid);
  if (!ownGid) return false;
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const blocked = () => new Set((getFriendBlacklist(accountId) || []).map(toNum));
  const friends = await getFriendsList();
  if (!shouldContinue()) return false;
  const targets = friends.filter(friend => {
    const gid = toNum(friend.gid);
    return gid > 0 && gid !== ownGid && !blocked().has(gid);
  }).slice(0, 3);

  for (const friend of targets) {
    if (!shouldContinue() || inFriendQuietHours()) return false;
    const gid = toNum(friend.gid);
    const allowed = () => shouldContinue() && !inFriendQuietHours() && !blocked().has(gid);
    let entered = false;
    try {
      const reply = await enterFriendFarm(gid, { shouldContinue: allowed });
      entered = true;
      if (!allowed()) return false;
      checkDailyReset();
      const analysis = analyzeFriendLands(reply.lands || [], ownGid, friend.name);
      // One successful help is sufficient; do not run a whole friend patrol.
      const options = [
        { lands: analysis.needWeed, id: 0x2715, fn: helpWeed, stat: 'helpWeed', label: '除草' },
        { lands: analysis.needBug, id: 0x2716, fn: helpInsecticide, stat: 'helpBug', label: '除虫' },
        { lands: analysis.needWater, id: 0x2717, fn: helpWater, stat: 'helpWater', label: '浇水' },
      ];
      for (const option of options) {
        if (!option.lands.length) continue;
        if (!allowed()) return false;
        const remote = await checkCanOperateRemote(gid, option.id);
        if (!allowed()) return false;
        if (!remote.canOperate) continue;
        await option.fn(gid, option.lands.slice(0, 1));
        recordOperation(option.stat, 1);
        log('任务', `每日好友互动：帮 ${friend.name || gid} ${option.label}1块地`, {
          module: 'task', event: '每日好友互动', result: 'ok', friendGid: gid, action: option.stat,
        });
        return true;
      }

      // Never create trouble when this farm has something that needs help.
      if (options.some(option => option.lands.length > 0)) continue;
      if (!allowed()) return false;
      if (!analysis.canPutWeed.length ||
        getBadRemainingTimes(PUT_WEED_OPERATION_ID) <= 0 ||
        getRemainingTimes(PUT_WEED_OPERATION_ID, BAD_DAILY_LIMIT) <= 0) continue;
      const remote = await checkCanOperateRemote(gid, PUT_WEED_OPERATION_ID);
      if (!allowed()) return false;
      if (!remote.canOperate ||
        getBadRemainingTimes(PUT_WEED_OPERATION_ID) <= 0 ||
        getRemainingTimes(PUT_WEED_OPERATION_ID, BAD_DAILY_LIMIT) <= 0) continue;
      const result = await putDailyTaskWeed(gid, analysis.canPutWeed[0]);
      if (result.ok > 0) {
        recordOperation('weed', 1);
        log('任务', `每日好友互动：在 ${friend.name || gid} 的1块地放草1次`, {
          module: 'task', event: '每日好友互动', result: 'ok', friendGid: gid, action: 'weed',
        });
        return true;
      }
      logWarn('任务', '每日好友互动放草未成功，等待下次任务检查', {
        module: 'task', event: '每日好友互动', result: 'none', friendGid: gid,
      });
      return false;
    } catch (error) {
      if (!entered) handleFriendEnterError(gid, friend.name, error);
      logWarn('任务', `每日好友互动失败: ${error.message}`, {
        module: 'task', event: '每日好友互动', result: 'error', friendGid: gid,
      });
      // A timed-out write may have succeeded. Never try another mutation this scan.
      return false;
    } finally {
      if (entered) await leaveFriendFarm(gid);
    }
  }
  return false;
}

module.exports = { completeDailyFriendInteraction };

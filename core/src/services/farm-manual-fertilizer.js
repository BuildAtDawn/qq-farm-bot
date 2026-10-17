const { getAllLands, fertilizeOne, NORMAL_FERTILIZER_ID, ORGANIC_FERTILIZER_ID } = require('./farm-api');
const { buildLandDetails } = require('./farm-land-analyzer');
const { toNum, log } = require('../utils/utils');

async function fertilizeOwnLand(landIdInput, fertilizerType = 'organic') {
  const landId = Number(landIdInput);
  if (!Number.isSafeInteger(landId) || landId <= 0) throw new Error('无效的土地ID');
  if (fertilizerType !== 'normal' && fertilizerType !== 'organic') {
    throw new Error('化肥类型必须是 normal 或 organic');
  }

  const snapshot = await getAllLands();
  const rawLand = snapshot?.lands?.find(item => toNum(item.id) === landId);
  if (toNum(rawLand?.master_land_id) > 0 && toNum(rawLand.master_land_id) !== landId) {
    throw new Error('合种作物的从属土地不可单独施肥');
  }
  const land = buildLandDetails(snapshot).lands.find(item => Number(item.id) === landId);
  if (!land?.unlocked || land.occupiedByMaster || land.status !== 'growing' || !(land.matureInSec > 0)) {
    throw new Error('该地块当前不可催熟，请刷新土地状态');
  }
  if (fertilizerType === 'normal' && land.leftInorcFertTimes !== null && land.leftInorcFertTimes <= 0) {
    throw new Error('本季已施过普通化肥');
  }

  const fertilizerId = fertilizerType === 'normal' ? NORMAL_FERTILIZER_ID : ORGANIC_FERTILIZER_ID;
  const reply = await fertilizeOne(landId, fertilizerId);
  // Use the successful FertilizeReply directly; AllLands may still return an older snapshot.
  const replyLands = Array.isArray(reply?.land) ? reply.land : [];
  const updatedLand = buildLandDetails({ lands: replyLands }).lands
    .find(item => Number(item.id) === landId) || null;
  log('施肥', `土地 ${landId} 已施${fertilizerType === 'normal' ? '普通' : '有机'}化肥`, {
    module: 'farm', event: '手动施肥', result: 'ok', landId, fertilizerType
  });
  return {
    success: true,
    count: 1,
    landId,
    fertilizerType,
    fertilizerRemainingSec: reply?.fertilizer ? toNum(reply.fertilizer.count) : null,
    updatedLand
  };
}

module.exports = { fertilizeOwnLand };

const { sendMsgAsync, getUserState } = require('../utils/network');
const { types, waitForProtoReady } = require('../utils/proto');
const { toLong, sleep, logWarn } = require('../utils/utils');
const { guardFarmOperation, farmOperationGate } = require('./mutation-operation-gate');
const { recordPlanting, captureHarvest, finishHarvest, recordSafely, observeLands, observedStage } = require('./mutation-recorder');
const { getMutationRepository } = require('./mutation-records');
const { randomUUID } = require('node:crypto');
const { toNum } = require('../utils/utils');

let observationClock = Date.now();
function observationTime() {
  observationClock = Math.max(Date.now(), observationClock + 1);
  return observationClock;
}

function accountId() {
  return String(getUserState()?.accountId || process.env.FARM_ACCOUNT_ID || '');
}

async function plantSeed(seedId, landIds, metadata = {}) {
  const requestedAt = observationTime();
  const payload = types.PlantRequest.encode(types.PlantRequest.create({
    items: [{ seed_id: toLong(seedId), land_ids: landIds.map(toLong) }],
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Plant', payload);
  const reply = types.PlantReply.decode(body);
  try {
    const records = recordSafely(() => recordPlanting(accountId(), seedId, reply, metadata, landIds, requestedAt), !!metadata.testId);
    if (metadata.testId && records?.length !== 1) throw new Error('种植已返回，但无法确认变异记录，测试已停止');
  } catch (error) {
    error.planted = true;
    throw error;
  }
  return reply;
}

/** 普通化肥 ID */
const NORMAL_FERTILIZER_ID = 1011;
/** 有机化肥 ID */
const ORGANIC_FERTILIZER_ID = 1012;

// ─── 操作次数限制回调 ───

let onOperationLimitsUpdate = null;
function setOperationLimitsCallback(callback) {
  onOperationLimitsUpdate = callback;
}

// ─── 内部辅助 ───

/** 发送种植相关请求（通用） */
async function sendPlantRequest(ReqType, ReplyType, method, landIds, hostGid) {
  const payload = ReqType.encode(ReqType.create({
    land_ids: landIds,
    host_gid: toLong(hostGid)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', method, payload);
  return ReplyType.decode(body);
}

// ─── 农场 API ───

/** 获取所有地块数据 */
async function getAllLands(options = {}) {
  const requestedAt = observationTime();
  const payload = types.AllLandsRequest.encode(types.AllLandsRequest.create({})).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'AllLands', payload);
  const reply = types.AllLandsReply.decode(body);
  if (!options.preserveRecords) recordSafely(() => {
    const lands = reply.lands || [];
    if (options.observationLandId !== undefined) {
      observeLands(accountId(), lands.filter(land => toNum(land.id) !== options.observationLandId), { source: 'lands', requestedAt });
    }
    observeLands(accountId(), lands.filter(land => options.observationLandId === undefined || toNum(land.id) === options.observationLandId), {
      source: options.source || 'lands', requestedAt, operationId: options.operationId,
    });
  }, options.strict);
  if (reply.operation_limits && onOperationLimitsUpdate) {
    onOperationLimitsUpdate(reply.operation_limits);
  }
  return reply;
}

/** 一键收获 */
async function harvest(landIds, options = {}) {
  const userState = getUserState();
  const readSnapshot = async (readOptions) => {
    try { return await getAllLands(readOptions); }
    catch (error) {
      if (options.strict) throw error;
      logWarn('变异记录', `收获快照读取失败: ${error.message}`);
      if (accountId()) recordSafely(() => getMutationRepository(accountId()).invalidate(landIds, 'unknown'));
      return { lands: [] };
    }
  };
  const before = await readSnapshot({ strict: options.strict, source: 'harvest_before' });
  const captures = recordSafely(() => captureHarvest(accountId(), before.lands || [], landIds), options.strict) || [];
  if (options.strict && captures.length !== landIds.length) throw new Error('测试作物与种植记录不匹配');
  const payload = types.HarvestRequest.encode(types.HarvestRequest.create({
    land_ids: landIds,
    host_gid: toLong(userState.gid),
    is_all: true
  })).finish();
  farmOperationGate.assertAllowed();
  if (accountId()) recordSafely(() => getMutationRepository(accountId()).prepareHarvest(captures), options.strict);
  try {
    const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Harvest', payload);
    const reply = types.HarvestReply.decode(body);
    // Replies may omit unchanged/empty lands. A fresh snapshot confirms each result.
    const after = await readSnapshot({ preserveRecords: true });
    const recorded = recordSafely(() => finishHarvest(accountId(), captures, after.lands || []), options.strict);
    if (options.strict && recorded !== captures.length) throw new Error('收获结果未能完整确认，测试已停止');
    return reply;
  } finally {
    if (accountId()) recordSafely(() => getMutationRepository(accountId()).abandonHarvest(captures.map(row => row.id)), options.strict);
  }
}

/** 浇水 */
async function waterLand(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.WaterLandRequest, types.WaterLandReply, 'WaterLand', landIds, userState.gid);
}

/** 一键务农（浇水/除草/除虫） */
async function farming(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.FarmingRequest, types.FarmingReply, 'Farming', landIds, userState.gid);
}

/** 除草 */
async function weedOut(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.WeedOutRequest, types.WeedOutReply, 'WeedOut', landIds, userState.gid);
}

/** 除虫 */
async function insecticide(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.InsecticideRequest, types.InsecticideReply, 'Insecticide', landIds, userState.gid);
}

/** 同一种化肥一次提交多个地块，返回全部服务端土地与肥料库存快照。 */
async function fertilizeBatch(landIds, fertilizerId = NORMAL_FERTILIZER_ID, options = {}) {
  if (!Array.isArray(landIds) || !landIds.length
    || landIds.some(id => !Number.isSafeInteger(toNum(id)) || toNum(id) <= 0)) {
    throw new Error('无效的施肥土地ID');
  }
  const ids = [...new Set(landIds.map(toNum))];
  const id = accountId();
  const repository = id ? getMutationRepository(id) : null;
  const batchId = randomUUID();
  let snapshot = options.beforeSnapshot;
  try {
    if (!snapshot) {
      // Multi-land pre-reads are ordinary observations, not attributed to a single land's action.
      snapshot = await getAllLands(ids.length === 1
        ? { strict: options.strict, source: 'fertilizer_before', operationId: batchId, observationLandId: ids[0] }
        : { strict: options.strict });
    }
  } catch (error) {
    if (options.strict) throw error;
    logWarn('变异记录', `施肥前快照读取失败: ${error.message}`);
  }
  const requestedAt = observationTime();
  const entries = ids.map(landId => {
    const before = recordSafely(() => repository?.activeRecord(landId), options.strict);
    const beforeKnown = (snapshot?.lands || []).some(land => toNum(land.id) === landId);
    const operation = {
      id: ids.length === 1 ? batchId : randomUUID(), recordId: before?.id, landId, fertilizerId, requestedAt,
      beforeStage: beforeKnown ? before?.currentStage ?? null : null,
      afterStage: null, consumedSeconds: null, consumedItemId: null, remainingSeconds: null,
      status: 'unknown', requestSent: false, quality: beforeKnown ? 'after_missing' : 'before_missing',
      ...(ids.length > 1 ? { batchId, batchLandIds: ids, batchConsumedSeconds: null } : {}),
    };
    return { before, beforeKnown, operation };
  });
  const payload = types.FertilizeRequest.encode(types.FertilizeRequest.create({
    land_ids: ids.map(toLong),
    fertilizer_id: toLong(fertilizerId)
  })).finish();
  try {
    options.validateBeforeSend?.();
    farmOperationGate.assertAllowed();
    for (const { operation } of entries) operation.requestSent = true;
    const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', payload);
    const reply = types.FertilizeReply.decode(body);
    const consumed = reply.fertilizer_use?.consumed;
    for (const { before, beforeKnown, operation } of entries) {
      const after = (reply.land || []).filter(land => toNum(land.id) === operation.landId);
      operation.status = after.length || ids.length === 1 ? 'success' : 'unknown';
      if (before) recordSafely(() => observeLands(id, after, {
        source: 'fertilizer_after', requestedAt, operationId: operation.id, recordId: before.id,
      }), options.strict);
      operation.afterStage = observedStage(before, after[0]);
      operation.quality = !beforeKnown ? 'before_missing' : !after.length ? 'after_missing'
        : operation.beforeStage === null || operation.afterStage === null ? 'stage_unknown' : 'known';
      const seconds = consumed && Object.hasOwn(consumed, 'count') ? toNum(consumed.count) : null;
      // The reply reports aggregate consumption; never charge it to every land's record.
      if (ids.length === 1) operation.consumedSeconds = seconds;
      else operation.batchConsumedSeconds = seconds;
      operation.consumedItemId = consumed && Object.hasOwn(consumed, 'id') ? toNum(consumed.id) : null;
      operation.remainingSeconds = reply.fertilizer && Object.hasOwn(reply.fertilizer, 'count') ? toNum(reply.fertilizer.count) : null;
    }
    if (options.strict && entries.some(({ before, operation }) => !before
      || !(reply.land || []).some(land => toNum(land.id) === operation.landId))) {
      throw new Error('施肥阶段快照不完整，测试已停止');
    }
    return reply;
  } catch (error) {
    for (const { operation } of entries) {
      if (!operation.requestSent) operation.status = 'not_sent';
      operation.error = error.message;
    }
    throw error;
  } finally {
    for (const { before, operation } of entries) {
      operation.finishedAt = Date.now();
      if (before) recordSafely(() => repository.recordOperation(operation), options.strict);
    }
  }
}

/** 单地块入口保留原有调用及回包契约。 */
async function fertilizeOne(landId, fertilizerId = NORMAL_FERTILIZER_ID, options = {}) {
  return fertilizeBatch([landId], fertilizerId, options);
}

/**
 * 施肥
 * @param {number[]} landIds - 地块 ID 列表
 * @param {number} fertilizerId - 化肥类型（默认普通化肥）
 * @returns {number} 成功施肥次数
 */
async function fertilize(landIds, fertilizerId = NORMAL_FERTILIZER_ID) {
  let successCount = 0;
  for (const landId of landIds) {
    try {
      await fertilizeOne(landId, fertilizerId);
      successCount++;
    } catch {
      break;
    }
    // 多地施肥时加入间隔避免请求过快
    if (landIds.length > 1) {
      await sleep(200, 600);
    }
  }
  return successCount;
}

/** 铲除植物 */
async function removePlant(landIds) {
  const payload = types.RemovePlantRequest.encode(types.RemovePlantRequest.create({
    land_ids: landIds.map(id => toLong(id))
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'RemovePlant', payload);
  const reply = types.RemovePlantReply.decode(body);
  if (accountId()) recordSafely(() => getMutationRepository(accountId()).invalidate(landIds));
  return reply;
}

/** 升级土地 */
async function upgradeLand(landId) {
  const payload = types.UpgradeLandRequest.encode(types.UpgradeLandRequest.create({
    land_id: toLong(landId)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'UpgradeLand', payload);
  return types.UpgradeLandReply.decode(body);
}

/**
 * 解锁土地
 * @param {number} landId - 土地 ID
 * @param {boolean} doShared - 是否使用共享解锁
 */
async function unlockLand(landId, doShared = false) {
  const payload = types.UnlockLandRequest.encode(types.UnlockLandRequest.create({
    land_id: toLong(landId),
    do_shared: !!doShared
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'UnlockLand', payload);
  return types.UnlockLandReply.decode(body);
}

/** 获取商店列表 */
async function getShopProfiles() {
  await waitForProtoReady();
  const payload = types.ShopProfilesRequest.encode(types.ShopProfilesRequest.create({})).finish();
  const { body } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopProfiles', payload);
  return types.ShopProfilesReply.decode(body);
}

/** 种子商店 ID：协议与管理面板都已固定为 2 */
const cachedSeedShopId = 2;
async function getSeedShopId() {
  return cachedSeedShopId;
}

/** 获取商店商品信息 */
async function getShopInfo(shopId) {
  await waitForProtoReady();
  const payload = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({
    shop_id: toLong(shopId)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopInfo', payload);
  return types.ShopInfoReply.decode(body);
}

/**
 * 购买商品
 * @param {number} goodsId - 商品 ID
 * @param {number} num - 购买数量
 * @param {number} price - 单价
 */
async function buyGoods(goodsId, num, price) {
  await waitForProtoReady();
  const payload = types.BuyGoodsRequest.encode(types.BuyGoodsRequest.create({
    goods_id: toLong(goodsId),
    num: toLong(num),
    price: toLong(price)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.shoppb.ShopService', 'BuyGoods', payload);
  return types.BuyGoodsReply.decode(body);
}

module.exports = {
  plantSeed: guardFarmOperation(plantSeed),
  NORMAL_FERTILIZER_ID,
  ORGANIC_FERTILIZER_ID,
  setOperationLimitsCallback,
  getAllLands,
  harvest: guardFarmOperation(harvest),
  waterLand: guardFarmOperation(waterLand),
  farming: guardFarmOperation(farming),
  weedOut: guardFarmOperation(weedOut),
  insecticide: guardFarmOperation(insecticide),
  fertilize: guardFarmOperation(fertilize),
  fertilizeOne: guardFarmOperation(fertilizeOne),
  fertilizeBatch: guardFarmOperation(fertilizeBatch),
  removePlant: guardFarmOperation(removePlant),
  upgradeLand: guardFarmOperation(upgradeLand),
  unlockLand: guardFarmOperation(unlockLand),
  getShopInfo,
  buyGoods,
  getShopProfiles,
  getSeedShopId
};

const { createHash } = require('node:crypto');
const { toNum, toTimeSec } = require('../utils/utils');
const { getPlantName, getPlantById, getPlantGrowPhases, getMutantDisplayPlantId } = require('../config/gameConfig');
const { convertServerPhaseToClient, buildLandMap, getDisplayLandContext } = require('./farm-land-analyzer');
const { normalizeNotificationTemplates, renderNotificationTemplate } = require('./notification-templates');

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildMonitorSnapshot(lands, { gid, name = '', nowSec }) {
  const landMap = buildLandMap(lands);
  const details = (Array.isArray(lands) ? lands : []).map(land => {
    const context = getDisplayLandContext(land, landMap);
    const plant = land.plant;
    const phases = (plant?.phases || []).map(phase => ({
      phase: toNum(phase.phase), phaseId: toNum(phase.phase_id), beginTime: toTimeSec(phase.begin_time),
      dryTime: toTimeSec(phase.dry_time), weedsTime: toTimeSec(phase.weeds_time), insectTime: toTimeSec(phase.insect_time),
    }));
    const plantId = toNum(plant?.id);
    const mutantIds = (plant?.mutant_config_ids || []).map(toNum);
    const displayId = getMutantDisplayPlantId(plantId, mutantIds);
    const info = getPlantById(plantId);
    const current = plant ? convertServerPhaseToClient(plant.phases, plant.phases?.[0], plantId) : null;
    let mature = phases.find(phase => phase.phase === 6 || phase.phase === 19 || phase.phaseId === 19);
    // Official phases are the current + future suffix; the configured final phase can also encode maturity.
    if (!mature && phases.length && getPlantGrowPhases(plantId).length && phases.at(-1).phase !== 7) mature = phases.at(-1);
    return {
      landId: toNum(land.id), unlocked: !!land.unlocked, level: toNum(land.level),
      masterLandId: context.occupiedByMaster ? context.masterLandId : 0,
      slaveLandIds: (land.slave_land_ids || []).map(toNum).sort((a, b) => a - b),
      landSize: toNum(land.land_size), plantId, seedId: toNum(info?.seed_id),
      plantName: plantId ? (getPlantName(displayId) || getPlantName(plantId) || plant?.name || `作物 ${plantId}`) : '',
      plantSize: Math.max(1, toNum(info?.size) || 1, (land.slave_land_ids || []).length === 3 ? 2 : 1), season: toNum(plant?.season) || 1,
      phase: current?.phase || 0, phases, matureAt: mature?.beginTime || 0,
      dryNum: toNum(plant?.dry_num), weedOwners: (plant?.weed_owners || []).map(toNum),
      insectOwners: (plant?.insect_owners || []).map(toNum), mutantIds,
      fruitId: toNum(plant?.fruit_id), fruitNum: toNum(plant?.fruit_num), leftFruitNum: toNum(plant?.left_fruit_num),
      stoleNum: toNum(plant?.stole_num), stealable: !!plant?.stealable, isNudged: !!plant?.is_nudged,
    };
  }).sort((a, b) => a.landId - b.landId);
  const snapshot = { gid: Number(gid), name, observedAt: nowSec, lands: details };
  snapshot.planKey = digest(planIdentity(snapshot));
  return snapshot;
}

function planIdentity(snapshot) {
  return (snapshot?.lands || []).filter(land => !land.masterLandId).map(land => [
    land.landId, land.plantId, land.season, land.matureAt, land.slaveLandIds,
  ]);
}

function maturityGroups(snapshot) {
  const groups = new Map();
  for (const land of snapshot?.lands || []) {
    if (!land.unlocked || land.masterLandId || !land.plantId || !land.matureAt || land.phase === 7) continue;
    const minute = Math.floor(land.matureAt / 60);
    if (!groups.has(minute)) groups.set(minute, { minute, matureAt: land.matureAt, crops: [], members: [] });
    const group = groups.get(minute);
    group.matureAt = Math.min(group.matureAt, land.matureAt);
    let crop = group.crops.find(item => item.plantId === land.plantId && item.name === land.plantName && item.size === land.plantSize);
    if (!crop) {
      crop = { plantId: land.plantId, name: land.plantName, size: land.plantSize, count: 0, landCount: 0 };
      group.crops.push(crop);
    }
    crop.count += 1;
    crop.landCount += Math.max(1, land.slaveLandIds.length + 1, land.plantSize ** 2);
    group.members.push([land.landId, land.plantId, land.season, land.matureAt]);
  }
  return [...groups.values()].sort((a, b) => a.matureAt - b.matureAt).map(group => ({
    ...group, key: digest(group.members.sort((a, b) => a[0] - b[0])),
  }));
}

function formatMaturityTime(timestamp, nowSec) {
  const offset = 8 * 3600;
  const days = Math.floor((timestamp + offset) / 86400) - Math.floor((nowSec + offset) / 86400);
  const date = new Date((timestamp + offset) * 1000);
  const label = days === 0 ? '今天' : days === 1 ? '明天' : days > 1 ? `${days} 天后` : `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  const delta = timestamp - nowSec;
  const remaining = delta <= 0 ? '已成熟' : delta < 60 ? '不足 1 分钟' : `还有 ${Math.ceil(delta / 60)} 分钟`;
  return delta > 120 * 60 ? `${label} ${time}` : `${label} ${time} · ${remaining}`;
}

function buildCropNotification(event, { friendName, accountName, groups, nowSec, templates }) {
  if (!groups.length) throw new Error('缺少作物成熟数据');
  const heading = event === 'friend_crop_forecast' ? '成熟预告' : groups[0]?.matureAt <= nowSec ? '已成熟' : '即将成熟';
  const lines = [];
  for (const group of groups) {
    lines.push(formatMaturityTime(group.matureAt, nowSec));
    lines.push(group.crops.map(crop => crop.size > 1
      ? `${crop.name} ${crop.count} 株（占 ${crop.landCount} 块地）`
      : `${crop.name} ${crop.count} 块地`).join('、'), '');
  }
  const crops = groups.flatMap(group => group.crops);
  return renderNotificationTemplate(normalizeNotificationTemplates(templates)[event], {
    好友名称: friendName, 账号名称: accountName,
    成熟时间: formatMaturityTime(groups[0].matureAt, nowSec),
    剩余分钟: Math.max(0, Math.ceil((groups[0].matureAt - nowSec) / 60)),
    作物名称: [...new Set(crops.map(crop => crop.name))].join('、'),
    地块数量: crops.reduce((sum, crop) => sum + crop.landCount, 0),
    作物数量: crops.reduce((sum, crop) => sum + crop.count, 0),
    作物明细: lines.join('\n').trimEnd(), 成熟状态: heading,
  });
}

module.exports = { digest, buildMonitorSnapshot, maturityGroups, formatMaturityTime, buildCropNotification };

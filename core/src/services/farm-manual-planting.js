const { getAllLands } = require('./farm-api');
const { buildLandDetails } = require('./farm-land-analyzer');
const { getBagSeeds } = require('./warehouse');
const { getUserState } = require('../utils/network');
const { isSeedLockedByLevel, getPlantSizeBySeedId, build2x2LandGroups, plant2x2Seed, plantSeeds } = require('./planting-service');
const { farmOperationGate } = require('./mutation-operation-gate');
const { recordOperation } = require('./stats');
const { validateSeedIds } = require('../utils/manual-seed-selection');

let planting = false;

async function plantSelectedBagSeeds(seedIds) {
  const selectedIds = validateSeedIds(seedIds);
  if (planting) throw new Error('背包种植正在执行，请稍后重试');
  planting = true;
  try {
    return await farmOperationGate.operation(async () => {
      const bag = await getBagSeeds();
      const selected = selectedIds.map(id => {
        const seed = bag.find(item => Number(item.seedId) === id && Number(item.count) > 0);
        if (!seed) throw new Error(`种子 #${id} 库存不足，请重新选择`);
        if (isSeedLockedByLevel(seed, getUserState().level)) throw new Error(`${seed.name} 等级未解锁`);
        return seed;
      });
      const reply = await getAllLands();
      const detail = buildLandDetails(reply);
      const empty = new Set((detail?.lands || [])
        .filter(land => land.unlocked && !land.occupiedByMaster && land.status === 'empty')
        .map(land => Number(land.id)));
      const plantedLandIds = [];
      for (const seed of selected) {
        const count = Math.floor(Number(seed.count));
        if (getPlantSizeBySeedId(seed.seedId) === 2) {
          let planted = 0;
          const groups = build2x2LandGroups(reply.lands).sort((a, b) => a.masterLandId - b.masterLandId);
          for (const group of groups) {
            if (planted >= count) break;
            if (!group.landIds.every(id => empty.has(id))) continue;
            const result = await plant2x2Seed(seed.seedId, group);
            result.occupiedLandIds.forEach(id => empty.delete(id));
            plantedLandIds.push(result.masterLandId);
            recordOperation('plant', 1);
            planted++;
          }
        } else {
          const ids = [...empty].sort((a, b) => a - b).slice(0, count);
          if (!ids.length) continue;
          const result = await plantSeeds(seed.seedId, ids, { maxPlantCount: ids.length });
          result.occupiedLandIds.forEach(id => empty.delete(id));
          plantedLandIds.push(...result.plantedLandIds);
          if (result.planted) recordOperation('plant', result.planted);
          // A failed request can have an uncertain outcome. Do not reuse those lands for another seed.
          if (result.planted < ids.length) break;
        }
      }
      return { planted: plantedLandIds.length, plantedLandIds, remaining: empty.size };
    });
  } finally {
    planting = false;
  }
}

module.exports = { validateSeedIds, plantSelectedBagSeeds };

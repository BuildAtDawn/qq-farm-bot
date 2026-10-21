const catalog = require('../gameConfig/GrowthPlantingTasks.json');
const definitions = new Map(catalog.tasks.map(task => [task.taskId, task]));

// Only explicitly verified planting tasks are eligible; never infer actions from live text.
function getGrowthPlantingNeeds(tasks) {
  const needs = new Map();
  for (const task of tasks || []) {
    const definition = definitions.get(Number(task.id));
    if (!definition || !task.is_unlocked || task.is_claimed) continue;
    const total = Number(task.total_progress);
    const progress = Number(task.progress);
    if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(progress) || progress < 0) continue;
    const remaining = Math.max(0, total - progress);
    if (!remaining) continue;
    const action = definition.action === 'buy' ? 'buy' : 'plant';
    const existing = needs.get(definition.seedId);
    if (existing) {
      // One planting can advance several already unlocked tasks for the same seed.
      existing.count = Math.max(existing.count, remaining);
      if (!existing.actions.includes(action)) existing.actions.push(action);
    } else {
      needs.set(definition.seedId, { count: remaining, actions: [action] });
    }
  }
  return [...needs].map(([seedId, need]) => ({ seedId, count: need.count, actions: need.actions }));
}

// 购买类成长任务（condition=购买N个X种子）：进度只由「购买」动作驱动，与种植无关，
// 也不依赖空地。直接按剩余进度补购种子，购买成功后由服务端计入任务进度。
async function buyGrowthTaskSeeds(deps) {
  const tasks = await deps.getTasks();
  const needs = getGrowthPlantingNeeds(tasks).filter(need => need.actions.includes('buy'));
  if (!needs.length) return [];
  const bought = [];
  for (const need of needs) {
    try {
      const seeds = await deps.getBagSeeds();
      const owned = Math.max(0, Number(seeds.find(seed => Number(seed.seedId) === need.seedId)?.count) || 0);
      const count = await deps.buySeed(need.seedId, need.count, owned);
      if (count > 0) bought.push({ seedId: need.seedId, count });
    }
    catch (error) {
      deps.warn?.(`购买类任务补购种子失败 (seedId=${need.seedId}): ${error.message}`);
    }
  }
  return bought;
}

async function plantGrowthTasks(landIds, deps) {
  const plantedLandIds = [];
  let remainingLandIds = [...landIds];
  const tasks = await deps.getTasks();
  // 购买类任务由 buyGrowthTaskSeeds 处理，这里只种「种植类」任务。
  const needs = getGrowthPlantingNeeds(tasks).filter(need => need.actions.includes('plant'));
  if (!needs.length) return { plantedLandIds, remainingLandIds };
  const seeds = await deps.getBagSeeds();
  for (const need of needs) {
    if (!remainingLandIds.length) break;
    const plant = deps.getPlant(need.seedId);
    if (!plant || Number(plant.size || 1) !== 1 || deps.isLocked(plant)) continue;
    const count = Math.min(need.count, remainingLandIds.length);
    const owned = Math.max(0, Number(seeds.find(seed => Number(seed.seedId) === need.seedId)?.count) || 0);
    let available = Math.min(count, owned);
    if (available < count) {
      available += await deps.buySeed(need.seedId, count - available, owned);
    }
    if (!available) continue;
    const targets = remainingLandIds.slice(0, Math.min(count, available));
    const result = await deps.plantSeeds(need.seedId, targets, { maxPlantCount: targets.length });
    plantedLandIds.push(...result.plantedLandIds);
    const used = new Set(result.occupiedLandIds);
    remainingLandIds = remainingLandIds.filter(id => !used.has(id));
    // A partial/uncertain planting must not trigger another purchase or normal planting this round.
    if (result.planted < targets.length) return { plantedLandIds, remainingLandIds: [], interrupted: true };
  }
  return { plantedLandIds, remainingLandIds };
}

module.exports = { getGrowthPlantingNeeds, plantGrowthTasks, buyGrowthTaskSeeds };

const { getMutationRepository } = require('./mutation-records');
const { getPlantBySeedId, getPlantGrowPhases, getPlantNameBySeedId, getMutantEffectById } = require('../config/gameConfig');
const { toNum, toTimeSec, logWarn } = require('../utils/utils');
const { stageNumber } = require('./mutation-stages');

function plantIdentity(land) {
  const plant = land?.plant;
  if (!plant?.phases?.length || !toNum(plant?.id)) return '';
  // The protocol exposes a remaining-phase suffix, not an immutable planted-at.
  // Bind to the local planting row, and separately reject observed phase resets.
  return `${toNum(plant.id)}:${toNum(plant.season)}`;
}

function plantObservation(land) {
  return {
    landId: toNum(land.id), identity: plantIdentity(land),
    phaseCount: land.plant?.phases?.length || 0,
    phaseBegin: toTimeSec(land.plant?.phases?.[0]?.begin_time),
  };
}

function observedStage(row, land) {
  if (!row || !land || row.identity !== plantIdentity(land)) return null;
  const phase = land.plant?.phases?.[0];
  return stageNumber(row, {
    ...plantObservation(land),
    mature: toNum(phase?.phase) === 6 || toNum(phase?.phase_id) === 19,
    dead: toNum(phase?.phase) === 7,
  });
}

function observeLands(accountId, lands, context = {}) {
  if (!accountId) return;
  const { getCurrentPhase, getPlantMutantConfigIds } = require('./farm-land-analyzer');
  const observedAt = Date.now();
  getMutationRepository(accountId).observe(lands.map(land => {
    const plant = land.plant;
    const phase = getCurrentPhase(plant?.phases || [], false, '', plant?.id);
    const details = new Map((phase?.mutants || []).map(item => [toNum(item.mutant_config_id), item]));
    return {
      ...plantObservation(land), ...context, observedAt,
      mature: toNum(phase?.phase) === 6, dead: toNum(phase?.phase) === 7,
      mutationsKnown: Array.isArray(plant?.mutant_config_ids) || Array.isArray(phase?.mutants),
      mutations: getPlantMutantConfigIds(plant, phase).map(id => ({
        id, name: getMutantEffectById(id)?.effect_name || getMutantEffectById(id)?.name || `变异 #${id}`,
        serverMutationAt: toTimeSec(details.get(id)?.mutant_time) > 0 ? toTimeSec(details.get(id).mutant_time) * 1000 : null,
        weatherId: details.get(id) && Object.hasOwn(details.get(id), 'weather_id') ? toNum(details.get(id).weather_id) : null,
      })),
    };
  }));
}

function recordPlanting(accountId, seedId, reply, metadata = {}, requestedLandIds = [], requestedAt) {
  if (!accountId) return [];
  const repository = getMutationRepository(accountId);
  const config = getPlantBySeedId(seedId);
  const records = [];
  for (const land of reply?.land || []) {
    if (requestedLandIds.length && !requestedLandIds.includes(toNum(land.id))) continue;
    if (toNum(land.master_land_id) && toNum(land.master_land_id) !== toNum(land.id)) continue;
    const identity = plantIdentity(land);
    if (!identity) continue;
    const plantId = toNum(land.plant.id);
    const configured = config?.id === plantId ? getPlantGrowPhases(plantId) : [];
    const stagePlan = configured.map(phase => ({ name: phase.name, duration: phase.duration }));
    const record = repository.insert({
      seedId, seedName: config?.name || getPlantNameBySeedId(seedId),
      landId: toNum(land.id), identity, plantedAt: Date.now(),
      schemaVersion: 2, plantId, stagePlan, totalStages: stagePlan.length || null,
      stagePlanSource: stagePlan.length ? 'plant_config_snapshot' : 'unknown',
      stageQuality: stagePlan.length ? 'known' : 'missing_or_mismatched_config',
      lastObservationRequestAt: requestedAt || null,
      ...plantObservation(land),
      source: metadata.testId ? 'test' : 'system',
      testId: metadata.testId || '', round: metadata.round || null,
    });
    observeLands(accountId, [land], { source: 'planting', requestedAt, recordId: record.id });
    records.push(record);
  }
  return records;
}

function captureHarvest(accountId, lands, landIds) {
  const { getCurrentPhase, getPlantMutantConfigIds } = require('./farm-land-analyzer');
  if (!accountId) return [];
  const repository = getMutationRepository(accountId);
  return lands.filter(land => landIds.includes(toNum(land.id))).flatMap(land => {
    const row = repository.capture(toNum(land.id), plantIdentity(land));
    if (!row) return [];
    const phase = getCurrentPhase(land.plant.phases, false, '', land.plant.id);
    if (toNum(phase?.phase) !== 6) return [];
    const mutations = getPlantMutantConfigIds(land.plant, phase).map(id => ({
      id, name: getMutantEffectById(id)?.effect_name || getMutantEffectById(id)?.name || `变异 #${id}`,
    }));
    return [{ ...row, mutations }];
  });
}

function finishHarvest(accountId, captures, afterLands) {
  const { getCurrentPhase } = require('./farm-land-analyzer');
  if (!accountId) return 0;
  const repository = getMutationRepository(accountId);
  let count = 0;
  for (const row of captures) {
    const land = afterLands.find(item => toNum(item.id) === row.landId);
    if (!land) continue;
    const phase = getCurrentPhase(land.plant?.phases || [], false, '', land.plant?.id);
    const confirmed = !land.plant?.phases?.length || toNum(phase?.phase) === 7
      || (toNum(land.plant?.season) > Number(row.identity.split(':')[1]));
    if (confirmed && repository.finish(row.id, row.mutations, Date.now())) count++;
  }
  return count;
}

function recordSafely(fn, strict = false) {
  try { return fn(); }
  catch (error) {
    logWarn('变异记录', error.message);
    if (strict) throw error;
    return null;
  }
}

function clearMutationRecords(accountId) {
  require('./mutation-operation-gate').farmOperationGate.assertAllowed();
  return getMutationRepository(accountId).clear();
}

module.exports = { plantIdentity, plantObservation, observedStage, observeLands, recordPlanting, captureHarvest, finishHarvest, recordSafely, clearMutationRecords };

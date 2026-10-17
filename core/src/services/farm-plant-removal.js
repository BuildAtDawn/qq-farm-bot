const { buildLandDetails } = require('./farm-land-analyzer');
const { getAllLands, removePlant } = require('./farm-api');
const { farmOperationGate } = require('./mutation-operation-gate');
const { log } = require('../utils/utils');

function selectRemovableCropIds(lands, deadOnly = false) {
  return [...new Set((lands || [])
    .filter(land => land?.unlocked && !land.occupiedByMaster
      && (deadOnly ? land.status === 'dead' : ['growing', 'harvestable', 'dead'].includes(land.status)))
    .map(land => Number(land.id))
    .filter(id => Number.isInteger(id) && id > 0))];
}

async function removeFarmPlants(deadOnly = false) {
  return farmOperationGate.operation(async () => {
    const detail = buildLandDetails(await getAllLands());
    const landIds = selectRemovableCropIds(detail?.lands, deadOnly);
    if (!landIds.length) {
      return { removed: 0, message: deadOnly ? '没有枯萎作物' : '没有可铲除的作物' };
    }
    await removePlant(landIds);
    log('铲除', `已铲除 ${landIds.length} 株${deadOnly ? '枯萎' : ''}作物`, {
      module: 'farm', event: deadOnly ? '铲除枯萎' : '全部铲除', result: 'ok', count: landIds.length,
    });
    return { removed: landIds.length, message: `已铲除 ${landIds.length} 株${deadOnly ? '枯萎' : ''}作物` };
  });
}

module.exports = { selectRemovableCropIds, removeFarmPlants };

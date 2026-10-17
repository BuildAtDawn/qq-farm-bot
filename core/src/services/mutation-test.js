const { getUserState, isConnected } = require('../utils/network');
const { getAutomation, isAutomationOn } = require('../models/store');
const { getBagSeeds } = require('./warehouse');
const { getPlantBySeedId } = require('../config/gameConfig');
const { getCurrentPhase, analyzeLands } = require('./farm-land-analyzer');
const { isSeedLockedByLevel } = require('./planting-service');
const { toNum, toTimeSec, log, logWarn } = require('../utils/utils');
const api = require('./farm-api');
const { farmOperationGate } = require('./mutation-operation-gate');
const { plantIdentity, plantObservation } = require('./mutation-recorder');
const { createMutationTestRunner } = require('./mutation-test-runner');
const { readMutationTestState, writeMutationTestState, setMutationTestActive } = require('./mutation-test-state');

function inspectLand(land) {
  const plant = land.plant;
  const phase = getCurrentPhase(plant?.phases || [], false, '', plant?.id);
  const phaseId = toNum(phase?.phase);
  return {
    id: toNum(land.id), unlocked: !!land.unlocked, identity: plantIdentity(land),
    ...plantObservation(land),
    state: !plant?.phases?.length ? (toNum(plant?.id) ? 'unknown' : 'empty') : phaseId === 6 ? 'mature' : phaseId === 7 ? 'dead' : phaseId > 0 ? 'growing' : 'unknown',
    matureAt: toTimeSec(plant?.phases?.at(-1)?.begin_time),
    normalRemaining: Object.hasOwn(plant || {}, 'left_inorc_fert_times') ? toNum(plant.left_inorc_fert_times) : null,
  };
}
async function getMutationTestSeeds() {
  const seeds = await getBagSeeds();
  return seeds.map(seed => {
    const config = getPlantBySeedId(seed.seedId);
    return {
      ...seed,
      supported: !!config && Number(config.size || 1) === 1 && Number(config.seasons) === 1
        && !isSeedLockedByLevel(seed, getUserState().level),
    };
  });
}

let runner;
let sendState = () => {};
function initializeMutationTest(send) {
  if (typeof send === 'function') sendState = send;
  if (runner) return runner;
  const accountId = String(process.env.FARM_ACCOUNT_ID || getUserState()?.accountId || '');
  const notify = state => {
    setMutationTestActive(accountId, state.enabled);
    sendState({ type: 'mutation_test_state', data: state });
  };
  runner = createMutationTestRunner({
    initial: readMutationTestState(accountId),
    save: state => { writeMutationTestState(accountId, state); notify(state); },
    connected: () => isConnected() && toNum(getUserState().gid) > 0,
    automation: getAutomation,
    gate: farmOperationGate,
    seeds: getMutationTestSeeds,
    lands: async () => (await api.getAllLands({ strict: true })).lands.map(inspectLand),
    plant: async (seedId, landId, metadata) => {
      const reply = await api.plantSeed(seedId, [landId], metadata);
      return inspectLand(reply.land.find(land => toNum(land.id) === landId));
    },
    fertilize: (landId, kind) => api.fertilizeOne(landId, kind === 'normal' ? api.NORMAL_FERTILIZER_ID : api.ORGANIC_FERTILIZER_ID, { strict: true }),
    farming: async ids => {
      const analysis = analyzeLands((await api.getAllLands({ strict: true })).lands, false);
      const targets = [...new Set([
        ...analysis.needWater, ...analysis.needWeed, ...analysis.needBug,
        ...(isAutomationOn('golden_bug_clear') ? analysis.needGoldenBug : []),
      ])].filter(id => ids.includes(id));
      if (targets.length) await api.farming(targets);
    },
    harvest: ids => api.harvest(ids, { strict: true }),
    remove: api.removePlant,
    onEnd: state => {
      notify(state);
      log('测变异', state.reason || '测试完成', { module: 'farm', event: '测变异结束', status: state.status, planted: state.planted, harvested: state.harvested });
    },
    onError: error => logWarn('测变异', error.message),
  });
  return runner;
}
function getMutationTest() {
  return initializeMutationTest();
}
function stopMutationTest(reason) {
  try { return runner?.stop(reason); }
  catch (error) {
    // Cancellation is set before persistence; a disk error must not break disconnect cleanup.
    logWarn('测变异', error.message);
    return runner?.snapshot();
  }
}
module.exports = { inspectLand, initializeMutationTest, getMutationTest, stopMutationTest, getMutationTestSeeds };

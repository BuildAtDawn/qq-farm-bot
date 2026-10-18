const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createRequire } = require('node:module');

function loadService() {
  const filename = path.join(__dirname, '../src/services/farm-fertilizer.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const utils = {
    toNum: value => Number(value) || 0,
    toTimeSec: value => Number(value) || 0,
    getServerTimeSec: () => 1000,
    log: () => {},
    logWarn: () => {},
    randomDelay: async () => {},
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    console,
    require: name => ({
      '../config/config': { PlantPhase: { SEED: 1, MATURE: 6, DEAD: 7, UNKNOWN: 0 } },
      '../config/gameConfig': { getPlantById: () => ({ size: 1 }) },
      '../utils/utils': utils,
      '../models/store': { getAutomation: () => ({}), getSystemSettings: () => ({}) },
      './stats': { recordOperation: () => {} },
      './farm-api': { getAllLands: async () => ({ lands: [] }), fertilize: async () => 0, fertilizeOne: async () => ({}), NORMAL_FERTILIZER_ID: 1011, ORGANIC_FERTILIZER_ID: 1012 },
      './farm-land-analyzer': { getCurrentPhase: phases => phases.find(phase => phase.current) || phases[0], buildLandMap: () => new Map(), getDisplayLandContext: () => ({ occupiedLandIds: [] }), isOccupiedSlaveLand: () => false },
      './mutation-operation-gate': { guardFarmOperation: fn => fn },
    }[name] || localRequire(name)),
  }, { filename });
  return module.exports;
}

test('first and final fertilizer stages are selected independently', () => {
  const service = loadService();
  const lands = [{
    id: 1,
    unlocked: true,
    plant: {
      id: 10,
      phases: [
        { phase: 1, begin_time: 1000, current: true },
        { phase: 2, begin_time: 1100 },
        { phase: 6, begin_time: 1200 },
      ],
    },
  }, {
    id: 2,
    unlocked: true,
    plant: {
      id: 11,
      phases: [
        { phase: 1, begin_time: 900 },
        { phase: 2, begin_time: 1000, current: true },
        { phase: 6, begin_time: 1200 },
      ],
    },
  }];

  assert.deepEqual(Array.from(service.getFirstStageLands(lands)), [1]);
  assert.deepEqual(Array.from(service.getFinalStageLands(lands)), [2]);
  lands[0].plant.phases[1].current = true;
  lands[0].plant.phases[0].current = false;
  assert.deepEqual(Array.from(service.getFinalStageLands(lands)), [1, 2]);
});

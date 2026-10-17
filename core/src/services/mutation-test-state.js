const fs = require('node:fs');
const { accountFile } = require('./mutation-records');
const { writeJsonFileAtomic } = require('./json-db');

const activeAccounts = new Set();
function setMutationTestActive(accountId, active) {
  if (active) activeAccounts.add(String(accountId));
  else activeAccounts.delete(String(accountId));
}
function conflictingAutomation(automation = {}) {
  return !!(automation.farm || automation.land_upgrade || automation.fertilizer_2x2_ripen || (automation.fertilizer && automation.fertilizer !== 'none'));
}
function assertMutationConfig(accountId, config) {
  if (activeAccounts.has(String(accountId)) && conflictingAutomation(config?.automation)) {
    throw new Error('测变异运行中，请先停止测试再开启种植收获或土地施肥');
  }
}
function readMutationTestState(accountId, offline = false) {
  const filename = accountFile(accountId, 'test.json');
  const state = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {
    status: 'idle', enabled: false, seedId: null, target: 1, delayMs: 200, planted: 0, harvested: 0, round: 0, reason: '',
  };
  if (offline && state.enabled) return { ...state, status: 'stopped', enabled: false, reason: '账号或程序已停止，任务不恢复' };
  return state;
}
function writeMutationTestState(accountId, state) {
  writeJsonFileAtomic(accountFile(accountId, 'test.json'), state);
}
module.exports = { setMutationTestActive, conflictingAutomation, assertMutationConfig, readMutationTestState, writeMutationTestState };

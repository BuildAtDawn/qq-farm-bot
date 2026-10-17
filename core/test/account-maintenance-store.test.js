const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-maintenance-store-'));
process.env.FARM_DATA_DIR = dataDir;
const store = require('../src/models/store');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('new account recovery defaults to 60 seconds and never exposes the old minutes field', () => {
  const config = store.getAutoCodeRefresh('new-account');
  assert.equal(config.offlineDelaySeconds, 60);
  assert.equal('offlineDelayMinutes' in config, false);
});

test('one global policy persists and is shared by existing and future accounts', () => {
  const policy = { enabled: true, intervalMinutes: 45, offlineEnabled: true, offlineDelaySeconds: 25 };
  store.setSystemSettings({ ...store.getSystemSettings(), autoCodeRefresh: policy });
  const config = store.getConfigSnapshot('seconds-account').autoCodeRefresh;
  assert.deepEqual(config, { enabled: true, intervalMinutes: 45, offlineEnabled: true, offlineDelaySeconds: 25 });
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
  assert.deepEqual(persisted.systemSettings.autoCodeRefresh, config);
  assert.deepEqual(store.getAutoCodeRefresh('another-account'), config);
  assert.deepEqual(store.getConfigSnapshot('future-account').autoCodeRefresh, config);
  assert.throws(() => store.setAutoCodeRefresh('seconds-account', { offlineEnabled: false }), /全局设置/);
});

test('legacy account settings and default plans cannot override the shared policy', () => {
  const before = store.getAutoCodeRefresh();
  store.applyConfigSnapshot({ autoCodeRefresh: { offlineEnabled: true, offlineDelayMinutes: 8 } }, { accountId: 'legacy-account' });
  const config = store.getAutoCodeRefresh('legacy-account');
  assert.deepEqual(config, before);
  assert.equal('offlineDelayMinutes' in config, false);
});

test('legacy migration uses only matching WeChat policies and never enables conflicting policies', () => {
  const policy = { enabled: true, intervalMinutes: 45, offlineEnabled: true, offlineDelaySeconds: 25 };
  function reload(configs, globalPolicy) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-keepalive-migration-'));
    try {
      fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts: [
        { id: 'wx1', platform: 'wx' }, { id: 'wx2', platform: 'wx' }, { id: 'qq1', platform: 'qq' },
      ] }));
      fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ accountConfigs: configs,
        systemSettings: { organicFertilizerDelayMinMs: 200, organicFertilizerDelayMaxMs: 300, ...(globalPolicy ? { autoCodeRefresh: globalPolicy } : {}) } }));
      const child = spawnSync(process.execPath, ['-e', `const store = require(${JSON.stringify(require.resolve('../src/models/store'))}); process.stdout.write('POLICY:' + JSON.stringify(store.getAutoCodeRefresh()));`], {
        env: { ...process.env, FARM_DATA_DIR: dir }, encoding: 'utf8',
      });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout.split('POLICY:')[1]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const matching = { wx1: { autoCodeRefresh: policy }, wx2: { autoCodeRefresh: policy }, qq1: { autoCodeRefresh: { enabled: false } } };
  assert.deepEqual(reload(matching), policy);
  const disabled = { enabled: false, intervalMinutes: 60, offlineEnabled: false, offlineDelaySeconds: 60 };
  assert.deepEqual(reload({ ...matching, wx2: { autoCodeRefresh: disabled } }), disabled);
  assert.deepEqual(reload(matching, disabled), disabled);
});

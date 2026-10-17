const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('capture remains opt-in and preserves the saved switch across reloads', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-capture-defaults-'));
  const storePath = require.resolve('../src/models/store');
  const run = script => execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const store = require(${JSON.stringify(storePath)});
    ${script}
  `], { env: { ...process.env, FARM_DATA_DIR: dataDir }, stdio: 'pipe' });
  try {
    run(`
      assert.equal(store.getCaptureConfig().enabled, false);
      store.setCaptureConfig({ enabled: true });
    `);
    run(`
      assert.equal(store.getCaptureConfig().enabled, true);
      store.setCaptureConfig({ enabled: false });
    `);
    run(`assert.equal(store.getCaptureConfig().enabled, false);`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

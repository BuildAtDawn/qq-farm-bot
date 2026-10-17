const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('expired enabled battle flag is persisted off at startup and after running across end', () => {
    for (const startup of [true, false]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-diary-expiry-'));
        try {
            fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ accountConfigs: {
                fixture: { automation: { pet_diary_battle: true } },
            } }));
            const script = `
                const assert = require('node:assert/strict');
                Date.now = () => ${startup ? 1791820800 : 1789005600} * 1000;
                const store = require('./src/models/store');
                Date.now = () => 1791820800 * 1000;
                const changed = store.persistInactiveActivityAutomation();
                ${startup ? '' : "assert.ok(changed.includes('fixture'));"}
                assert.equal(store.getAutomation('fixture').pet_diary_battle, false);
            `;
            execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'),
                env: { ...process.env, FARM_DATA_DIR: dir }, stdio: 'pipe' });
            const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json')));
            assert.equal(saved.accountConfigs.fixture.automation.pet_diary_battle, false);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
});

test('milk tea flags persist off before start, at settlement and after expiry without changing permanent tasks', () => {
    const { WINDOW, AUTO_ACTIONS } = require('../src/services/activity-milk-tea');
    const keys = [...Object.keys(AUTO_ACTIONS), 'mall_coupon_gift_buy'];
    const businessKeys = ['milk_tea_upgrade', 'milk_tea_craft', 'milk_tea_boost', 'milk_tea_hire', 'milk_tea_interact', 'milk_tea_seed_buy'];
    for (const startup of [true, false]) {
        for (const now of [WINDOW.startTime - 1, WINDOW.settleTime, WINDOW.endTime + 1]) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'milk-tea-expiry-'));
            try {
                const automation = { task: true, star_solar_claim: true, task_after_farm: true, ...Object.fromEntries(keys.map(key => [key, true])) };
                fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ accountConfigs: { fixture: { automation } } }));
                const script = `
                    Date.now = () => ${startup ? now : WINDOW.startTime} * 1000;
                    const store = require('./src/models/store');
                    Date.now = () => ${now} * 1000;
                    store.persistInactiveActivityAutomation();
                `;
                execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, FARM_DATA_DIR: dir }, stdio: 'pipe' });
                const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'))).accountConfigs.fixture.automation;
                for (const key of keys) assert.equal(saved[key], now === WINDOW.settleTime && !businessKeys.includes(key), key);
                for (const key of ['task', 'star_solar_claim', 'task_after_farm']) assert.equal(saved[key], true, key);
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        }
    }
});

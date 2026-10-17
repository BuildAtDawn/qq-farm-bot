const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const service = require('../src/services/activity-milk-tea');

const source = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
const block = source.slice(source.indexOf('function getMilkTeaAutoCheckStatus('), source.indexOf('\nfunction syncStatus()'));
function fixture(patch = {}) {
    const context = {
        loginReady: true, friendSyncPaused: false, starActivityClaimRunning: false,
        time: service.WINDOW.startTime, automation: { milk_tea_cashier: true }, tasks: [],
        ...patch,
    };
    context.require = name => name === '../services/activity-milk-tea' ? service : { getServerTimeSec: () => context.time };
    context.getAutomation = () => context.automation;
    context.workerScheduler = { getSnapshot: () => ({ tasks: context.tasks }) };
    vm.createContext(context);
    vm.runInContext(block, context);
    return context;
}

test('milk tea countdown selects the earliest real shared trigger and ignores unrelated/running timers', () => {
    const f = fixture({ tasks: [
        { name: 'star_activity_claim_interval', nextRunAt: 300000 },
        { name: 'star_activity_claim_initial', nextRunAt: 10000 },
        { name: 'star_activity_claim_after_save', nextRunAt: 2000 },
        { name: 'unified_next_tick', nextRunAt: 100 },
        { name: 'pet_diary_treasure_ready', nextRunAt: 500, running: true },
    ] });
    let status = f.getMilkTeaAutoCheckStatus();
    assert.equal(status.state, 'scheduled');
    assert.equal(status.intervalSec, 300);
    assert.equal(status.nextRunAt, 2000);
    assert.equal(status.enabledActionCount, 1);
    f.tasks.shift(); f.tasks.shift(); f.tasks.shift();
    assert.equal(f.getMilkTeaAutoCheckStatus().state, 'idle');
});

test('disabled, upcoming, ended, paused and running states never expose a false countdown', () => {
    for (const [patch, expected] of [
        [{ automation: {} }, 'disabled'],
        [{ time: service.WINDOW.startTime - 1 }, 'upcoming'],
        [{ time: service.WINDOW.endTime + 1 }, 'ended'],
        [{ loginReady: false }, 'paused'],
        [{ friendSyncPaused: true }, 'paused'],
        [{ starActivityClaimRunning: true }, 'running'],
    ]) {
        const status = fixture(patch).getMilkTeaAutoCheckStatus();
        assert.equal(status.state, expected);
        assert.equal(status.nextRunAt, null);
    }
});

test('settlement only counts automation actions that the execution loop permits', () => {
    const f = fixture({ time: service.WINDOW.settleTime, automation: { milk_tea_craft: true } });
    assert.equal(f.getMilkTeaAutoCheckStatus().state, 'disabled');
    f.automation.milk_tea_wages = true;
    assert.equal(f.getMilkTeaAutoCheckStatus().enabledActionCount, 1);
    f.time = service.WINDOW.endTime;
    assert.equal(f.getMilkTeaAutoCheckStatus().state, 'idle');
});

test('status payload includes milk tea under the existing nextChecks contract', () => {
    assert.match(source, /milkTea: getMilkTeaAutoCheckStatus\(\)/);
});

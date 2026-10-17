const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createDataProvider } = require('../src/runtime/data-provider');

function load(relativePath, mocks, globals = {}) {
    const filename = path.join(__dirname, relativePath);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
        require: name => {
            assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
            return mocks[name];
        },
        ...globals,
    }, { filename });
    return module.exports;
}

function fixture(options = {}) {
    const accounts = [
        { id: 'qq1', platform: 'qq', code: 'fixture-qq-code' },
        { id: 'wx1', platform: 'wx', wxid: 'fixture-wx', loginBuffer: 'fixture-buffer' },
        { id: 'wx2', platform: 'wx', code: 'fixture-wx-code' },
        { id: 'wx3', platform: 'wx', wxid: 'fixture-wx-3', loginBuffer: 'fixture-buffer-3' },
    ];
    const starts = [];
    const refreshes = [];
    const scheduled = [];
    const logs = [];
    const store = { getAccounts: () => structuredClone({ accounts }), getSystemConfig: () => null };
    const { createRuntimeEngine } = load('../src/runtime/runtime-engine.js', {
        'node:child_process': {}, 'node:path': path, 'node:process': { env: {} }, 'node:worker_threads': {},
        '../models/store': store,
        '../config/config': {}, '../services/push': {}, '../services/qrlogin': {},
        './auto-code-refresh': { createAutoCodeRefreshService: () => ({
            scheduleAccount: id => scheduled.push(id),
            refreshAccountCode: async (id, reason) => {
                refreshes.push([id, reason]);
                if (id === options.failRefresh) throw new Error('fixture refresh failure');
                return id !== options.fallbackRefresh;
            },
            rescheduleAll: () => scheduled.push('all'),
        }) },
        './data-provider': { createDataProvider },
        './relogin-reminder': { createReloginReminderService: () => ({}) },
        './runtime-state': { createRuntimeState: () => ({
            workers: {}, runtimeEvents: new EventEmitter(), log: (...args) => logs.push(args),
        }) },
        './worker-manager': { createWorkerManager: () => ({
            startWorker: account => {
                starts.push(account.id);
                if (account.id === options.failWorker) throw new Error('fixture worker failure');
            },
        }) },
        './notification-dispatcher': { createNotificationDispatcher: () => ({}) },
        './resource-policy': { resourcePolicy: { workerStartConcurrency: 2, workerStartDelayMs: 0 } },
    }, { setTimeout: callback => { callback(); } });
    return { engine: createRuntimeEngine(), accounts, starts, refreshes, scheduled, logs };
}

async function boot(engine) {
    load('../client.js', {
        'node:process': { env: {}, argv: [], exit: () => assert.fail('bootstrap exited') },
        './src/controllers/admin': {},
        './src/runtime/runtime-engine': { createRuntimeEngine: () => engine },
        './src/services/logger': { createModuleLogger: () => ({ error: () => assert.fail('bootstrap failed') }) },
    });
    await new Promise(resolve => setImmediate(resolve));
}

test('production bootstrap attempts every WeChat account, but leaves QQ accounts stopped', async () => {
    const f = fixture();
    await boot(f.engine);
    assert.deepEqual(f.refreshes, [['wx1', 'startup'], ['wx3', 'startup']]);
    assert.deepEqual(f.starts, ['wx2']);
    assert.deepEqual(f.scheduled, ['wx1', 'wx2', 'wx3', 'all']);
});

test('failed credential refresh falls back to the existing code and continues startup', async () => {
    const f = fixture({ fallbackRefresh: 'wx1' });
    await boot(f.engine);
    assert.deepEqual(f.starts, ['wx1', 'wx2']);
    assert.deepEqual(f.refreshes, [['wx1', 'startup'], ['wx3', 'startup']]);
});

test('one rejected WeChat login cannot prevent subsequent accounts or maintenance scheduling', async () => {
    for (const options of [{ failRefresh: 'wx1' }, { failWorker: 'wx2' }]) {
        const f = fixture(options);
        await boot(f.engine);
        assert.deepEqual(f.refreshes, [['wx1', 'startup'], ['wx3', 'startup']]);
        assert.equal(f.scheduled.at(-1), 'all');
        assert.equal(f.logs.filter(entry => entry[0] === '错误').length, 1);
    }
});

test('explicitly disabled automatic startup does not attempt any accounts', async () => {
    const f = fixture();
    await f.engine.start({ autoStartAccounts: false, autoStartPlatforms: ['wx'] });
    assert.deepEqual(f.starts, []);
    assert.deepEqual(f.refreshes, []);
    assert.deepEqual(f.scheduled, ['all']);
});

test('unfiltered startAllAccounts retains its existing all-platform behavior', async () => {
    const f = fixture();
    await f.engine.startAllAccounts();
    assert.deepEqual(f.starts, ['qq1', 'wx2']);
    assert.deepEqual(f.refreshes, [['wx1', 'startup'], ['wx3', 'startup']]);
});

test('WeChat startup handles an empty account list without launching workers', async () => {
    const f = fixture();
    f.accounts.length = 0;
    await boot(f.engine);
    assert.deepEqual(f.starts, []);
    assert.deepEqual(f.refreshes, []);
    assert.deepEqual(f.scheduled, ['all']);
});

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/services/task.js'), 'utf8');

function task(id, extra = {}) {
  return {
    id, is_unlocked: true, is_claimed: false,
    progress: 1, total_progress: 1, rewards: [],
    ...extra,
  };
}

function fixture(snapshots, onRpc = async () => {}) {
  const calls = [];
  const state = { enabled: true, connected: true };
  const events = new EventEmitter();
  const timers = new Map();
  let reads = 0;
  const codec = {
    create: value => value,
    encode: value => ({ finish: () => value }),
    decode: value => value,
  };
  const mocks = {
    '../models/store': { isAutomationOn: () => state.enabled },
    '../utils/network': {
      isConnected: () => state.connected,
      networkEvents: events,
      sendMsgAsync: async (service, method, request) => {
        calls.push({ service, method, request });
        await onRpc(method, request, state);
        const body = method === 'TaskInfo'
          ? { task_info: snapshots[Math.min(reads++, snapshots.length - 1)] }
          : { items: [] };
        return { body };
      },
    },
    '../utils/proto': { types: new Proxy({}, { get: () => codec }) },
    '../utils/utils': {
      toLong: Number, toNum: value => Number(value) || 0,
      log: () => {}, logWarn: () => {}, sleep: async () => {},
      getServerTimeSec: () => 1791561600,
    },
    './scheduler': {
      createScheduler: () => ({
        setTimeoutTask: (key, delay, callback) => timers.set(key, { delay, callback }),
        clearAll: () => timers.clear(),
      }),
    },
    './stats': { recordOperation: () => {} },
    '../config/gameConfig': { getItemById: () => null },
    './task-friend-interaction': {
      completeDailyFriendInteraction: async (canContinue) => {
        calls.push({ method: 'FriendInteraction' });
        await onRpc('FriendInteraction', {}, state);
        return canContinue();
      },
    },
    './warehouse': { getBag: async () => ({}), getBagItems: () => [] },
  };
  const context = { module: { exports: {} }, require: name => {
    assert.ok(mocks[name], `unexpected dependency: ${name}`);
    return mocks[name];
  } };
  vm.runInNewContext(source, context);
  return {
    ...context.module.exports, calls, state, events, timers,
    ids: () => calls.filter(call => call.method === 'ClaimTaskReward').map(call => call.request.id),
    reads: () => calls.filter(call => call.method === 'TaskInfo').length,
  };
}

test('refreshes after claims and drains newly unlocked tasks in the same scan', async () => {
  const f = fixture([
    { tasks: [task(1)] },
    { tasks: [task(2)] },
    { tasks: [task(3)] },
    { tasks: [] },
  ]);
  await f.checkAndClaimTasks();
  assert.deepEqual(f.ids(), [1, 2, 3]);
  assert.equal(f.reads(), 4);
});

test('active rewards use refreshed eligibility after claiming tasks', async () => {
  const f = fixture([
    { tasks: [task(1)], actives: [{ type: 1, rewards: [{ point_id: 10, status: 1 }] }] },
    { tasks: [], actives: [{ type: 1, rewards: [{ point_id: 10, status: 2 }] }] },
  ]);
  await f.checkAndClaimTasks();
  const active = f.calls.find(call => call.method === 'ClaimDailyReward');
  assert.equal(active.request.type, 1);
  assert.deepEqual(Array.from(active.request.point_ids), [10]);
  assert.equal(f.calls.filter(call => call.method === 'ClaimAllRewardsV2').length, 1);
});

test('deduplicates daily and growth tasks also present in merged fields', async () => {
  const daily = task(1, { task_type: 2 });
  const growth = task(2, { task_type: 1 });
  const f = fixture([{ daily_tasks: [daily], growth_tasks: [growth], tasks: [daily, growth] }]);
  await f.checkAndClaimTasks();
  assert.deepEqual(f.ids(), [1, 2]);
  assert.equal(f.reads(), 2, 'stale snapshots must stop without repeated claims');
});

test('failed claims do not loop and are eligible for a later scan', async () => {
  let fail = true;
  const f = fixture([{ tasks: [task(1)] }], async (method) => {
    if (method === 'ClaimTaskReward' && fail) throw new Error('fixture failure');
  });
  await f.checkAndClaimTasks();
  assert.equal(f.reads(), 1);
  fail = false;
  await f.checkAndClaimTasks();
  assert.deepEqual(f.ids(), [1, 1]);
  assert.equal(f.reads(), 3);
});

test('a failed task is not retried when another successful claim triggers refresh', async () => {
  const f = fixture([
    { tasks: [task(1), task(2)] },
    { tasks: [task(1), task(3)] },
    { tasks: [task(1)] },
  ], async (method, request) => {
    if (method === 'ClaimTaskReward' && request.id === 1) throw new Error('fixture failure');
  });
  await f.checkAndClaimTasks();
  assert.deepEqual(f.ids(), [1, 2, 3]);
});

test('unbounded chains stop after ten claim rounds and still refresh final state', async () => {
  const f = fixture(Array.from({ length: 12 }, (_, i) => ({ tasks: [task(i + 1)] })));
  await f.checkAndClaimTasks();
  assert.deepEqual(f.ids(), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal(f.reads(), 11);
});

test('push notifications fetch current state and use the same refresh loop', async () => {
  const f = fixture([{ tasks: [task(2)] }, { tasks: [task(3)] }, { tasks: [] }]);
  f.initTaskSystem();
  f.events.emit('taskInfoNotify', { tasks: [task(1)] });
  const timer = f.timers.get('task_claim_debounce');
  assert.equal(timer.delay, 5000);
  await timer.callback();
  assert.deepEqual(f.ids(), [2, 3], 'never claim obsolete notification data');
});

test('overlapping startup, push and periodic scans do not run parallel claims', async () => {
  let resolveRead;
  const f = fixture([{ tasks: [task(1)] }, { tasks: [] }], async (method) => {
    if (method === 'TaskInfo' && !resolveRead) {
      await new Promise(resolve => { resolveRead = resolve; });
    }
  });
  f.initTaskSystem();
  const pending = f.checkAndClaimTasks();
  f.events.emit('taskInfoNotify', { tasks: [task(1)] });
  await f.timers.get('task_claim_debounce').callback();
  await f.timers.get('task_init_bootstrap').callback();
  assert.equal(f.reads(), 1);
  resolveRead();
  await pending;
  assert.deepEqual(f.ids(), [1]);
});

test('disabling automation or disconnecting stops remaining claims and refreshes', async () => {
  for (const key of ['enabled', 'connected']) {
    const f = fixture([{ tasks: [task(1), task(2)] }], async (method, request, state) => {
      if (method === 'ClaimTaskReward') state[key] = false;
    });
    await f.checkAndClaimTasks();
    assert.deepEqual(f.ids(), [1]);
    assert.equal(f.reads(), 1);
    assert.equal(f.calls.some(call => call.method === 'ClaimAllRewardsV2'), false);
  }
});

test('cleanup cancels a pending scan without clearing a newer scan guard', async () => {
  const pendingReads = [];
  const f = fixture([{ tasks: [task(1)] }, { tasks: [] }], async (method) => {
    if (method === 'TaskInfo' && pendingReads.length < 2) {
      await new Promise(resolve => pendingReads.push(resolve));
    }
  });
  const oldScan = f.checkAndClaimTasks();
  f.cleanupTaskSystem();
  const newScan = f.checkAndClaimTasks();
  pendingReads[0]();
  await oldScan;
  await f.checkAndClaimTasks();
  assert.equal(f.reads(), 2, 'old completion must not unlock the newer scan');
  assert.deepEqual(f.ids(), []);
  pendingReads[1]();
  await newScan;
});

test('missing task payloads, disabled automation and disconnected accounts do not claim', async () => {
  const empty = fixture([undefined]);
  await empty.checkAndClaimTasks();
  assert.deepEqual(empty.calls.map(call => call.method), ['TaskInfo']);
  for (const key of ['enabled', 'connected']) {
    const f = fixture([{ tasks: [task(1)] }]);
    f.state[key] = false;
    await f.checkAndClaimTasks();
    assert.equal(f.calls.length, 0);
  }
});

test('query errors release the scan guard for later triggers', async () => {
  let fail = true;
  const f = fixture([{ tasks: [] }], async (method) => {
    if (method === 'TaskInfo' && fail) throw new Error('fixture query error');
  });
  await f.checkAndClaimTasks();
  fail = false;
  await f.checkAndClaimTasks();
  assert.equal(f.reads(), 2);
  assert.equal(f.calls.some(call => call.method === 'ClaimAllRewardsV2'), true);
});

test('daily overview exposes normalized descriptions, rewards and all task states without claiming', async () => {
  const f = fixture([{ daily_tasks: [
    task(1, { desc: '收获作物', progress: 2, total_progress: 5, rewards: [{ id: 1001, count: 200 }] }),
    task(2, { desc: '帮助好友' }),
    task(3, { is_claimed: true, progress: 0 }),
    task(4, { is_unlocked: false, progress: 0, total_progress: 0 }),
  ] }]);
  const state = await f.getTaskDailyStateLikeApp();
  assert.equal(state.tasks.length, 4);
  assert.equal(state.tasks[0].desc, '收获作物');
  assert.equal(state.tasks[0].progress, 2);
  assert.equal(state.tasks[0].totalProgress, 5);
  assert.equal(state.tasks[0].rewardSummary, '金币200');
  assert.equal(state.tasks[0].isCompleted, false);
  assert.equal(state.tasks[1].canClaim, true);
  assert.equal(state.tasks[2].isCompleted, true);
  assert.equal(state.tasks[2].isClaimed, true);
  assert.equal(state.tasks[3].isUnlocked, false);
  assert.equal(state.detailError, '');
  assert.deepEqual(f.calls.map(call => call.method), ['TaskInfo']);
});

test('daily details retain merged-field fallback and distinguish read errors from an empty list', async () => {
  const merged = fixture([{ tasks: [task(9, { task_type: 2 }), task(10, { task_type: 1 })] }]);
  assert.deepEqual(Array.from((await merged.getTaskDailyStateLikeApp()).tasks, entry => entry.id), [9]);
  const empty = await fixture([{}]).getTaskDailyStateLikeApp();
  assert.equal(empty.tasks.length, 0);
  assert.equal(empty.detailError, '');
  const failed = await fixture([{}], async () => { throw new Error('fixture failure'); }).getTaskDailyStateLikeApp();
  assert.equal(failed.tasks.length, 0);
  assert.match(failed.detailError, /读取失败/);
});

test('worker daily gift overview forwards task details and query errors', async () => {
  const worker = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
  const overview = worker.slice(worker.indexOf('async function getDailyGiftOverview()'), worker.indexOf('// ==================== 状态同步'));
  const tasks = [{ id: 1, desc: '夹具任务', progress: 1, totalProgress: 3 }];
  const context = {
    getAutomation: () => ({ task: true }),
    getTaskDailyStateLikeApp: async () => ({ tasks, detailError: '夹具错误', totalCount: 1 }),
    getGrowthTaskStateLikeApp: null,
    getEmailDailyState: null,
    getFreeGiftDailyState: null,
    getShareDailyState: null,
    getVipDailyState: null,
    getMonthCardDailyState: null,
  };
  vm.runInNewContext(`${overview}\nthis.overview = getDailyGiftOverview;`, context);
  const gift = (await context.overview()).gifts.find(item => item.key === 'task_claim');
  assert.deepEqual(gift.tasks, tasks);
  assert.equal(gift.detailError, '夹具错误');
});

test('unfinished one-friend daily objective is completed then refreshed and claimed once', async () => {
  const pending = task(21, { desc: '在1个好友农场进行互动', progress: 0 });
  const f = fixture([
    { daily_tasks: [pending] },
    { daily_tasks: [{ ...pending, progress: 1 }] },
    { daily_tasks: [{ ...pending, progress: 0, is_claimed: true }] },
  ]);
  await f.checkAndClaimTasks();
  assert.deepEqual(f.ids(), [21]);
  assert.deepEqual(f.calls.slice(0, 4).map(call => call.method), [
    'TaskInfo', 'FriendInteraction', 'TaskInfo', 'ClaimTaskReward',
  ]);
  assert.equal(f.calls.filter(call => call.method === 'FriendInteraction').length, 1);
});

test('stale interaction progress is not forged and repeated triggers are throttled', async () => {
  const pending = task(21, { desc: '在1个好友农场进行互动', progress: 0 });
  const f = fixture([{ daily_tasks: [pending] }]);
  await f.checkAndClaimTasks();
  await f.checkAndClaimTasks();
  assert.deepEqual(f.ids(), []);
  assert.equal(f.calls.filter(call => call.method === 'FriendInteraction').length, 1);
});

test('completed, claimed, locked, different objectives and readonly overview never interact', async () => {
  for (const extra of [
    { progress: 1 }, { is_claimed: true }, { is_unlocked: false },
    { total_progress: 2 }, { desc: '在1个好友农场收获作物' },
  ]) {
    const f = fixture([{ daily_tasks: [task(21, { desc: '在1个好友农场进行互动', progress: 0, ...extra })] }]);
    await f.checkAndClaimTasks();
    assert.equal(f.calls.some(call => call.method === 'FriendInteraction'), false);
  }
  const readonly = fixture([{ daily_tasks: [task(21, { desc: '在1个好友农场进行互动', progress: 0 })] }]);
  await readonly.getTaskDailyStateLikeApp();
  assert.equal(readonly.calls.some(call => call.method === 'FriendInteraction'), false);
});

test('turning task automation off during interaction prevents refresh and reward mutations', async () => {
  const f = fixture([{ daily_tasks: [task(21, { desc: '在1个好友农场进行互动', progress: 0 })] }], async (method, _request, state) => {
    if (method === 'FriendInteraction') state.enabled = false;
  });
  await f.checkAndClaimTasks();
  assert.deepEqual(f.calls.map(call => call.method), ['TaskInfo', 'FriendInteraction']);
});

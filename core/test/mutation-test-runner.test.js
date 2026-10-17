const assert = require('node:assert/strict');
const test = require('node:test');
const { createMutationTestRunner, validateTestConfig } = require('../src/services/mutation-test-runner');
const { createOperationGate } = require('../src/services/mutation-operation-gate');
const { setMutationTestActive, assertMutationConfig } = require('../src/services/mutation-test-state');

function fixture(options = {}) {
  const calls = [];
  let count = options.count ?? 100;
  let round = 0;
  let connected = true;
  const state = Array.from({ length: options.landCount || 3 }, (_, i) => ({
    id: i + 1, unlocked: true, state: 'empty', identity: '',
  }));
  const gate = createOperationGate();
  const deps = {
    gate, initial: { enabled: false, status: 'idle' },
    save: value => { calls.push(['save', { ...value }]); },
    automation: () => ({ farm: false, fertilizer: 'none', land_upgrade: false }),
    connected: () => connected,
    lands: async () => state.map(land => ({ ...land })),
    seeds: async () => [{ seedId: 1, count, name: '测试种子', supported: true }],
    plant: async (seedId, landId, metadata) => {
      calls.push(['plant', landId, metadata]);
      count--;
      if (landId === 1) round++;
      Object.assign(state[landId - 1], { state: 'growing', identity: `${landId}:${round}`, matureAt: 30, normalRemaining: 1 });
      await options.onPlant?.(landId);
      return { ...state[landId - 1] };
    },
    fertilize: async (landId, kind) => {
      calls.push([kind, landId]);
      await options.onFertilize?.(landId, kind);
      const land = state[landId - 1];
      if (!options.stalled) land.matureAt -= 10;
      if (land.matureAt <= 0) land.state = 'mature';
    },
    farming: async ids => { calls.push(['farming', ids]); },
    harvest: async ids => {
      calls.push(['harvest', ids]);
      for (const id of ids) state[id - 1].state = 'dead';
      await options.onHarvest?.();
    },
    remove: async ids => {
      calls.push(['remove', ids]);
      for (const id of ids) Object.assign(state[id - 1], { state: 'empty', identity: '' });
    },
    sleep: async ms => { calls.push(['sleep', ms]); await options.onSleep?.(); },
    ...options.deps,
  };
  const runner = createMutationTestRunner(deps);
  return { runner, calls, gate, lands: state, disconnect: () => { connected = false; } };
}
const config = { seedId: 1, target: 5, delayMs: 200 };

test('single-cell seed counts: final partial round is harvested; normal pass precedes all organic passes', async () => {
  const f = fixture();
  await f.runner.start(config);
  await f.runner.settled();
  assert.equal(f.runner.snapshot().status, 'completed');
  assert.equal(f.runner.snapshot().planted, 5);
  assert.equal(f.runner.snapshot().harvested, 5);
  assert.deepEqual(f.calls.filter(([type]) => type === 'plant').map(call => call[1]), [1, 2, 3, 1, 2]);
  assert.deepEqual(f.calls.filter(([type]) => ['normal', 'organic'].includes(type)).slice(0, 9), [
    ['normal', 1], ['normal', 2], ['normal', 3],
    ['organic', 1], ['organic', 2], ['organic', 3],
    ['organic', 1], ['organic', 2], ['organic', 3],
  ]);
  assert.deepEqual(f.calls.filter(([type]) => type === 'harvest').map(call => call[1]), [[1, 2, 3], [1, 2]]);
  assert.ok(f.lands.every(land => land.state === 'empty'));
  assert.equal(f.gate.isActive(), false);
});

test('18 lands, 100 seeds ends with ten plants and harvests exactly 100', async () => {
  const f = fixture({ landCount: 18 });
  await f.runner.start({ ...config, target: 100 });
  await f.runner.settled();
  assert.equal(f.runner.snapshot().round, 6);
  assert.equal(f.runner.snapshot().harvested, 100);
  assert.equal(f.calls.filter(call => call[0] === 'harvest').at(-1)[1].length, 10);
});

test('validation rejects occupied/unknown land, shortages, unsupported seeds, offline and conflicting automation', async () => {
  for (const overrides of [
    { lands: async () => [{ id: 1, unlocked: true, state: 'growing' }] },
    { lands: async () => [{ id: 1, unlocked: true, state: 'unknown' }] },
    { seeds: async () => [{ seedId: 1, supported: false, count: 100 }] },
    { seeds: async () => [{ seedId: 1, supported: true, count: 4 }] },
    { connected: () => false },
    { automation: () => ({ farm: true }) },
    { automation: () => ({ fertilizer: 'normal' }) },
    { automation: () => ({ land_upgrade: true }) },
  ]) {
    const f = fixture({ deps: overrides });
    await assert.rejects(f.runner.start(config));
    assert.equal(f.calls.some(call => call[0] === 'plant'), false);
    assert.equal(f.runner.snapshot().enabled, false);
    assert.equal(f.gate.isActive(), false);
  }
});

test('input bounds and defaults', () => {
  assert.equal(validateTestConfig({ seedId: 1, target: 3000 }).delayMs, 200);
  for (const target of [0, 3001, 1.5, Number.NaN]) assert.throws(() => validateTestConfig({ seedId: 1, target }));
  for (const delayMs of [-1, 60001, 0.1, Infinity]) assert.throws(() => validateTestConfig({ ...config, delayMs }));
});

test('stop during planting settles that response, never fertilizes or resumes', async () => {
  const f = fixture({ onPlant: async () => { f.runner.stop(); } });
  await f.runner.start(config);
  await f.runner.settled();
  assert.equal(f.runner.snapshot().status, 'stopped');
  assert.equal(f.runner.snapshot().planted, 1);
  assert.equal(f.calls.some(call => ['normal', 'organic', 'harvest'].includes(call[0])), false);
  await assert.rejects(f.runner.start(config), /没有作物/);
});

test('stop during harvesting accounts for the confirmed harvest but sends no cleanup/next planting', async () => {
  const f = fixture({ onHarvest: async () => { f.runner.stop(); } });
  await f.runner.start(config);
  await f.runner.settled();
  assert.equal(f.runner.snapshot().harvested, 3);
  assert.equal(f.runner.snapshot().status, 'stopped');
  assert.equal(f.calls.some(call => call[0] === 'remove'), false);
});

test('fertilizer failure, stalling, disconnect and unexpected land replacements terminate without buying or retrying', async () => {
  const f = fixture({ onFertilize: async () => { throw new Error('肥料不足'); } });
  await f.runner.start(config);
  await f.runner.settled();
  assert.equal(f.runner.snapshot().reason, '肥料不足');
  assert.equal(f.calls.filter(call => call[0] === 'normal').length, 1);
  const stalled = fixture({ stalled: true });
  await stalled.runner.start(config);
  await stalled.runner.settled();
  assert.match(stalled.runner.snapshot().reason, /未推进生长/);
  const disconnected = fixture({ onSleep: async () => disconnected.disconnect() });
  await disconnected.runner.start(config);
  await disconnected.runner.settled();
  assert.match(disconnected.runner.snapshot().reason, /断线/);
  const replaced = fixture({ onSleep: async () => { replaced.lands[0].identity = 'external'; } });
  await replaced.runner.start(config);
  await replaced.runner.settled();
  assert.match(replaced.runner.snapshot().reason, /不一致/);
});

test('prior enabled state is stopped at initialization without work', () => {
  const f = fixture({ deps: { initial: { enabled: true, status: 'running', planted: 12, target: 50 } } });
  assert.equal(f.runner.snapshot().status, 'stopped');
  assert.equal(f.runner.snapshot().enabled, false);
  assert.equal(f.runner.snapshot().planted, 12);
  assert.equal(f.calls.some(call => call[0] === 'plant'), false);
});

test('gate rejects simultaneous starts and unrelated farm mutations but admits its own task', async () => {
  const gate = createOperationGate();
  const token = gate.acquire();
  assert.throws(() => gate.acquire(), /土地操作/);
  await assert.rejects(gate.operation(async () => {}), /测变异运行中/);
  assert.equal(await gate.run(token, () => gate.operation(async () => 42)), 42);
  gate.release(token);
  let release;
  const pending = gate.operation(() => new Promise(resolve => { release = resolve; }));
  assert.throws(() => gate.acquire(), /土地操作/);
  release();
  await pending;
  gate.release(gate.acquire());
});

test('configuration guard rejects conflicting toggles and permits unrelated settings', () => {
  setMutationTestActive('a', true);
  assert.throws(() => assertMutationConfig('a', { automation: { farm: true } }), /测变异运行中/);
  assert.throws(() => assertMutationConfig('a', { automation: { fertilizer: 'organic' } }), /测变异运行中/);
  assertMutationConfig('a', { automation: { friend: true, fertilizer: 'none' } });
  assertMutationConfig('b', { automation: { farm: true } });
  setMutationTestActive('a', false);
  assertMutationConfig('a', { automation: { farm: true } });
});

test('record-write failure after confirmed planting counts that seed and prevents fertilizer', async () => {
  const f = fixture({ deps: { plant: async () => {
    const error = new Error('磁盘写入失败');
    error.planted = true;
    throw error;
  } } });
  await f.runner.start(config);
  await f.runner.settled();
  assert.equal(f.runner.snapshot().planted, 1);
  assert.equal(f.runner.snapshot().status, 'failed');
  assert.equal(f.calls.some(call => call[0] === 'normal'), false);
  assert.equal(f.gate.isActive(), false);
});

test('failure to persist task progress still releases gate and reports a terminal in-memory state', async () => {
  const f = fixture({ deps: { save: state => {
    if (state.planted) throw new Error('磁盘已满');
  } } });
  await f.runner.start(config);
  await f.runner.settled();
  assert.equal(f.runner.snapshot().status, 'failed');
  assert.equal(f.runner.snapshot().enabled, false);
  assert.equal(f.gate.isActive(), false);
  assert.equal(f.calls.some(call => call[0] === 'normal'), false);
});

test('already mature plots are skipped in later passes and zero remaining normal applications are skipped', async () => {
  const f = fixture({ onPlant: async id => {
    f.lands[id - 1].normalRemaining = 0;
    if (id === 1) f.lands[0].state = 'mature';
  } });
  await f.runner.start({ ...config, target: 3 });
  await f.runner.settled();
  assert.equal(f.runner.snapshot().status, 'completed');
  assert.equal(f.calls.some(call => call[0] === 'normal'), false);
  assert.equal(f.calls.some(call => call[0] === 'organic' && call[1] === 1), false);
});

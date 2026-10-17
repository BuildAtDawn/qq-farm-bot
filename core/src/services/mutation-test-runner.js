const { randomUUID } = require('node:crypto');
const { conflictingAutomation } = require('./mutation-test-state');

function validateTestConfig(input = {}) {
  const seedId = Number(input.seedId);
  const target = Number(input.target);
  const delayMs = input.delayMs === undefined ? 200 : Number(input.delayMs);
  if (!Number.isSafeInteger(seedId) || seedId <= 0) throw new Error('请选择背包种子');
  if (!Number.isInteger(target) || target < 1 || target > 3000) throw new Error('目标测试次数必须为 1-3000 的整数');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new Error('土地间隔必须为 0-60000 毫秒的整数');
  return { seedId, target, delayMs };
}

function createMutationTestRunner(deps) {
  let state = { ...deps.initial, enabled: false };
  if (deps.initial?.enabled) {
    state = { ...state, status: 'stopped', reason: '账号或程序已停止，任务不恢复' };
    deps.save(state);
  }
  let current = null;
  let completion = Promise.resolve();
  const snapshot = () => ({ ...state });
  function publish(patch) {
    state = { ...state, ...patch, updatedAt: Date.now() };
    deps.save(snapshot());
  }
  function check(run) {
    if (run.cancelled) throw new Error(run.reason || '已手动停止');
    if (!deps.connected()) throw new Error('账号已断线');
    if (conflictingAutomation(deps.automation())) throw new Error('种植收获或土地施肥已开启');
  }
  async function delay(run) {
    check(run);
    if (deps.sleep) await deps.sleep(state.delayMs);
    else await new Promise(resolve => {
      const timer = setTimeout(() => { run.wake = null; resolve(); }, state.delayMs);
      run.wake = () => { clearTimeout(timer); run.wake = null; resolve(); };
    });
    check(run);
  }
  async function lands(run) {
    check(run);
    const result = await deps.lands();
    check(run);
    if (!Array.isArray(result) || !result.length) throw new Error('无法读取土地');
    return result;
  }
  async function execute(run, initialLands) {
    let currentLands = initialLands;
    while (state.planted < state.target) {
      check(run);
      if (currentLands.some(land => land.unlocked && land.state !== 'empty')) throw new Error('已解锁土地存在作物，测试已停止');
      const bag = await deps.seeds();
      check(run);
      const remaining = state.target - state.planted;
      const seed = bag.find(item => item.seedId === state.seedId && item.supported);
      if (!seed || seed.count < remaining) throw new Error('背包种子不足，测试已停止');
      const targets = currentLands.filter(land => land.unlocked).sort((a, b) => a.id - b.id).slice(0, remaining);
      if (!targets.length) throw new Error('没有可种植土地');
      publish({ round: state.round + 1, phase: 'planting' });
      const expected = new Map();
      for (let index = 0; index < targets.length; index++) {
        check(run);
        let planted;
        try {
          planted = await deps.plant(state.seedId, targets[index].id, { testId: state.id, round: state.round });
        } catch (error) {
          if (error.planted) publish({ planted: state.planted + 1 });
          throw error;
        }
        publish({ planted: state.planted + 1 });
        if (!planted?.identity) throw new Error('无法确认已种植作物');
        expected.set(targets[index].id, planted);
        if (index < targets.length - 1) await delay(run);
      }
      const verify = values => {
        const found = new Set();
        for (const land of values.filter(item => item.unlocked)) {
          if (expected.has(land.id)) {
            const previous = expected.get(land.id);
            if (previous.identity !== land.identity || !['growing', 'mature'].includes(land.state)
              || (land.phaseCount && previous.phaseCount && land.phaseCount > previous.phaseCount)
              || (land.phaseCount === previous.phaseCount && land.phaseBegin > previous.phaseBegin)) {
              throw new Error(`土地 ${land.id} 作物与测试记录不一致`);
            }
            expected.set(land.id, land);
            found.add(land.id);
          } else if (land.state !== 'empty') throw new Error(`土地 ${land.id} 出现其他作物`);
        }
        if (found.size !== expected.size) throw new Error('测试土地状态不完整');
        return values.filter(land => expected.has(land.id)).sort((a, b) => a.id - b.id);
      };
      let growing = verify(await lands(run));
      async function fertilizePass(kind) {
        const targets = growing.filter(land => land.state !== 'mature' && (kind !== 'normal' || land.normalRemaining !== 0));
        for (let index = 0; index < targets.length; index++) {
          growing = verify(await lands(run));
          const latest = growing.find(land => land.id === targets[index].id);
          check(run);
          if (latest.state !== 'mature' && (kind !== 'normal' || latest.normalRemaining !== 0)) {
            await deps.fertilize(latest.id, kind);
          }
          if (index < targets.length - 1) await delay(run);
        }
        growing = verify(await lands(run));
      }
      publish({ phase: 'normal' });
      await fertilizePass('normal');
      let stalled = 0;
      let passes = 0;
      while (growing.some(land => land.state !== 'mature')) {
        if (++passes > 1000) throw new Error('有机肥轮数异常，测试已停止');
        publish({ phase: 'organic', fertilizerRound: passes });
        const before = JSON.stringify(growing.map(land => [land.id, land.state, land.matureAt]));
        await fertilizePass('organic');
        const after = JSON.stringify(growing.map(land => [land.id, land.state, land.matureAt]));
        stalled = before === after ? stalled + 1 : 0;
        if (stalled >= 3) throw new Error('施肥未推进生长，测试已停止');
      }
      publish({ phase: 'harvesting' });
      check(run);
      await deps.farming([...expected.keys()]);
      // Farming can change the authoritative snapshot; validate before harvesting.
      verify(await lands(run));
      check(run);
      await deps.harvest([...expected.keys()]);
      publish({ harvested: state.harvested + expected.size });
      check(run);
      currentLands = await lands(run);
      const dead = currentLands.filter(land => expected.has(land.id) && land.state === 'dead');
      if (currentLands.some(land => expected.has(land.id) && !['dead', 'empty'].includes(land.state))) {
        throw new Error('收获后土地未清空，测试已停止');
      }
      if (dead.length) {
        check(run);
        await deps.remove(dead.map(land => land.id));
        currentLands = await lands(run);
      }
      if (currentLands.some(land => land.unlocked && land.state !== 'empty')) throw new Error('收获清理后仍有作物');
    }
  }
  function finish(run, status, reason) {
    try { publish({ status, enabled: false, phase: '', reason, endedAt: Date.now() }); }
    finally {
      deps.gate.release(run.token);
      current = null;
      deps.onEnd?.(snapshot());
    }
  }
  return {
    snapshot,
    async start(input) {
      if (current) throw new Error('测变异任务仍在运行或停止中');
      const config = validateTestConfig(input);
      const run = { token: deps.gate.acquire(), cancelled: false, wake: null };
      current = run;
      try {
        publish({ ...config, id: randomUUID(), status: 'starting', enabled: true, phase: 'checking',
          planted: 0, harvested: 0, round: 0, fertilizerRound: 0, reason: '', startedAt: Date.now(), endedAt: null });
        const initial = await lands(run);
        if (!initial.some(land => land.unlocked)) throw new Error('没有已解锁土地');
        if (initial.some(land => land.unlocked && land.state !== 'empty')) throw new Error('开启前所有已解锁土地必须没有作物');
        const seeds = await deps.seeds();
        check(run);
        const seed = seeds.find(item => item.seedId === config.seedId);
        if (!seed?.supported) throw new Error('仅支持背包中可种植的单格单季种子');
        if (seed.count < config.target) throw new Error('目标测试次数不能超过背包种子数量');
        publish({ status: 'running', seedName: seed.name });
        completion = deps.gate.run(run.token, async () => {
          try {
            await execute(run, initial);
            check(run);
            finish(run, 'completed', '');
          } catch (error) {
            finish(run, run.cancelled ? 'stopped' : 'failed', error.message);
          }
        }).catch(error => { deps.onError?.(error); });
        return snapshot();
      } catch (error) {
        finish(run, run.cancelled ? 'stopped' : 'failed', error.message);
        throw error;
      }
    },
    stop(reason = '已手动停止') {
      if (current) {
        current.cancelled = true;
        current.token.cancelled = true;
        current.reason = reason;
        current.wake?.();
        publish({ status: 'stopping', reason });
      }
      return snapshot();
    },
    settled: () => completion,
  };
}

module.exports = { validateTestConfig, createMutationTestRunner };

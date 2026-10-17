const { AsyncLocalStorage } = require('node:async_hooks');

function createOperationGate() {
  const context = new AsyncLocalStorage();
  let owner = null;
  let operations = 0;
  function assertAllowed() {
    if (owner && context.getStore() !== owner) throw new Error('测变异运行中，不能执行其他土地操作');
    if (owner?.cancelled) throw new Error('测变异已停止');
  }
  return {
    acquire() {
      if (owner || operations) throw new Error('土地操作正在执行，请稍后开启测变异');
      owner = {};
      return owner;
    },
    release(token) { if (owner === token) owner = null; },
    run(token, fn) { return context.run(token, fn); },
    assertAllowed,
    async operation(fn) {
      assertAllowed();
      operations++;
      try { return await fn(); }
      finally { operations--; }
    },
    isActive: () => !!owner,
  };
}

const farmOperationGate = createOperationGate();
const guardFarmOperation = fn => (...args) => farmOperationGate.operation(() => fn(...args));
module.exports = { createOperationGate, farmOperationGate, guardFarmOperation };

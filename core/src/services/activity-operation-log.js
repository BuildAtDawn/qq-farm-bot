// Log completed business actions without serializing requests, account data or replies.
function withActivityOperationLog(operation, labelFor, log = require('../utils/utils').log) {
  return async (...args) => {
    const label = typeof labelFor === 'function' ? labelFor(...args) : labelFor;
    const meta = { module: 'activity', event: label };
    try {
      const result = await operation(...args);
      const skipped = result?.claimed === false || result?.skipped === true;
      log('活动', `${label}${skipped ? '跳过：暂无可执行操作' : '完成'}`, { ...meta, result: skipped ? 'skip' : 'success' });
      return result;
    } catch (error) {
      log('活动', `${label}失败：${error.message}`, { ...meta, result: 'error' });
      error.activityOperationLogged = true;
      throw error;
    }
  };
}
module.exports = { withActivityOperationLog };

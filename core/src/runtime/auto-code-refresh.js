const { createScheduler } = require('../services/scheduler');
const { normalizeAutoCodeRefresh } = require('../config/account-maintenance');
const wxLoginAdapter = require('../services/wx-login-adapter');

function createAutoCodeRefreshService(deps) {
  const { store, getAccounts, addOrUpdateAccount, resolveWorkerControls, log, addAccountLog } = deps;
  const scheduler = deps.scheduler || createScheduler('auto_code_refresh');
  const now = deps.now || Date.now;
  const recoveryState = new Map();
  const pending = new Map();
  const inFlight = new Map();
  const inFlightVersions = new Map();
  const versions = new Map();
  const loginChecks = new Map();
  const notified = new Set();
  const manuallyStopped = new Set();
  const MAX_DAILY_RECOVERIES = 8;
  const MAX_CONSECUTIVE_FAILURES = 3;
  const running = id => typeof deps.isAccountRunning === 'function' ? deps.isAccountRunning(id) : true;
  const connected = id => typeof deps.isAccountConnected === 'function' ? deps.isAccountConnected(id) : false;
  const cfg = () => normalizeAutoCodeRefresh(store.getAutoCodeRefresh?.());
  const findAccount = id => (getAccounts().accounts || []).find(account => String(account.id) === String(id));
  const eligible = account => account?.platform === 'wx' && !!account.wxid && !!account.loginBuffer;
  const version = id => versions.get(String(id)) || 0;

  function getRecoveryState(accountId) {
    const date = new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    const current = recoveryState.get(String(accountId));
    if (current?.date === date) return current;
    const fresh = { date, attempts: 0, failures: 0 };
    recoveryState.set(String(accountId), fresh);
    return fresh;
  }

  function blocked(id) {
    const recovery = getRecoveryState(id);
    return recovery.attempts >= MAX_DAILY_RECOVERIES || recovery.failures >= MAX_CONSECUTIVE_FAILURES;
  }

  async function requestFarmCode(account) {
    if (!eligible(account)) throw new Error('账号缺少微信登录凭据，请重新扫码登录');
    const local = await wxLoginAdapter.getFarmCode(account.wxid, { accountId: account.id });
    if (local.Success && local.Data?.code) return String(local.Data.code);
    throw new Error(local.Message || '进程内获取 Code 失败');
  }

  async function refreshAccountCode(accountId, reason = 'timer') {
    const id = String(accountId);
    if (inFlight.has(id)) return inFlight.get(id);
    const task = (async () => {
      const account = findAccount(id);
      if (!eligible(account)) return false;
      const recoveryReason = !['timer', 'manual', 'manual_start', 'startup'].includes(reason);
      if (recoveryReason && (!cfg(id).offlineEnabled || connected(id) || blocked(id))) return false;
      if (reason === 'timer' && (!cfg(id).enabled || !running(id) || !connected(id))) return false;
      const recovery = recoveryReason ? getRecoveryState(id) : null;
      const startedVersion = version(id);
      if (recovery) recovery.attempts += 1;
      try {
        const code = await (deps.requestFarmCode || requestFarmCode)(account);
        const latest = findAccount(id);
        if (!latest || version(id) !== startedVersion
          || (recoveryReason && (!cfg(id).offlineEnabled || connected(id)))
          || (reason === 'timer' && (!running(id) || !cfg(id).enabled || !connected(id)))) return false;
        const nextAccount = { ...latest, code };
        addOrUpdateAccount(nextAccount);
        const controls = resolveWorkerControls?.() || {};
        if (typeof controls.restartWorker !== 'function' || controls.restartWorker(nextAccount, {
          manual: ['manual', 'manual_start', 'startup'].includes(reason),
        }) === false) {
          throw new Error('账号启动失败');
        }
        if (['manual', 'manual_start'].includes(reason)) {
          const state = getRecoveryState(id);
          state.attempts = 0;
          state.failures = 0;
        }
        addAccountLog('auto_code_refresh', `自动刷新 Code 成功，已重启账号: ${account.name}`, id, account.name, { reason });
        log('系统', `自动刷新 Code 成功: ${account.name}`, { accountId: id, accountName: account.name });
        return true;
      } catch (error) {
        if (recovery) recovery.failures += 1;
        addAccountLog('auto_code_refresh_failed', `自动刷新 Code 失败: ${error.message}`, id, account.name, { reason });
        log('错误', `自动刷新 Code 失败: ${account.name} - ${error.message}`, { accountId: id, accountName: account.name });
        const invalidCredential = /重新扫码|凭证.*(?:失效|过期)|token.*(?:expired|invalid)/i.test(error.message);
        if (recovery && invalidCredential) recovery.failures = MAX_CONSECUTIVE_FAILURES;
        return false;
      }
    })();
    inFlight.set(id, task);
    inFlightVersions.set(id, version(id));
    try { return await task; } finally { inFlight.delete(id); inFlightVersions.delete(id); }
  }

  function getAccountLoginState(accountId) {
    const id = String(accountId);
    if (inFlight.has(id) && inFlightVersions.get(id) === version(id)) {
      return { runtimeState: 'logging_in', reloginAt: null };
    }
    if (connected(id)) return null;
    const item = pending.get(id);
    if (item && item.version === version(id) && cfg(id).offlineEnabled) {
      return { runtimeState: 'relogin_waiting', reloginAt: item.dueAt };
    }
    if (loginChecks.has(id) && cfg(id).offlineEnabled) {
      return { runtimeState: 'logging_in', reloginAt: null };
    }
    return null;
  }

  function cancelRelogin(accountId) {
    const id = String(accountId);
    pending.delete(id);
    scheduler.clear(`relogin_${id}`);
    if (connected(id)) {
      loginChecks.delete(id);
      scheduler.clear(`login_check_${id}`);
      notified.delete(id);
      getRecoveryState(id).failures = 0;
    }
  }

  async function notifyFailure(id, item) {
    if (connected(id) || version(id) !== item.version || notified.has(id)) return;
    const account = findAccount(id);
    if (!account) return;
    notified.add(id);
    await deps.triggerOfflineReminder?.({ accountId: id, accountName: account.name,
      reason: `掉线重登失败：${item.reason}`, offlineMs: Math.max(0, now() - item.disconnectedAt) });
  }

  function scheduleRelogin(accountId, reason = 'offline', disconnectedAt = now()) {
    const id = String(accountId);
    if (!cfg(id).offlineEnabled || !eligible(findAccount(id)) || connected(id)) return false;
    if (pending.has(id) || loginChecks.has(id) || inFlight.has(id)) return true;
    if (blocked(id)) return notified.has(id);
    const dueAt = disconnectedAt + cfg(id).offlineDelaySeconds * 1000;
    const item = { reason, disconnectedAt, dueAt, version: version(id) };
    pending.set(id, item);
    scheduler.setTimeoutTask(`relogin_${id}`, Math.max(1000, dueAt - now()), async () => {
      if (pending.get(id) !== item) return;
      pending.delete(id);
      if (!cfg(id).offlineEnabled || connected(id)) return;
      const ok = await refreshAccountCode(id, reason);
      if (version(id) !== item.version || !findAccount(id) || !cfg(id).offlineEnabled || connected(id)) return;
      if (!ok) {
        await notifyFailure(id, item);
        if (!blocked(id)) scheduleRelogin(id, reason);
        return;
      }
      // A fresh Code and a started Worker do not confirm a successful farm login.
      loginChecks.set(id, item);
      scheduler.setTimeoutTask(`login_check_${id}`, 60000, async () => {
        if (loginChecks.get(id) !== item) return;
        loginChecks.delete(id);
        if (connected(id) || version(id) !== item.version || !cfg(id).offlineEnabled) return;
        const recovery = getRecoveryState(id);
        recovery.failures += 1;
        await notifyFailure(id, item);
        if (!blocked(id)) scheduleRelogin(id, reason);
      });
    });
    const account = findAccount(id);
    log('系统', `账号 ${account.name} 将在 ${Math.max(0, Math.ceil((dueAt - now()) / 1000))} 秒后自动刷新凭证并重登`, {
      accountId: id, accountName: account.name, reason,
    });
    return true;
  }

  function scheduleAccount(accountId, { preserveStopped = false } = {}) {
    const id = String(accountId);
    if (preserveStopped && manuallyStopped.has(id)) return;
    manuallyStopped.delete(id);
    const config = cfg(id);
    scheduler.clear(`refresh_${id}`);
    scheduler.clear(`wx_keepalive_${id}`);
    if (!config.offlineEnabled) {
      cancelRelogin(id);
      loginChecks.delete(id);
      scheduler.clear(`login_check_${id}`);
    }
    else if (pending.has(id)) {
      const item = pending.get(id);
      cancelRelogin(id);
      scheduleRelogin(id, item.reason, item.disconnectedAt);
    }
    const account = findAccount(id);
    if (!account || account.platform !== 'wx') return;
    if (!account.wxid) {
      log('系统', '自动刷新 Code 未启动: 账号缺少 wxid', { accountId: id, accountName: account.name });
      return;
    }
    if (account.loginBuffer && account.refreshtoken) {
      scheduler.setIntervalTask(`wx_keepalive_${id}`, 60000, async () => {
        if (inFlight.has(id)) return;
        const latest = findAccount(id);
        if (!latest) return;
        const result = await wxLoginAdapter.keepWxCredentialAlive(latest, { onlyIfDue: true });
        if (!result.Success) log('错误', `微信凭证保活失败: ${latest.name}`, { accountId: id });
      }, { preventOverlap: true, runImmediately: true });
    }
    if (config.enabled) scheduler.setIntervalTask(`refresh_${id}`, config.intervalMinutes * 60000,
      () => refreshAccountCode(id, 'timer'), { preventOverlap: true });
  }

  function stopAccount(accountId) {
    const id = String(accountId);
    manuallyStopped.add(id);
    versions.set(id, version(id) + 1);
    cancelRelogin(id);
    loginChecks.delete(id);
    scheduler.clear(`login_check_${id}`);
    notified.delete(id);
    scheduler.clear(`refresh_${id}`);
    scheduler.clear(`wx_keepalive_${id}`);
  }

  return {
    refreshAccountCode, scheduleAccount, stopAccount, scheduleRelogin, cancelRelogin, getAccountLoginState,
    rescheduleAll: () => { for (const account of getAccounts().accounts || []) scheduleAccount(account.id, { preserveStopped: true }); },
    dispose: () => { for (const account of getAccounts().accounts || []) stopAccount(account.id); scheduler.dispose(); },
  };
}

module.exports = { createAutoCodeRefreshService };

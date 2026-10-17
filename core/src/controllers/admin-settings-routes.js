const { validateNotificationTemplates, sampleCropNotification } = require('../services/notification-templates');
const { enabledNotificationChannels, sendNotificationChannels } = require('../services/notification-channels');

function requireAccountAccess(req, res, { getAccountIdFromRequest, canAccessAccount }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({ ok: false, error: "Missing x-account-id" });
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

function getOfflineReminderConfig(store, currentUser, body) {
  const saved =
    store.getOfflineReminder && currentUser
      ? store.getOfflineReminder(currentUser.username)
      : {};
  return { ...(saved || {}), ...(body || {}) };
}

async function sendOfflineReminderTest(config, accountName = '测试账号', event = 'account_offline', systemSettings) {
  config = { ...config, notificationEvent: event,
    notificationUrl: event === 'friend_crop_mature' ? require('../config/system-settings').getMaturityReminderUrl(systemSettings) : undefined };
  if (event !== 'account_offline') {
    return sendNotificationChannels(config, sampleCropNotification(event, config.templates), undefined, enabledNotificationChannels(config, event));
  }
  const { buildOfflineNotification, sendOfflineNotifications } = require('../services/offline-notification');
  return sendOfflineNotifications(config, buildOfflineNotification(config, { accountName, test: true }));
}

function buildSettingsPayload(store, accountId, currentUser) {
  const accountConfig = accountId && typeof store.getConfigSnapshot === "function"
    ? store.getConfigSnapshot(accountId)
    : {};
  const offlineReminderDefault = {
    smtpHost: "",
    smtpPort: 465,
    smtpUser: "",
    smtpPass: "",
    senderName: "",
    recipientEmail: "",
    emailContent: "",
  };

  return {
    friendMonitor: accountConfig.friendMonitor || require('../config/account-maintenance').normalizeFriendMonitor(),
    intervals: accountId ? store.getIntervals(accountId) : {},
    plantingStrategy: accountId ? store.getPlantingStrategy(accountId) : null,
    prioritizeGrowthTasks: accountId ? store.getPrioritizeGrowthTasks(accountId) : false,
    onlyPlant2x2: accountId && typeof store.getOnlyPlant2x2 === 'function'
      ? store.getOnlyPlant2x2(accountId) : false,
    prioritize2x2Crops:
      accountId && typeof store.getPrioritize2x2Crops === "function"
        ? store.getPrioritize2x2Crops(accountId)
        : true,
    friendQuietHours: accountId ? store.getFriendQuietHours(accountId) : null,
    automation: accountId ? store.getAutomation(accountId) : {},
    autoCodeRefresh:
      accountId && typeof store.getAutoCodeRefresh === "function"
        ? store.getAutoCodeRefresh(accountId)
        : { enabled: false, intervalMinutes: 60 },
    fertilizerBuyOrganicCount:
      accountId && typeof store.getFertilizerBuyOrganicCount === "function"
        ? store.getFertilizerBuyOrganicCount(accountId)
        : 0,
    fertilizerBuyOrganicThresholdHours:
      accountId &&
      typeof store.getFertilizerBuyOrganicThresholdHours === "function"
        ? store.getFertilizerBuyOrganicThresholdHours(accountId)
        : 10,
    fertilizerBuyNormalCount:
      accountId && typeof store.getFertilizerBuyNormalCount === "function"
        ? store.getFertilizerBuyNormalCount(accountId)
        : 0,
    fertilizerBuyNormalThresholdHours:
      accountId && typeof store.getFertilizerBuyNormalThresholdHours === "function"
        ? store.getFertilizerBuyNormalThresholdHours(accountId)
        : 10,
    fertilizerBuyCheckIntervalMinutes:
      accountId &&
      typeof store.getFertilizerBuyCheckIntervalMinutes === "function"
        ? store.getFertilizerBuyCheckIntervalMinutes(accountId)
        : 30,
    goldenBugKeepCount: Number(accountConfig.goldenBugKeepCount) || 0,
    goldenBugRoundLimit: Number(accountConfig.goldenBugRoundLimit) || 24,
    autoAcceptFriendMinLevel:
      accountId && typeof store.getAutoAcceptFriendMinLevel === "function"
        ? store.getAutoAcceptFriendMinLevel(accountId)
        : 0,
    bagSeedPriority:
      accountId && typeof store.getBagSeedPriority === "function"
        ? store.getBagSeedPriority(accountId)
        : [],
    bagSeedKnownIds: Array.isArray(accountConfig.bagSeedKnownIds)
      ? accountConfig.bagSeedKnownIds
      : [],
    bagSeedFallbackStrategy:
      accountId && typeof store.getBagSeedFallbackStrategy === "function"
        ? store.getBagSeedFallbackStrategy(accountId)
        : "level",
    ui: store.getUI(),
    offlineReminder:
      store.getOfflineReminder && currentUser
        ? store.getOfflineReminder(currentUser.username)
        : offlineReminderDefault,
  };
}

function registerAdminSettingsRoutes({
  app,
  provider,
  store,
  logger,
  getAccountIdFromRequest,
  canAccessAccount,
  requireDangerConfirmation,
}) {
  app.get("/api/settings/friend-monitor", (req, res) => {
    const accountId = requireAccountAccess(req, res, { getAccountIdFromRequest, canAccessAccount });
    if (!accountId) return;
    const config = store.getConfigSnapshot(accountId).friendMonitor;
    const state = require('../services/friend-monitor-state').readMonitorState(accountId);
    const records = config.friendGids.map(gid => ({ gid, ...(state.friends[gid] || {}) }));
    res.json({ ok: true, data: { config, friends: store.readFriendListCache(accountId) || [], records } });
  });

  app.get("/api/settings/default-plan", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const data = store.getUserDefaultAccountPlan(currentUser.username);
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/settings/default-plan", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        body.config || {},
        { enabled: body.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/import", (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const currentUser = req.currentUser;
      const currentPlan = store.getUserDefaultAccountPlan(currentUser.username);
      const config = store.getConfigSnapshot(accountId);
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        config,
        { enabled: currentPlan.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/apply", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const currentUser = req.currentUser;
      const data = store.applyUserDefaultAccountPlan(
        currentUser.username,
        accountId,
      );
      if (provider && typeof provider.saveSettings === "function") {
        await provider.saveSettings(accountId, data);
      } else if (provider && typeof provider.broadcastConfig === "function") {
        provider.broadcastConfig(accountId);
      }
      res.json({ ok: true, data });
    } catch (error) {
      const status = error.message === "尚未保存默认方案" ? 400 : 500;
      res.status(status).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/reset", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const currentPlan = store.getUserDefaultAccountPlan(currentUser.username);
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        store.getDefaultAccountConfig(),
        { enabled: currentPlan.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/save", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = await provider.saveSettings(accountId, req.body || {});
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/theme", async (req, res) => {
    try {
      const theme = String((req.body || {}).theme || "");
      const data = await provider.setUITheme(theme);
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/auto-code-refresh", async (req, res) => {
    res.status(410).json({ ok: false, error: '账号保活已迁移到全局设置，请由管理员统一配置' });
  });

  app.post("/api/settings/auto-code-refresh/run", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = await provider.refreshAccountCode(accountId);
      if (data?.ok === false) {
        return res.status(400).json({ ok: false, error: '账号重登失败，请检查账号日志或重新扫码登录' });
      }
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/offline-reminder", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const templateError = validateNotificationTemplates(body.templates);
      if (templateError) return res.status(400).json({ ok: false, error: templateError });
      if (
        Number(body.offlineDeleteSec || 0) > 0 &&
        !requireDangerConfirmation(req, res, "ENABLE_OFFLINE_DELETE")
      ) {
        return;
      }

      const data = store.setOfflineReminder
        ? store.setOfflineReminder(body, currentUser.username)
        : {};
      if (Number(body.offlineDeleteSec || 0) > 0) {
        logger.warn("更新下线提醒离线删除设置", {
          user: currentUser.username,
          offlineDeleteSec: Number(body.offlineDeleteSec || 0),
          channel: String(body.channel || ""),
          confirmation: "ENABLE_OFFLINE_DELETE",
        });
      }
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/offline-reminder/test", async (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) return res.status(401).json({ ok: false, error: "未登录" });
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const accountId = getAccountIdFromRequest(req);
      if (accountId && !canAccessAccount(req, accountId)) return res.status(403).json({ ok: false, error: "无权访问此账号" });
      const accounts = store.getAccounts ? store.getAccounts().accounts || [] : [];
      const account = accounts.find(item => String(item.id) === String(accountId));
      const config = getOfflineReminderConfig(store, currentUser, body);
      config.barkKey = typeof body.barkTestKey === 'string' ? body.barkTestKey.trim() : '';
      const templateError = validateNotificationTemplates(config.templates);
      if (templateError) return res.status(400).json({ ok: false, error: templateError });
      const event = body.testEvent || 'account_offline';
      if (!['account_offline', 'friend_crop_forecast', 'friend_crop_mature'].includes(event)) return res.status(400).json({ ok: false, error: '未知通知事件' });
      if (body.testChannel && !['smtp', 'bark'].includes(body.testChannel)) return res.status(400).json({ ok: false, error: '未知通知渠道' });
      const channels = body.testChannel === 'smtp' || body.testChannel === 'bark'
        ? [body.testChannel] : ['smtp', 'bark'];
      // Channel connection tests bypass subscriptions; event tests use the selected subscriptions.
      if (body.testChannel || !body.testEvent) config.events = { ...(config.events || {}), [event]: channels };
      if (body.testChannel) {
        config.smtpEnabled = body.testChannel === 'smtp' && config.smtpEnabled;
        config.barkEnabled = body.testChannel === 'bark' && !!config.barkKey;
      }
      const result = await sendOfflineReminderTest(config, account?.name || '测试账号', event, store.getSystemSettings?.());
      if (!result) {
        return res
          .status(400)
          .json({ ok: false, error: "发送失败：无返回结果" });
      }
      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      if (result.ok === false) {
        return res.status(400).json({
          ok: false,
          error: result.msg || "发送失败",
          data: result,
        });
      }
      res.json({ ok: true, data: result, message: result.msg || "发送成功" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const accountId = getAccountIdFromRequest(req);
      const currentUser = req.currentUser;
      if (accountId && !canAccessAccount(req, accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }
      res.json({
        ok: true,
        data: buildSettingsPayload(store, accountId, currentUser),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/settings/default", (req, res) => {
    try {
      const data = store.getDefaultAccountConfig
        ? store.getDefaultAccountConfig()
        : null;
      if (!data) {
        return res.status(500).json({ ok: false, error: "无法获取默认配置" });
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminSettingsRoutes };

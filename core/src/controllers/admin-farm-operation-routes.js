function requireAccountAccess({
  req,
  res,
  getAccountIdFromRequest,
  canAccessAccount,
  includeMissingMessage = true,
}) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    const payload = { ok: false };
    if (includeMissingMessage) payload.error = "Missing x-account-id";
    res.status(400).json(payload);
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

function requireLandId(req, res) {
  const { landId } = req.body || {};
  if (!landId) {
    res.status(400).json({ ok: false, error: "缺少土地ID" });
    return null;
  }
  return Number(landId);
}

function registerAdminFarmOperationRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  app.post("/api/farm/operate", async (req, res) => {
    const accountId = requireAccountAccess({
      req,
      res,
      getAccountIdFromRequest,
      canAccessAccount,
      includeMissingMessage: false,
    });
    if (!accountId) return;

    try {
      const { opType } = req.body;
      await provider.doFarmOp(accountId, opType);
      res.json({ ok: true });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/land/fertilize", async (req, res) => {
    const accountId = requireAccountAccess({
      req,
      res,
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const landId = requireLandId(req, res);
      if (!landId) return;

      const fertilizerType = req.body?.fertilizerType ?? 'organic';
      if (fertilizerType !== 'normal' && fertilizerType !== 'organic') {
        res.status(400).json({ ok: false, error: '化肥类型必须是 normal 或 organic' });
        return;
      }
      const data = await provider.fertilizeLand(accountId, landId, fertilizerType);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post('/api/farm/plant-bag', async (req, res) => {
    const accountId = requireAccountAccess({ req, res, getAccountIdFromRequest, canAccessAccount });
    if (!accountId) return;
    try {
      const { validateSeedIds } = require('../utils/manual-seed-selection');
      let seedIds;
      try {
        seedIds = validateSeedIds(req.body?.seedIds);
      } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
        return;
      }
      const data = await provider.plantSelectedBagSeeds(accountId, seedIds);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/land/remove", async (req, res) => {
    const accountId = requireAccountAccess({
      req,
      res,
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const landId = requireLandId(req, res);
      if (!landId) return;

      const data = await provider.removePlant(accountId, landId);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  async function removeBulkPlants(req, res, deadOnly) {
    const accountId = requireAccountAccess({
      req,
      res,
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = deadOnly
        ? await provider.removeDeadPlants(accountId)
        : await provider.removeAllPlants(accountId);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  }

  app.post('/api/land/remove-all', (req, res) => removeBulkPlants(req, res, false));
  app.post('/api/land/remove-dead', (req, res) => removeBulkPlants(req, res, true));

  for (const action of ['preview', 'step']) {
    app.post(`/api/farm/ripen-all/${action}`, async (req, res) => {
      const accountId = requireAccountAccess({ req, res, getAccountIdFromRequest, canAccessAccount });
      if (!accountId) return;
      try {
        if (action === 'step' && (typeof req.body?.token !== 'string'
          || !Number.isSafeInteger(req.body?.cursor) || req.body.cursor < 0)) {
          res.status(400).json({ ok: false, error: '无效的催熟确认参数' });
          return;
        }
        const data = action === 'preview' ? await provider.previewRipenAll(accountId)
          : await provider.ripenAllStep(accountId, req.body.token, req.body.cursor);
        res.json({ ok: true, data });
      } catch (error) {
        sendProviderError(res, error);
      }
    });
  }
}

module.exports = { registerAdminFarmOperationRoutes };

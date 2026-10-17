const { exportMutationDetailsCsv } = require('../services/mutation-records');

function registerAdminMutationRoutes({ app, provider, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  function route(method, url, handler) {
    app[method](url, async (req, res) => {
      const accountId = getAccountIdFromRequest(req);
      if (!accountId) return res.status(400).json({ ok: false, error: '缺少账号' });
      if (!canAccessAccount(req, accountId)) return res.status(403).json({ ok: false, error: '无权访问此账号' });
      try { await handler(req, res, accountId); }
      catch (error) { sendProviderError(res, error); }
    });
  }
  const query = req => ({
    mutation: String(req.query?.mutation || ''),
    status: String(req.query?.status || ''),
    seedId: String(req.query?.seedId || ''), testId: String(req.query?.testId || ''),
    recordId: String(req.query?.recordId || ''),
    view: ['stages', 'discoveries', 'operations'].includes(req.query?.view) ? req.query.view : 'records',
    page: req.query?.page, pageSize: req.query?.pageSize,
  });
  route('get', '/api/mutations', async (req, res, id) => {
    res.json({ ok: true, data: await provider.getMutationRecords(id, query(req)) });
  });
  route('post', '/api/mutations/clear', async (req, res, id) => {
    if (req.body?.confirm !== true) return res.status(400).json({ ok: false, error: '请确认清空当前账号的全部变异数据' });
    res.json({ ok: true, data: await provider.clearMutationRecords(id) });
  });
  route('get', '/api/mutations/export', async (req, res, id) => {
    const data = await provider.getMutationRecords(id, { ...query(req), all: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mutations.csv"');
    res.send(exportMutationDetailsCsv(data.rows, query(req).view));
  });
  route('get', '/api/mutation-test', async (req, res, id) => {
    res.json({ ok: true, data: await provider.getMutationTest(id) });
  });
  route('get', '/api/mutation-test/seeds', async (req, res, id) => {
    res.json({ ok: true, data: (await provider.getMutationTestSeeds(id)).filter(seed => seed.supported) });
  });
  route('post', '/api/mutation-test/start', async (req, res, id) => {
    res.json({ ok: true, data: await provider.startMutationTest(id, req.body || {}) });
  });
  route('post', '/api/mutation-test/stop', async (req, res, id) => {
    res.json({ ok: true, data: await provider.stopMutationTest(id) });
  });
}
module.exports = { registerAdminMutationRoutes };

const { createAdminAccessCodeStore, isValidAccessCode } = require('../config/admin-access-code');
const {
  clearAdminSessionCookie,
  getAdminRequestToken,
  setAdminSessionCookie,
} = require('./admin-session-manager');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const MAX_TRACKED_CLIENTS = 10000;

function createLoginLimiter({ now = Date.now } = {}) {
  const attempts = new Map();

  function check(req, res) {
    const time = now();
    for (const [client, entry] of attempts) {
      if (entry.resetAt <= time)
        attempts.delete(client);
    }
    // Do not trust arbitrary X-Forwarded-For values on a publicly exposed port.
    const key = req.socket?.remoteAddress || 'unknown';
    const entry = attempts.get(key);
    if ((entry && entry.failures >= MAX_LOGIN_FAILURES)
      || (!entry && attempts.size >= MAX_TRACKED_CLIENTS)) {
      const resetAt = entry?.resetAt || time + LOGIN_WINDOW_MS;
      res.setHeader('Retry-After', Math.max(1, Math.ceil((resetAt - time) / 1000)));
      res.status(429).json({ ok: false, error: '验证次数过多，请稍后再试' });
      return null;
    }
    return {
      fail() {
        attempts.set(key, {
          failures: (entry?.failures || 0) + 1,
          resetAt: entry?.resetAt || time + LOGIN_WINDOW_MS,
        });
      },
      success() {
        attempts.delete(key);
      },
    };
  }
  return { check };
}

function registerAdminAuthRoutes({
  app,
  createAdminSession,
  requireAdminToken,
  invalidateAdminSessionAndDisconnect,
  invalidateAdminSessions,
  accessCodeStore = createAdminAccessCodeStore(),
  limiter = createLoginLimiter(),
}) {
  app.get('/api/auth/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, data: { setupRequired: !accessCodeStore.isConfigured() } });
  });

  app.post('/api/auth/setup', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (accessCodeStore.isConfigured())
      return res.status(409).json({ ok: false, error: '访问 Code 已设置，请登录后在全局设置中修改' });
    if (!isValidAccessCode(req.body?.code))
      return res.status(400).json({ ok: false, error: '访问 Code 必须为 1～128 个字符，且不能全为空格' });
    try {
      accessCodeStore.set(req.body.code);
      invalidateAdminSessions(() => true);
      clearAdminSessionCookie(req, res);
      return res.json({ ok: true });
    }
    catch {
      return res.status(500).json({ ok: false, error: '访问 Code 保存失败，请重试' });
    }
  });

  app.put('/api/admin/access-code', requireAdminToken, (req, res) => {
    if (!isValidAccessCode(req.body?.code))
      return res.status(400).json({ ok: false, error: '访问 Code 必须为 1～128 个字符，且不能全为空格' });
    try {
      const changed = accessCodeStore.set(req.body.code);
      if (changed) {
        invalidateAdminSessions(() => true);
        clearAdminSessionCookie(req, res);
      }
      return res.json({ ok: true, data: { changed } });
    }
    catch {
      return res.status(500).json({ ok: false, error: '访问 Code 保存失败，请重试' });
    }
  });

  app.post('/api/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!accessCodeStore.isConfigured())
      return res.status(409).json({ ok: false, setupRequired: true, error: '请先设置访问 Code' });
    const attempt = limiter.check(req, res);
    if (!attempt) return;
    const code = req.body?.code;
    if (!accessCodeStore.matches(code)) {
      attempt.fail();
      return res.status(401).json({ ok: false, error: 'Code 不正确' });
    }
    attempt.success();
    const admin = {
      username: 'admin',
      role: 'admin',
      card: null,
      accountLimit: Number.MAX_SAFE_INTEGER,
      mustChangePassword: false,
    };
    const previousToken = getAdminRequestToken(req);
    if (previousToken)
      invalidateAdminSessionAndDisconnect(previousToken);
    const token = createAdminSession(admin);
    setAdminSessionCookie(req, res, token);
    return res.json({ ok: true, data: admin });
  });

  app.post('/api/logout', requireAdminToken, (req, res) => {
    invalidateAdminSessionAndDisconnect(req.adminToken);
    clearAdminSessionCookie(req, res);
    return res.json({ ok: true });
  });
}

module.exports = { createLoginLimiter, registerAdminAuthRoutes };

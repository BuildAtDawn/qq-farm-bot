const crypto = require('node:crypto');

const ADMIN_SESSION_COOKIE = 'farm_admin_session';
const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ADMIN_SESSIONS = 1000;

function getAdminRequestToken(req) {
  const headerToken = req.headers?.['x-admin-token'];
  if (typeof headerToken === 'string' && headerToken)
    return headerToken;
  const cookies = String(req.headers?.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (cookie.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE)
      continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
    catch {
      return '';
    }
  }
  return '';
}

function adminCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure === true,
    path: '/',
  };
}

function setAdminSessionCookie(req, res, token) {
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    ...adminCookieOptions(req),
    maxAge: ADMIN_SESSION_TTL_MS,
  });
}

function clearAdminSessionCookie(req, res) {
  res.clearCookie(ADMIN_SESSION_COOKIE, adminCookieOptions(req));
}

function createAdminSessionManager({ getIo, now = Date.now } = {}) {
  const adminSessions = new Map();

  function createAdminSession(user) {
    cleanupInvalidAdminSessions();
    if (adminSessions.size >= MAX_ADMIN_SESSIONS)
      invalidateAdminSessionAndDisconnect(adminSessions.keys().next().value);
    const token = crypto.randomBytes(32).toString('hex');
    const expiryTimer = setTimeout(() => invalidateAdminSessionAndDisconnect(token), ADMIN_SESSION_TTL_MS);
    expiryTimer.unref();
    adminSessions.set(token, { user, expiresAt: now() + ADMIN_SESSION_TTL_MS, expiryTimer });
    return token;
  }

  function disconnectAdminTokenSockets(token) {
    const io = typeof getIo === 'function' ? getIo() : null;
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.adminToken === token)
        socket.disconnect(true);
    }
  }

  function invalidateAdminSessionAndDisconnect(token) {
    clearTimeout(adminSessions.get(token)?.expiryTimer);
    adminSessions.delete(token);
    disconnectAdminTokenSockets(token);
  }

  function getSession(token) {
    const session = adminSessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      invalidateAdminSessionAndDisconnect(token);
      return null;
    }
    return session.user;
  }

  function invalidateAdminSessions(predicate) {
    for (const [token, session] of adminSessions.entries()) {
      if (predicate(session.user, token))
        invalidateAdminSessionAndDisconnect(token);
    }
  }

  function updateAdminSessions(predicate, updateSession) {
    for (const [token, session] of adminSessions.entries()) {
      if (predicate(session.user, token))
        updateSession(session.user, token);
    }
  }

  function requireAdminToken(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    const token = getAdminRequestToken(req);
    const user = getSession(token);
    if (!user) {
      clearAdminSessionCookie(req, res);
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    req.adminToken = token;
    req.currentUser = user;
    return next();
  }

  function cleanupInvalidAdminSessions() {
    for (const token of adminSessions.keys())
      getSession(token);
  }

  return {
    cleanupInvalidAdminSessions,
    createAdminSession,
    getSession,
    hasToken: token => !!getSession(token),
    invalidateAdminSessionAndDisconnect,
    invalidateAdminSessions,
    requireAdminToken,
    updateAdminSessions,
  };
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  clearAdminSessionCookie,
  createAdminSessionManager,
  getAdminRequestToken,
  setAdminSessionCookie,
};

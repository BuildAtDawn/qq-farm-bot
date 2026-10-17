const path = require('node:path');
const { getAdminRequestToken } = require('./admin-session-manager');

const PUBLIC_GET_PATHS = new Set(['/health', '/public/login-links', '/auth/status']);
const ADMIN_SOCKET_CORS_OPTIONS = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['x-admin-token', 'x-account-id'],
};

function configureCorsMiddleware(app) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin)
      res.header('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS')
      return res.sendStatus(200);
    return next();
  });
}

function registerAuthGate(app, requireAdminToken) {
  app.use('/api', (req, res, next) => {
    if ((req.method === 'POST' && ['/login', '/auth/setup'].includes(req.path))
      || (['GET', 'HEAD'].includes(req.method) && (PUBLIC_GET_PATHS.has(req.path)
        || /^\/public\/capture-certificate\/[^/]+\/[^/]+$/.test(req.path))))
      return next();
    return requireAdminToken(req, res, next);
  });
  app.use('/game-config', requireAdminToken);
}

function registerDocumentAuthGate(app, hasToken) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path === '/login'
      || req.path.startsWith('/api/') || req.path.startsWith('/game-config/')
      || path.extname(req.path) || !String(req.headers.accept || '').includes('text/html'))
      return next();
    if (hasToken(getAdminRequestToken(req)))
      return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  });
}

function createAdminSocketAuth(getSession) {
  return (socket, next) => {
    const token = socket.handshake.auth?.token || getAdminRequestToken(socket.handshake);
    const user = typeof token === 'string' ? getSession(token) : null;
    if (!user)
      return next(new Error('Unauthorized'));
    socket.data.adminToken = token;
    socket.data.user = user;
    return next();
  };
}

module.exports = {
  ADMIN_SOCKET_CORS_OPTIONS,
  configureCorsMiddleware,
  createAdminSocketAuth,
  registerAuthGate,
  registerDocumentAuthGate,
};

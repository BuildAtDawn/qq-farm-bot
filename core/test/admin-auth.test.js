const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createAdminAccessCodeStore } = require('../src/config/admin-access-code');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const {
  ADMIN_SOCKET_CORS_OPTIONS,
  configureCorsMiddleware,
  createAdminSocketAuth,
  registerAuthGate,
  registerDocumentAuthGate,
} = require('../src/controllers/admin-access-gate');
const { createLoginLimiter, registerAdminAuthRoutes } = require('../src/controllers/admin-auth-routes');
const {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  createAdminSessionManager,
  getAdminRequestToken,
} = require('../src/controllers/admin-session-manager');

async function fixture(t, { configured = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-admin-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'admin-access-code.json');
  const accessCodeStore = createAdminAccessCodeStore(filePath);
  if (configured) accessCodeStore.set('fixture-access-code');
  let time = Date.now();
  let io;
  const app = express();
  app.set('trust proxy', 'loopback');
  const sessions = createAdminSessionManager({ now: () => time, getIo: () => io });
  configureCorsMiddleware(app);
  app.use(express.json({ limit: '256kb' }));
  registerAuthGate(app, sessions.requireAdminToken);
  registerDocumentAuthGate(app, sessions.hasToken);
  registerAdminAuthRoutes({
    app,
    ...sessions,
    accessCodeStore,
    limiter: createLoginLimiter({ now: () => time }),
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/public/login-links', (_req, res) => res.json({ ok: true, data: { title: 'Farm' } }));
  app.get('/api/public/capture-certificate/:flow/:token', (req, res) =>
    res.sendStatus(req.params.token === 'temporary-token' ? 200 : 403));
  app.get('/api/auth/validate', (_req, res) => res.json({ ok: true, data: { valid: true } }));
  app.get('/api/accounts', (req, res) => res.json({ ok: true, username: req.currentUser.username }));
  app.post('/api/accounts', (_req, res) => res.json({ ok: true }));
  app.get('/game-config/Plant.json', (_req, res) => res.json([]));
  app.get('/assets/app.js', (_req, res) => res.type('js').send('/* public shell */'));
  app.use(express.static(path.join(__dirname, '../../web/public')));
  app.get('*', (_req, res) => res.send('<html>SPA shell</html>'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  io = new Server(server, { cors: ADMIN_SOCKET_CORS_OPTIONS });
  io.use(createAdminSocketAuth(sessions.getSession));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    sessions.invalidateAdminSessions(() => true);
    await new Promise(resolve => io.close(resolve));
    server.closeAllConnections();
  });
  return {
    base,
    io,
    sessions,
    accessCodeStore,
    filePath,
    advance(ms) { time += ms; },
    request(path, { headers = {}, body, method = body === undefined ? 'GET' : 'POST', ...options } = {}) {
      return fetch(base + path, {
        ...options,
        method,
        redirect: 'manual',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    async login(headers = {}) {
      const response = await this.request('/api/login', { body: { code: 'fixture-access-code' }, headers });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    },
  };
}

test('empty configuration requires setup, persists plaintext and cannot be overwritten anonymously', async t => {
  const f = await fixture(t, { configured: false });
  const status = await f.request('/api/auth/status');
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await status.json(), { ok: true, data: { setupRequired: true } });
  for (const code of ['', 'wrong-access-code']) {
    const response = await f.request('/api/login', { body: { code } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).setupRequired, true);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal((await f.request('/api/accounts')).status, 401);
  for (const code of ['', '   ', null, [], 'x'.repeat(129)])
    assert.equal((await f.request('/api/auth/setup', { body: { code } })).status, 400);
  const setup = await f.request('/api/auth/setup', { body: { code: 'fixture-access-code' } });
  assert.equal(setup.status, 200);
  assert.match(setup.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await f.request('/api/accounts')).status, 401);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath, 'utf8')), { accessCode: 'fixture-access-code' });
  const restarted = createAdminAccessCodeStore(f.filePath);
  assert.equal(restarted.isConfigured(), true);
  assert.equal(restarted.matches('fixture-access-code'), true);
  assert.equal((await f.request('/api/auth/setup', { body: { code: 'overwrite' } })).status, 409);
  assert.equal((await (await f.request('/api/auth/status')).json()).data.setupRequired, false);
  assert.ok(await f.login());
});

test('changing Code revokes every token, disconnects sockets and requires the new Code', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/access-code', { method: 'PUT', body: { code: 'new-code' } })).status, 401);
  const first = await f.login();
  const second = await f.login();
  const token = getAdminRequestToken({ headers: { cookie: second } });
  const disconnected = [];
  f.io.sockets.sockets.set('change-code-socket', {
    data: { adminToken: token }, disconnect: force => disconnected.push(force),
  });
  t.after(() => f.io.sockets.sockets.delete('change-code-socket'));
  for (const code of ['', ' ', [], 'x'.repeat(129)]) {
    assert.equal((await f.request('/api/admin/access-code', { method: 'PUT', body: { code }, headers: { Cookie: first } })).status, 400);
  }
  const unchanged = await f.request('/api/admin/access-code', { method: 'PUT', body: { code: 'fixture-access-code' }, headers: { Cookie: first } });
  assert.equal((await unchanged.json()).data.changed, false);
  assert.equal(f.sessions.hasToken(token), true);
  const response = await f.request('/api/admin/access-code', { method: 'PUT', body: { code: 'new-code' }, headers: { Cookie: first } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.changed, true);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.deepEqual(disconnected, [true]);
  for (const cookie of [first, second])
    assert.equal((await f.request('/api/accounts', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await f.request('/api/login', { body: { code: 'fixture-access-code' } })).status, 401);
  assert.equal((await f.request('/api/login', { body: { code: 'new-code' } })).status, 200);
  assert.equal(createAdminAccessCodeStore(f.filePath).matches('new-code'), true);
});

test('concurrent first-time setup accepts only one Code', async t => {
  const f = await fixture(t, { configured: false });
  const codes = ['first-code', 'second-code'];
  const responses = await Promise.all(codes.map(code => f.request('/api/auth/setup', { body: { code } })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = responses.findIndex(response => response.status === 200);
  assert.equal(createAdminAccessCodeStore(f.filePath).matches(codes[winner]), true);
  assert.equal(f.accessCodeStore.matches(codes[1 - winner]), false);
});

test('failed persistence preserves the current Code and sessions; corrupt configuration fails closed', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  fs.unlinkSync(f.filePath);
  fs.mkdirSync(f.filePath);
  const response = await f.request('/api/admin/access-code', { method: 'PUT', body: { code: 'new-code' }, headers: { Cookie: cookie } });
  assert.equal(response.status, 500);
  assert.equal(f.accessCodeStore.matches('fixture-access-code'), true);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: cookie } })).status, 200);
  assert.throws(() => createAdminAccessCodeStore(f.filePath));
  fs.rmdirSync(f.filePath);
  fs.writeFileSync(f.filePath, '{broken');
  assert.throws(() => createAdminAccessCodeStore(f.filePath));
});

test('anonymous page navigation redirects to verification while shell assets stay available', async (t) => {
  const f = await fixture(t);
  const original = '/settings?tab=system&name=%E5%86%9C%E5%9C%BA';
  const response = await f.request(original, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `/login?redirect=${encodeURIComponent(original)}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await f.request('/login', { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await f.request('/assets/app.js')).status, 200);
  const cookie = await f.login();
  assert.equal((await f.request(original, { headers: { Accept: 'text/html', Cookie: cookie } })).status, 200);
});

test('code verification issues only an HttpOnly cookie and supports authenticated refresh', async (t) => {
  const f = await fixture(t);
  const response = await f.request('/api/login', { body: { code: 'fixture-access-code' } });
  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /Path=\//);
  assert.match(cookieHeader, /Max-Age=604800/);
  assert.doesNotMatch(cookieHeader, /Secure/);
  const body = await response.json();
  assert.equal(body.data.username, 'admin');
  assert.equal(body.data.token, undefined);
  assert.doesNotMatch(JSON.stringify(body), /fixture-access-code/);
  const cookie = cookieHeader.split(';')[0];
  const authenticated = await f.request('/api/accounts', { headers: { Cookie: cookie } });
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).username, 'admin');
  assert.equal((await f.request('/api/auth/validate', { headers: { Cookie: cookie } })).status, 200);
});

test('WeChat redirect HTML and script work without Token while account APIs remain protected', async t => {
  const f = await fixture(t);
  const page = await f.request('/open-weixin.html?target=https://evil.example', { headers: { Accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('location'), null);
  assert.match(await page.text(), /href="weixin:\/\/dl\/business\/\?appid=wx5306c5978fdb76e4"/);
  const script = await f.request('/open-weixin.js');
  assert.equal(script.status, 200);
  assert.match(await script.text(), /window.location.replace/);
  assert.equal((await f.request('/api/accounts')).status, 401);
});

test('missing, malformed and old credentials never grant access', async (t) => {
  const f = await fixture(t);
  for (const body of [{}, { code: ['fixture-access-code'] }, { username: 'admin', password: 'admin' }, { code: 'FIXTURE-ACCESS-CODE' }, { code: 'wrong-access-code' }]) {
    const response = await f.request('/api/login', { body });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  for (const path of ['/api/auto-login', '/api/qr/create', '/api/qr/check', '/api/game-version',
    '/api/changelog', '/api/auth/validate', '/api/accounts', '/game-config/Plant.json']) {
    const response = await f.request(path, {
      method: path.endsWith('auto-login') ? 'POST' : 'GET',
      headers: { 'x-admin-token': 'invented-token', Cookie: `${ADMIN_SESSION_COOKIE}=forged` },
    });
    assert.equal(response.status, 401, path);
  }
});

test('only intended read-only public endpoints are exempt, including HEAD health checks', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/health', { method: 'HEAD' })).status, 200);
  assert.equal((await f.request('/api/health', { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await f.request('/api/public/login-links')).status, 200);
  assert.equal((await f.request('/api/public/capture-certificate/flow/temporary-token')).status, 200);
  assert.equal((await f.request('/api/public/capture-certificate/flow/wrong')).status, 403);
  assert.equal((await f.request('/api/public/capture-certificate/anything')).status, 401);
  assert.equal((await f.request('/api/public/login-links', { body: {} })).status, 401);
});

test('login throttles failures and ignores forged forwarding headers', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    const response = await f.request('/api/login', {
      body: { code: 'wrong' },
      headers: { 'X-Forwarded-For': `192.0.2.${i}` },
    });
    assert.equal(response.status, 401);
  }
  const blocked = await f.request('/api/login', {
    body: { code: 'fixture-access-code' },
    headers: { 'X-Forwarded-For': '198.51.100.1' },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  f.advance(15 * 60 * 1000 - 1);
  assert.equal((await f.request('/api/login', { body: { code: 'fixture-access-code' } })).status, 429);
  f.advance(1);
  assert.ok(await f.login());
});

test('successful login clears failure counts and rotates the previous session', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++)
    await f.request('/api/login', { body: { code: 'wrong' } });
  const first = await f.login();
  const second = await f.login({ Cookie: first });
  assert.notEqual(first, second);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: first } })).status, 401);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: second } })).status, 200);
  for (let i = 0; i < 5; i++)
    assert.equal((await f.request('/api/login', { body: { code: 'wrong' } })).status, 401);
});

test('session expires at the exact boundary and a restarted manager rejects old cookies', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const token = getAdminRequestToken({ headers: { cookie } });
  const restarted = createAdminSessionManager();
  assert.equal(restarted.hasToken(token), false);
  f.advance(ADMIN_SESSION_TTL_MS - 1);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: cookie } })).status, 200);
  f.advance(1);
  const response = await f.request('/api/accounts', { headers: { Cookie: cookie } });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal(f.sessions.hasToken(token), false);
});

test('logout revokes server access, clears the cookie and rejects reuse', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const response = await f.request('/api/logout', { body: {}, headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await f.request('/api/logout', { body: {}, headers: { Cookie: cookie } })).status, 401);
});

test('HTTPS proxy login uses a Secure cookie', async (t) => {
  const f = await fixture(t);
  const httpsOrigin = f.base.replace('http:', 'https:');
  const secure = await f.request('/api/login', {
    body: { code: 'fixture-access-code' },
    headers: { Origin: httpsOrigin, 'X-Forwarded-Proto': 'https' },
  });
  assert.equal(secure.status, 200);
  assert.match(secure.headers.get('set-cookie'), /Secure/);
});

test('cross-origin login and authenticated mutations are allowed but still require a valid session', async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { Origin: 'https://panel.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: f.base.replace('127.0.0.1', 'localhost') },
    { Origin: 'https://panel.example', 'X-Forwarded-Proto': 'http' },
  ]) {
    const cookie = await f.login(headers);
    const response = await f.request('/api/accounts', { body: {}, headers: { Cookie: cookie, ...headers } });
    assert.equal(response.status, 200);
    if (headers.Origin)
      assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
    assert.equal((await f.request('/api/accounts', { body: {}, headers })).status, 401);
    assert.equal((await f.request('/api/accounts', {
      body: {},
      headers: { ...headers, Cookie: `${ADMIN_SESSION_COOKIE}=forged`, 'x-admin-token': 'fake' },
    })).status, 401);
    assert.equal((await f.request('/api/login', { body: { code: 'wrong' }, headers })).status, 401);
  }
});

test('API and Socket.IO CORS preflight accepts arbitrary origins and credentials', async (t) => {
  const f = await fixture(t);
  for (const path of ['/api/accounts', '/socket.io/?EIO=4&transport=polling']) {
    const response = await f.request(path, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://panel.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-admin-token,x-account-id',
      },
    });
    assert.ok([200, 204].includes(response.status));
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://panel.example');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('vary'), /Origin/);
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.match(response.headers.get('access-control-allow-headers'), /x-admin-token/);
  }
});

test('malformed cookie data is rejected without throwing', () => {
  assert.equal(getAdminRequestToken({ headers: { cookie: `${ADMIN_SESSION_COOKIE}=%ZZ` } }), '');
  assert.equal(getAdminRequestToken({ headers: { cookie: 'other=value' } }), '');
  assert.equal(getAdminRequestToken({ headers: { cookie: `other=1; ${ADMIN_SESSION_COOKIE}=valid` } }), 'valid');
});

test('Socket.IO uses the same session, rejects forged tokens and disconnects revoked clients', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const token = getAdminRequestToken({ headers: { cookie } });
  const middleware = createAdminSocketAuth(f.sessions.getSession);
  const socket = { data: {}, handshake: { headers: { cookie }, auth: {} } };
  let nextError;
  middleware(socket, error => nextError = error);
  assert.equal(nextError, undefined);
  assert.equal(socket.data.adminToken, token);
  assert.equal(socket.data.user.username, 'admin');
  middleware({ data: {}, handshake: { headers: {}, auth: { token: 'fake' } } }, error => nextError = error);
  assert.equal(nextError.message, 'Unauthorized');
  const disconnects = [];
  f.io.sockets.sockets.set('fixture-socket', { data: { adminToken: token }, disconnect: force => disconnects.push(force) });
  f.advance(ADMIN_SESSION_TTL_MS);
  f.sessions.cleanupInvalidAdminSessions();
  assert.deepEqual(disconnects, [true]);
  f.io.sockets.sockets.delete('fixture-socket');
  middleware(socket, error => nextError = error);
  assert.equal(nextError.message, 'Unauthorized');
});

test('cross-origin websocket connections still require a valid session', { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  for (const [sessionCookie, expectedPacket] of [
    [cookie, /^40\{/],
    ['', /^44.*Unauthorized/],
    [`${ADMIN_SESSION_COOKIE}=forged`, /^44.*Unauthorized/],
  ]) {
    const socket = new WebSocket(`${f.base.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`, {
      headers: { Origin: 'https://panel.example', Cookie: sessionCookie },
    });
    t.after(() => socket.terminate());
    const packet = new Promise((resolve, reject) => {
      socket.on('error', reject);
      socket.on('message', (data) => {
        const message = data.toString();
        if (message.startsWith('0'))
          socket.send('40');
        else if (message.startsWith('40') || message.startsWith('44'))
          resolve(message);
      });
    });
    assert.match(await packet, expectedPacket);
    socket.close();
    await once(socket, 'close');
  }
});

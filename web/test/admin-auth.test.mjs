import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(name in imports, `Unexpected import: ${name}`)
      return imports[name]
    },
    ...globals,
  })
  return exports
}

const redirects = loadModule('../src/utils/auth-redirect.ts', {}, { URL })

function authFixture() {
  const calls = []
  const storage = new Map([['admin_token', 'old-anonymous-token'], ['user_info', 'old-user']])
  const location = {
    pathname: '/settings',
    search: '?tab=accounts',
    hash: '#login',
    replace(path) { calls.push(['redirect', path]) },
  }
  const axios = {
    async get(path) {
      calls.push(['get', path])
      return { data: { ok: true, data: { valid: true } } }
    },
    async post(path, body) {
      calls.push(['post', path, body])
      return { data: { ok: true } }
    },
    isAxiosError: error => error?.isAxiosError === true,
  }
  const auth = loadModule('../src/utils/admin-auth.ts', {
    axios: { default: axios },
    vue: { ref: value => ({ value }) },
    './auth-redirect': redirects,
  }, {
    window: { location },
    localStorage: { removeItem: key => storage.delete(key) },
  })
  return { auth, axios, calls, storage, location }
}

test('returns to the complete internal URL, including query and fragment', () => {
  const path = '/settings?tab=accounts&name=%E5%86%9C%E5%9C%BA#login'
  assert.equal(redirects.safeAuthRedirect(path), path)
  assert.equal(redirects.codeLoginLocation(path), `/login?redirect=${encodeURIComponent(path)}`)
})

test('rejects external, encoded, malformed and login-loop destinations', () => {
  for (const path of [undefined, ['/', '//evil.example'], '', 'https://evil.example',
    '//evil.example', '/\\evil.example', '/%2F%2Fevil.example', '/%5Cevil',
    '/%0Aevil', '/%ZZ', '/login', '/login?redirect=/settings', '/LOGIN/', '/%6cogin',
    '/foo/../login', '/\tevil.example']) {
    assert.equal(redirects.safeAuthRedirect(path), '/', String(path))
  }
})

test('navigation cannot mount protected pages without server validation', () => {
  const protectedRoute = { name: 'settings', fullPath: '/settings?tab=system#status', query: {} }
  const denied = redirects.adminNavigationDecision(protectedRoute, false)
  assert.equal(denied.name, 'code-login')
  assert.equal(denied.query.redirect, protectedRoute.fullPath)
  assert.equal(denied.replace, true)
  assert.equal(redirects.adminNavigationDecision(protectedRoute, true), true)
  const login = { name: 'code-login', fullPath: '/login', query: { redirect: protectedRoute.fullPath } }
  assert.equal(redirects.adminNavigationDecision(login, false), true)
  assert.equal(redirects.adminNavigationDecision(login, true), protectedRoute.fullPath)
  login.query.redirect = '//evil.example'
  assert.equal(redirects.adminNavigationDecision(login, true), '/')
})

test('legacy local storage credentials cannot grant access', async () => {
  const f = authFixture()
  assert.equal(f.storage.size, 0)
  assert.equal(f.auth.adminAuthenticated.value, false)
  f.axios.get = async () => { throw { isAxiosError: true, response: { status: 401 } } }
  assert.equal(await f.auth.ensureAdminSession(), false)
})

test('session validation deduplicates concurrent requests and revalidates later navigation', async () => {
  const f = authFixture()
  const results = await Promise.all([f.auth.ensureAdminSession(), f.auth.ensureAdminSession()])
  assert.deepEqual(results, [true, true])
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][1], '/api/auth/validate')
  await f.auth.ensureAdminSession()
  assert.equal(f.calls.length, 2)
})

test('failed session validation never leaves protected navigation authenticated', async () => {
  const f = authFixture()
  await f.auth.ensureAdminSession()
  f.axios.get = async () => { throw new Error('offline') }
  assert.equal(await f.auth.ensureAdminSession(), false)
  assert.equal(f.auth.adminAuthenticated.value, false)
  f.axios.get = async () => ({ data: { ok: false } })
  assert.equal(await f.auth.ensureAdminSession(), false)
})

test('in-flight validation cannot restore a revoked local session', async () => {
  const f = authFixture()
  let resolve
  f.axios.get = () => new Promise(done => resolve = done)
  const pending = f.auth.ensureAdminSession()
  f.auth.clearAdminAuthentication()
  resolve({ data: { ok: true, data: { valid: true } } })
  assert.equal(await pending, false)
  assert.equal(f.auth.adminAuthenticated.value, false)
})

test('code verification sends no URL credentials and marks only successful responses authenticated', async () => {
  const f = authFixture()
  await f.auth.verifyAdminCode('fixture-code')
  assert.equal(f.auth.adminAuthenticated.value, true)
  assert.equal(f.calls[0][0], 'post')
  assert.equal(f.calls[0][1], '/api/login')
  assert.equal(f.calls[0][2].code, 'fixture-code')
  assert.equal(f.storage.size, 0)
  f.auth.clearAdminAuthentication()
  f.axios.post = async () => ({ data: { ok: false } })
  await assert.rejects(() => f.auth.verifyAdminCode('wrong'))
  assert.equal(f.auth.adminAuthenticated.value, false)
})

test('expired-session redirect preserves the original destination and does not loop on login', () => {
  const f = authFixture()
  f.auth.adminAuthenticated.value = true
  f.auth.redirectToCodeLogin()
  assert.equal(f.auth.adminAuthenticated.value, false)
  assert.equal(f.calls[0][1], '/login?redirect=%2Fsettings%3Ftab%3Daccounts%23login')
  f.location.pathname = '/login'
  f.auth.redirectToCodeLogin()
  assert.equal(f.calls.length, 1)
})

test('logout invalidates access only after server revocation and handles already expired sessions', async () => {
  const f = authFixture()
  f.auth.adminAuthenticated.value = true
  f.axios.post = async () => { throw new Error('offline') }
  await assert.rejects(() => f.auth.logoutAdmin())
  assert.equal(f.auth.adminAuthenticated.value, true)
  assert.equal(f.calls.length, 0)
  f.axios.post = async () => { throw { isAxiosError: true, response: { status: 401 } } }
  await f.auth.logoutAdmin()
  assert.equal(f.auth.adminAuthenticated.value, false)
  assert.equal(f.calls[0][0], 'redirect')
})

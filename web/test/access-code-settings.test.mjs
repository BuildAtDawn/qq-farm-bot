import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function fixture(file, exposed) {
  const calls = []
  const mounted = []
  let request = async () => ({ data: { ok: true, data: { changed: true, setupRequired: true } } })
  const api = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (...args) => {
    calls.push([method, ...args])
    return request(method, ...args)
  }]))
  api.isAxiosError = error => !!error.response
  const imports = {
    'vue': { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), onMounted: fn => mounted.push(fn), onBeforeUnmount() {} },
    'axios': { default: api },
    '@/api': { default: api },
    'vue-router': { useRoute: () => ({ query: {} }), useRouter: () => ({ replace: path => calls.push(['navigate', path]) }) },
    '@/stores/app': { useAppStore: () => ({ brandTitle: 'Farm', fetchLoginPageConfig() {} }) },
    '@/utils/admin-auth': { verifyAdminCode: code => calls.push(['login', code]), redirectToCodeLogin: () => calls.push(['logout']) },
    '@/utils/auth-redirect': { safeAuthRedirect: () => '/' },
    '@/utils/branding': { FARM_BRAND: {} },
    '@/components/ui/BaseButton.vue': {},
    '@/components/ui/BaseInput.vue': {},
    '@/components/settings/GlobalSettingsCard.vue': {},
  }
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
  const { outputText } = ts.transpileModule(`${source}\nexports.state = { ${exposed} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: (name) => {
    assert.ok(name in imports, name)
    return imports[name]
  }, __APP_VERSION__: 'test', setInterval, clearInterval })
  return { ...exports.state, calls, mounted, setRequest: (fn) => {
    request = fn
  } }
}

test('access Code settings reject empty/mismatched inputs and immediately log out after a change', async () => {
  const f = fixture('../src/components/settings/AccessCodeSettings.vue', 'code, confirmation, saving, error, saved, save')
  await f.save()
  assert.equal(f.calls.length, 0)
  f.code.value = 'new-code'
  f.confirmation.value = 'different'
  await f.save()
  assert.equal(f.calls.length, 0)
  f.confirmation.value = 'new-code'
  await f.save()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['put', '/api/admin/access-code', { code: 'new-code' }], ['logout']])
  assert.equal(f.code.value, '')
  assert.equal(f.confirmation.value, '')
})

test('access Code settings deduplicate saves, preserve input on failure and do not log out for unchanged Code', async () => {
  const f = fixture('../src/components/settings/AccessCodeSettings.vue', 'code, confirmation, saving, error, saved, save')
  f.code.value = f.confirmation.value = 'same-code'
  let finish
  f.setRequest(() => new Promise((resolve) => {
    finish = resolve
  }))
  const pending = f.save()
  await f.save()
  assert.equal(f.calls.length, 1)
  finish({ data: { ok: false, error: 'save failed' } })
  await pending
  assert.equal(f.code.value, 'same-code')
  assert.equal(f.error.value, 'save failed')
  f.setRequest(async () => ({ data: { ok: true, data: { changed: false } } }))
  await f.save()
  assert.equal(f.saved.value, true)
  assert.equal(f.calls.some(call => call[0] === 'logout'), false)
})

test('login requires known status, confirms first Code and returns to login after setup', async () => {
  const f = fixture('../src/views/CodeLogin.vue', 'code, confirmation, setupRequired, statusReady, error, notice, loadAuthStatus, submit')
  f.code.value = 'new-code'
  await f.submit()
  assert.equal(f.calls.length, 0)
  await f.loadAuthStatus()
  assert.equal(f.setupRequired.value, true)
  await f.submit()
  assert.match(f.error.value, /不一致/)
  f.confirmation.value = 'new-code'
  await f.submit()
  assert.equal(f.setupRequired.value, false)
  assert.equal(f.code.value, '')
  assert.match(f.notice.value, /请使用新 Code 登录/)
  assert.equal(f.calls.some(call => call[0] === 'login'), false)
  f.code.value = 'new-code'
  await f.submit()
  assert.deepEqual(f.calls.slice(-2), [['login', 'new-code'], ['navigate', '/']])
})

test('login status failures block submissions, and setup conflicts reload status', async () => {
  const f = fixture('../src/views/CodeLogin.vue', 'code, confirmation, setupRequired, statusReady, error, notice, loadAuthStatus, submit')
  f.setRequest(async () => {
    throw new Error('offline')
  })
  await f.loadAuthStatus()
  assert.equal(f.statusReady.value, false)
  f.code.value = 'code'
  await f.submit()
  assert.equal(f.calls.length, 1)
  f.setRequest(async (method) => {
    if (method === 'post')
      throw Object.assign(new Error('Conflict'), { response: { status: 409 } })
    return { data: { ok: true, data: { setupRequired: false } } }
  })
  f.statusReady.value = true
  f.setupRequired.value = true
  f.confirmation.value = 'code'
  await f.submit()
  assert.equal(f.setupRequired.value, false)
  assert.equal(f.code.value, '')
  assert.match(f.error.value, /已设置/)
})

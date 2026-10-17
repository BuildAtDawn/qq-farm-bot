import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function fixture() {
  const calls = []
  let get = async () => ({ data: { ok: true, data: config(200, 300) } })
  let post = async (_url, body) => ({ data: { ok: true, data: body } })
  const source = readFileSync(new URL('../src/composables/settings/useSystemSettings.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    URL,
    require: name => ({
      'vue': {
        ref: value => ({ value }),
        computed: fn => ({ get value() { return fn() } }),
      },
      '@/api': { default: {
        get: (...args) => {
          calls.push(['get', ...args])
          return get(...args)
        },
        post: (...args) => {
          calls.push(['post', ...args])
          return post(...args)
        },
      } },
    })[name],
  })
  return {
    ...exports.useSystemSettings(),
    calls,
    setGet: (fn) => { get = fn },
    setPost: (fn) => { post = fn },
  }
}

function config(min, max) {
  return { organicFertilizerDelayMinMs: min, organicFertilizerDelayMaxMs: max, publicWebOrigin: '' }
}

test('loads global settings without an account and saves the range in milliseconds', async () => {
  const f = fixture()
  await f.save()
  assert.equal(f.calls.length, 0)
  await f.load()
  assert.equal(f.loaded.value, true)
  assert.deepEqual(f.calls[0], ['get', '/api/admin/system-settings'])
  f.form.value = config(500, 800)
  await f.save()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1])), ['post', '/api/admin/system-settings', config(500, 800)])
  assert.equal(f.saved.value, true)
  assert.equal(f.saving.value, false)
})

test('public web origin is loaded and saved globally; invalid prefixes block submission', async () => {
  const f = fixture()
  f.setGet(async () => ({ data: { ok: true, data: { ...config(200, 300), publicWebOrigin: 'https://123.com' } } }))
  await f.load()
  assert.equal(f.form.value.publicWebOrigin, 'https://123.com')
  for (const value of ['123.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://123.com/path', 'https://123.com?key=value', 'https://123.com/#hash']) {
    f.form.value.publicWebOrigin = value
    assert.ok(f.validationError.value)
    await f.save()
  }
  assert.equal(f.calls.length, 1)
  f.form.value.publicWebOrigin = 'https://123.com/'
  assert.equal(f.validationError.value, '')
  await f.save()
  assert.equal(f.calls[1][2].publicWebOrigin, 'https://123.com/')
  assert.equal(f.saved.value, true)
})

test('invalid ranges and empty inputs cannot save; zero, fixed intervals and the maximum are accepted', async () => {
  const f = fixture()
  await f.load()
  for (const input of [config('', 300), config('200', 300), config(-1, 300), config(0.5, 300), config(500, 300), config(200, 60001), config(200, Infinity)]) {
    f.form.value = input
    assert.ok(f.validationError.value)
    await f.save()
  }
  assert.equal(f.calls.length, 1)
  for (const input of [config(0, 0), config(300, 300), config(0, 60000)]) {
    f.form.value = input
    assert.equal(f.validationError.value, '')
    await f.save()
    assert.equal(f.saved.value, true)
  }
})

test('load failures do not allow defaults to overwrite saved settings and can be retried', async () => {
  const f = fixture()
  f.setGet(async () => {
    throw new Error('fixture load failure')
  })
  await f.load()
  assert.equal(f.loaded.value, false)
  assert.equal(f.loading.value, false)
  assert.match(f.error.value, /load failure/)
  await f.save()
  assert.equal(f.calls.length, 1)
  f.setGet(async () => ({ data: { ok: true, data: config(700, 900) } }))
  await f.load()
  assert.equal(f.loaded.value, true)
  assert.equal(f.form.value.organicFertilizerDelayMinMs, 700)
})

test('saving is single-flight and business failures never claim success', async () => {
  const f = fixture()
  await f.load()
  let finish
  f.setPost(() => new Promise((resolve) => {
    finish = resolve
  }))
  const pending = f.save()
  await f.save()
  await f.load()
  assert.equal(f.calls.length, 2)
  finish({ data: { ok: false, error: 'fixture save failure' } })
  await pending
  assert.equal(f.saved.value, false)
  assert.equal(f.saving.value, false)
  assert.match(f.error.value, /save failure/)
  f.setPost(async (_url, body) => ({ data: { ok: true, data: body } }))
  await f.save()
  assert.equal(f.saved.value, true)
})

test('WeChat keepalive loads and saves globally with strict timer bounds', async () => {
  const f = fixture()
  const policy = { enabled: true, intervalMinutes: 45, offlineEnabled: true, offlineDelaySeconds: 25 }
  f.setGet(async () => ({ data: { ok: true, data: { ...config(200, 300), autoCodeRefresh: policy } } }))
  await f.load()
  assert.deepEqual(f.form.value.autoCodeRefresh, policy)
  for (const patch of [{ intervalMinutes: 0 }, { intervalMinutes: 1441 }, { intervalMinutes: '' }, { offlineDelaySeconds: 0 }, { offlineDelaySeconds: 86401 }]) {
    f.form.value.autoCodeRefresh = { ...policy, ...patch }
    assert.match(f.validationError.value, /账号保活/)
    assert.equal(await f.save(), false)
  }
  assert.equal(f.calls.length, 1)
  f.form.value.autoCodeRefresh = { ...policy, offlineDelaySeconds: 1 }
  assert.equal(await f.save(), true)
  assert.equal(f.calls[1][1], '/api/admin/system-settings')
  assert.equal(f.calls[1][2].autoCodeRefresh.offlineDelaySeconds, 1)
})

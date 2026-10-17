import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/utils/scoped-request.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const exports = {}
vm.runInNewContext(outputText, { exports, AbortController })
const { createScopedRequest } = exports
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  let key = 'account-a'
  const pending = []
  const applied = []
  const errors = []
  let loading = false
  const request = createScopedRequest({
    key: () => key,
    fetch: signal => new Promise((resolve, reject) => { pending.push({ signal, resolve, reject }) }),
    apply: data => applied.push(data),
    error: error => errors.push(error),
    loading: value => { loading = value },
  })
  return { request, pending, applied, errors, key: value => { key = value }, loading: () => loading }
}
test('refresh/poll coalesce and errors release the pending slot', async () => {
  const f = fixture()
  const first = f.request.run()
  assert.equal(f.request.run(), first)
  await flush()
  f.pending[0].reject(new Error('unavailable'))
  await first
  assert.equal(f.errors.length, 1)
  assert.equal(f.loading(), false)
  const retry = f.request.run()
  await flush()
  f.pending[1].resolve('fresh')
  await retry
  assert.deepEqual(f.applied, ['fresh'])
})
test('account/filter changes reject stale results even if transport ignores cancellation', async () => {
  const f = fixture()
  const old = f.request.run()
  await flush()
  f.key('account-b')
  const current = f.request.run()
  await flush()
  assert.equal(f.pending[0].signal.aborted, true)
  f.pending[1].resolve('b')
  await current
  f.pending[0].resolve('a')
  await old
  assert.deepEqual(f.applied, ['b'])
})
test('hiding/unmounting invalidates pending reads, and returning permits a fresh read', async () => {
  const f = fixture()
  const old = f.request.run()
  await flush()
  f.request.invalidate()
  f.pending[0].resolve('stale')
  await old
  assert.equal(f.loading(), false)
  assert.deepEqual(f.applied, [])
  const next = f.request.run()
  await flush()
  f.pending[1].resolve('current')
  await next
  assert.deepEqual(f.applied, ['current'])
})
test('missing account never starts an API request', async () => {
  const f = fixture()
  f.key('')
  await f.request.run()
  assert.equal(f.pending.length, 0)
})

test('API interceptor preserves an explicitly captured account instead of rerouting a command after account switch', () => {
  const source = readFileSync(new URL('../src/api/index.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  let interceptor
  const api = { interceptors: { request: { use(fn) { interceptor = fn } }, response: { use() {} } } }
  vm.runInNewContext(outputText, {
    exports: {},
    require: name => ({
      '@vueuse/core': { useStorage: () => ({ value: 'new-account' }) },
      'axios': { default: { create: () => api } },
    })[name] || {},
  })
  assert.equal(interceptor({ headers: { 'x-account-id': 'original-account' } }).headers['x-account-id'], 'original-account')
  assert.equal(interceptor({ headers: {} }).headers['x-account-id'], 'new-account')
})

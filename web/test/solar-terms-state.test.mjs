import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const require = createRequire(import.meta.url)
const config = require('../../core/src/gameConfig/SolarTerms.json')
const coreConfig = require('../../core/src/config/solar-terms')
const { descriptor } = parse(readFileSync(new URL('../src/components/activity/SolarTermsActivityPanel.vue', import.meta.url), 'utf8'))
const ast = ts.createSourceFile('solar.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const statements = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  || (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ['watch', 'onMounted', 'onUnmounted'].includes(node.expression.expression.getText(ast))))
const code = ts.transpileModule(statements.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const flush = () => new Promise(resolve => setImmediate(resolve))
const start = coreConfig.solarTermsConfig.get(401).startTime
const end = coreConfig.solarTermsConfig.get(401).endTime
const snapshot = () => ({ version: 'v2', terms: [{ id: 401, startTime: start, endTime: end, claimable: true, answerable: true }], claimableCount: 1 })
function fixture(api = {}) {
  const ref = value => ({ value })
  const hooks = {}
  const calls = []
  const events = []
  const context = vm.createContext({
    currentAccountId: ref('a'), solar: ref(null), busy: ref(false), error: ref(''),
    generation: 0, disposed: false, timer: undefined,
    Date: class extends Date { static now() { return start * 1000 } },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    onMounted: fn => { hooks.mount = fn },
    onUnmounted: fn => { hooks.unmount = fn },
    watch: (_source, callback) => { hooks.account = callback },
    setInterval: fn => { hooks.poll = fn; return 1 },
    clearInterval() { hooks.stopped = true },
    toast: { success: message => events.push(message), error: message => events.push(message) },
    api: {
      get: async (...args) => { calls.push(['get', ...args]); return api.get ? api.get(...args) : { data: { ok: true, solarTerms: snapshot() } } },
      post: async (...args) => { calls.push(['post', ...args]); return api.post ? api.post(...args) : { data: { ok: true, correct: true, solarTerms: snapshot() } } },
    },
  })
  vm.runInContext(code, context)
  return { context, hooks, calls, events }
}

test('refresh, manual answer and polling share a busy guard and hide/expiry/unmount stop requests', async () => {
  let finish
  const f = fixture({ get: () => new Promise(resolve => { finish = resolve }) })
  const pending = f.context.refresh()
  await f.context.answer({ id: 401, optionIndex: 0 })
  f.context.poll()
  assert.equal(f.calls.length, 1)
  finish({ data: { ok: true, solarTerms: snapshot() } })
  await pending
  f.context.document.visibilityState = 'hidden'
  f.context.poll()
  assert.equal(f.calls.length, 1)
  f.context.document.visibilityState = 'visible'
  f.context.solar.value.terms[0].endTime = start - 1
  f.context.poll()
  assert.equal(f.calls.length, 1)
  f.hooks.unmount()
  await f.context.refresh()
  assert.equal(f.calls.length, 1)
  assert.equal(f.hooks.stopped, true)
});

test('switching accounts while a request is pending discards its response and refreshes the new account', async () => {
  let finish
  let count = 0
  const f = fixture({ get: () => ++count === 1
    ? new Promise(resolve => { finish = resolve })
    : Promise.resolve({ data: { ok: true, solarTerms: { ...snapshot(), fixtureAccount: 'b' } } }) })
  const pending = f.context.refresh()
  f.context.currentAccountId.value = 'b'
  await f.hooks.account()
  finish({ data: { ok: true, solarTerms: { ...snapshot(), fixtureAccount: 'a' } } })
  await pending
  await flush()
  assert.equal(f.context.solar.value.fixtureAccount, 'b')
  assert.equal(f.calls.length, 2)
});

test('successful base claim with failed V2 refresh keeps quiz state and warning on the page', async () => {
  const f = fixture({ post: async () => ({ data: {
    ok: true, solarTerms: { terms: [{ id: 401, status: 3 }] }, refreshWarning: '新版状态刷新失败',
  } }) })
  await f.context.refresh()
  await f.context.claim({ id: 401 })
  assert.equal(f.context.solar.value.version, 'v2')
  assert.equal(f.context.solar.value.terms[0].answerable, true)
  assert.equal(f.context.solar.value.terms[0].directClaimed, true)
  assert.equal(f.context.solar.value.claimableCount, 0)
  assert.equal(f.context.solar.value.warning, '新版状态刷新失败')
});

test('manual answer sends zero unchanged, consumes server state and surfaces rejected reads', async () => {
  const f = fixture({ post: async () => ({ data: { ok: true, correct: true, solarTerms: { ...snapshot(), claimableCount: 0 } } }) })
  await f.context.answer({ id: 401, optionIndex: 0 })
  assert.equal(f.calls[0][2].optionIndex, 0)
  assert.equal(f.context.solar.value.claimableCount, 0)
  assert.deepEqual(f.events, ['答题正确，奖励已发放'])
  const failed = fixture({ get: async () => ({ data: { ok: false, error: 'fixture read failure' } }) })
  await failed.context.refresh()
  assert.equal(failed.context.solar.value, null)
  assert.equal(failed.context.error.value, 'fixture read failure')
});

test('frontend and backend derive quiz switch visibility from the same bundled windows', () => {
  const source = readFileSync(new URL('../src/constants/solar-terms.ts', import.meta.url), 'utf8')
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: () => ({ default: config }), Date,
  })
  for (const term of coreConfig.solarTermsConfig.values()) {
    for (const seconds of [term.startTime - 1, term.startTime, term.endTime, term.endTime + 1]) {
      assert.equal(exports.isSolarQuizActive(seconds * 1000), coreConfig.isSolarQuizActive(seconds))
    }
  }
});

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { milkTeaActivity } from './helpers/milk-tea-data.mjs'

const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const constants = { exports: {} }
vm.runInNewContext(transpile(readFileSync(new URL('../src/constants/activity-windows.ts', import.meta.url), 'utf8')), constants)
const { MILK_TEA_ACTIVITY_WINDOW, MILK_TEA_BUSINESS_WINDOW, MILK_TEA_AUTOMATION_OPTIONS, isWithinActivityWindowMs } = constants.exports
const helpers = { exports: {} }
vm.runInNewContext(transpile(readFileSync(new URL('../src/utils/milk-tea.ts', import.meta.url), 'utf8')), helpers)
const source = readFileSync(new URL('../src/components/activity/MilkTeaActivityPanel.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = ts.createSourceFile('MilkTea.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const statements = script.statements.filter((node) => {
  if (ts.isFunctionDeclaration(node))
    return ['refresh', 'act', 'open', 'visible', 'acceptActivity', 'refreshContext', 'loadRecords'].includes(node.name?.text)
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression))
    return false
  const name = node.expression.expression.getText(script)
  return ['onMounted', 'onUnmounted'].includes(name) || (name === 'watch' && node.expression.arguments[0].getText(script).includes('accounts.currentAccountId'))
})
const code = transpile(statements.map(node => node.getText(script)).join('\n'))
const ref = value => ({ value })
const flush = () => new Promise(resolve => setImmediate(resolve))

function fixture(api = {}) {
  let time = MILK_TEA_ACTIVITY_WINDOW.startMs + 1000
  const hooks = {}
  const listeners = new Map()
  const events = []
  const state = ref(null)
  const now = ref(time)
  const lastUpdated = ref(0)
  const nowSec = { get value() {
    return state.value && lastUpdated.value ? Number(state.value.serverTime) + Math.max(0, now.value - lastUpdated.value) / 1000 : now.value / 1000
  } }
  const context = vm.createContext({
    ...helpers.exports,
    accounts: { currentAccountId: 'a' },
    state,
    loading: ref(false),
    busy: ref(false),
    error: ref(''),
    modal: ref(''),
    records: ref(null),
    now,
    nowSec,
    lastUpdated,
    generation: 0,
    recordsRevision: 0,
    active: { get value() { return !state.value || ['business', 'settling'].includes(helpers.exports.teaPhase(state.value, nowSec.value)) } },
    automation: ref(null),
    logs: ref([]),
    contextLoading: ref(false),
    contextError: ref(''),
    craftInitialUids: ref([]),
    tab: ref('shop'),
    hireDuration: ref(1),
    hireSlot: ref(0),
    availableSlots: { get value() { return state.value ? helpers.exports.teaOpenSlots(state.value, nowSec.value) : [] } },
    MILK_TEA_ACTIVITY_WINDOW,
    isWithinActivityWindowMs: (window, now = time) => isWithinActivityWindowMs(window, now),
    Date: class extends Date { static now() { return time } },
    document: { hidden: false, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) },
    window: { addEventListener() {}, removeEventListener() {} },
    onMounted: (fn) => { hooks.mount = fn },
    onUnmounted: (fn) => { hooks.unmount = fn },
    watch: (_source, fn) => { hooks.account = fn },
    setInterval: (fn, ms) => {
      hooks.poll = fn
      hooks.interval = ms
      return 1
    },
    clearInterval: () => { hooks.stopped = true },
    emit: (...args) => events.push(args),
    api: {
      get: async (path, options) => {
        if (path === '/api/activity/milk-tea')
          return api.get ? api.get(path, options) : { data: { ok: true, activity: milkTeaActivity(options.headers['x-account-id']) } }
        if (api.contextGet)
          return api.contextGet(path, options)
        return { data: { ok: true, data: path === '/api/settings' ? { automation: {} } : [] } }
      },
      post: api.post || (async () => ({ data: { ok: true, activity: milkTeaActivity() } })),
    },
  })
  vm.runInContext(code, context)
  return { context, hooks, listeners, events, setTime: (value) => {
    time = value
  } }
}

test('manual refresh and polling coalesce; hidden, missing-account and expired pages never request', async () => {
  let finish
  let calls = 0
  const f = fixture({ get: async (_url, options) => {
    calls++
    assert.equal(options.headers['x-account-id'], 'a')
    return new Promise((resolve) => {
      finish = resolve
    })
  } })
  const first = f.context.refresh()
  await f.context.refresh()
  assert.equal(calls, 1)
  finish({ data: { ok: true, activity: milkTeaActivity() } })
  await first
  assert.equal(f.context.loading.value, false)
  f.context.document.hidden = true
  await f.context.refresh()
  f.context.document.hidden = false
  f.context.accounts.currentAccountId = null
  await f.context.refresh()
  f.context.accounts.currentAccountId = 'a'
  f.setTime(MILK_TEA_ACTIVITY_WINDOW.endMs + 1)
  await f.context.refresh()
  assert.equal(calls, 1)
})

test('mutation cannot repeat or overlap refresh and old account replies cannot update a new account', async () => {
  let finish
  let posts = 0
  let reads = 0
  const f = fixture({
    get: async (_url, options) => {
      reads++
      return { data: { ok: true, activity: milkTeaActivity(options.headers['x-account-id']) } }
    },
    post: async (_url, _body, options) => {
      posts++
      assert.equal(options.headers['x-account-id'], 'a')
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })
  f.context.state.value = milkTeaActivity()
  const first = f.context.act('cashier')
  await f.context.act('cashier')
  await f.context.refresh()
  await f.context.open('rank')
  assert.equal(posts, 1)
  assert.equal(reads, 0)
  f.context.accounts.currentAccountId = 'b'
  f.hooks.account()
  await flush()
  finish({ data: { ok: true, activity: milkTeaActivity() } })
  await first
  assert.equal(f.context.state.value.account, 'b')
  assert.equal(f.context.busy.value, false)
  f.setTime(MILK_TEA_ACTIVITY_WINDOW.endMs + 1)
  await f.context.act('cashier')
  await f.context.open('rank')
  assert.equal(posts, 1)
})

test('business failures show an error, release guards and allow retry', async () => {
  const f = fixture({ get: async () => ({ data: { ok: false, error: '协议读取失败' } }) })
  await f.context.refresh()
  assert.equal(f.context.error.value, '协议读取失败')
  assert.equal(f.context.state.value, null)
  assert.equal(f.context.loading.value, false)
  f.context.api.get = async () => ({ data: { ok: true, activity: milkTeaActivity() } })
  await f.context.refresh()
  assert.equal(f.context.error.value, '')
  f.context.api.post = async () => {
    throw new Error('资源不足')
  }
  await f.context.act('buy', { goodsId: '301', count: 1 })
  assert.equal(f.context.error.value, '资源不足')
  assert.equal(f.context.busy.value, false)
})

test('visible page polls every 15 seconds, resumes immediately and stops at expiry or unmount', async () => {
  let calls = 0
  const f = fixture({ get: async () => {
    calls++
    return { data: { ok: true, activity: milkTeaActivity() } }
  } })
  f.hooks.mount()
  await flush()
  assert.equal(f.hooks.interval, 15000)
  assert.equal(calls, 1)
  f.context.document.hidden = true
  f.hooks.poll()
  await flush()
  assert.equal(calls, 1)
  f.context.document.hidden = false
  f.listeners.get('visibilitychange')()
  await flush()
  assert.equal(calls, 2)
  f.hooks.poll()
  await flush()
  assert.equal(calls, 3)
  f.setTime(MILK_TEA_ACTIVITY_WINDOW.endMs + 1)
  f.hooks.poll()
  assert.equal(f.hooks.stopped, true)
  assert.equal(f.events[0][0], 'back')
  f.hooks.unmount()
  assert.equal(f.listeners.size, 0)
})

test('successful operations keep the existing endpoint and refresh the authoritative state', async () => {
  const calls = []
  const next = milkTeaActivity('a', { balances: [{ id: '1041', count: '1010' }] })
  const f = fixture({ post: async (path, body, options) => {
    calls.push({ path, body, options })
    return { data: { ok: true, activity: next } }
  } })
  f.context.state.value = milkTeaActivity()
  f.context.modal.value = 'craft'
  await f.context.act('craft', { fruitUids: ['11'] })
  await flush()
  assert.equal(calls[0].path, '/api/activity/milk-tea/operate')
  assert.equal(calls[0].options.headers['x-account-id'], 'a')
  assert.deepEqual(Array.from(calls[0].body.params.fruitUids), ['11'])
  assert.equal(f.context.state.value.balances[0].count, '1010')
  assert.equal(f.context.modal.value, '')
})

test('incomplete responses never become an all-zero successful activity', async () => {
  const f = fixture({ get: async () => ({ data: { ok: true, activity: {} } }) })
  await f.context.refresh()
  assert.equal(f.context.state.value, null)
  assert.match(f.context.error.value, /不完整/)
})

test('paid, unknown-material, over-limit and settlement operations are rejected before POST', async () => {
  let calls = 0
  const f = fixture({ post: async () => {
    calls++
    return { data: { ok: true, activity: milkTeaActivity() } }
  } })
  f.context.state.value = milkTeaActivity()
  f.context.state.value.goods[0].paid = true
  await f.context.act('buy', { goodsId: '301', count: 1 })
  assert.match(f.context.error.value, /钻石/)
  await f.context.act('craft', { fruitUids: ['999'] })
  assert.match(f.context.error.value, /果实批次/)
  f.context.state.value.goods[0].paid = false
  await f.context.act('buy', { goodsId: '301', count: 13 })
  assert.match(f.context.error.value, /范围/)
  f.setTime(MILK_TEA_BUSINESS_WINDOW.endMs + 1000)
  await f.context.act('boost')
  assert.match(f.context.error.value, /结算期/)
  assert.equal(calls, 0)
})

test('record requests retain duration/page parameters and ignore old account responses', async () => {
  let finish
  const calls = []
  const f = fixture({ post: async (path, body, options) => {
    calls.push({ path, body, options })
    return new Promise((resolve) => {
      finish = resolve
    })
  } })
  f.context.state.value = milkTeaActivity()
  const first = f.context.open('hireList')
  await flush()
  assert.equal(calls[0].body.params.durationId, 1)
  assert.equal(calls[0].options.headers['x-account-id'], 'a')
  f.context.accounts.currentAccountId = 'b'
  f.hooks.account()
  await flush()
  finish({ data: { ok: true, duration_id: 1, friends: [], robots: [] } })
  await first
  assert.equal(f.context.records.value, null)
  assert.equal(f.context.state.value.account, 'b')
  assert.equal(f.context.busy.value, false)
})

test('auxiliary reads are account-scoped, coalesced and cannot overwrite new account context', async () => {
  const pending = []
  const f = fixture({ contextGet: async (path, options) => new Promise(resolve => pending.push({ path, options, resolve })) })
  f.context.state.value = milkTeaActivity()
  const first = f.context.refreshContext()
  await f.context.refreshContext()
  assert.equal(pending.length, 2)
  assert.equal(pending[1].options.params.keyword, '奶茶热销中')
  f.context.accounts.currentAccountId = 'b'
  f.hooks.account()
  await flush()
  assert.equal(pending.length, 4)
  assert.equal(pending[2].options.headers['x-account-id'], 'b')
  pending[0].resolve({ data: { ok: true, data: { automation: { milk_tea_cashier: true } } } })
  pending[1].resolve({ data: { ok: true, data: [{ accountId: 'a', ts: 1, msg: '奶茶热销中领取', meta: { module: 'activity' } }] } })
  await first
  assert.equal(f.context.automation.value, null)
  pending[2].resolve({ data: { ok: true, data: { automation: { milk_tea_cashier: false } } } })
  pending[3].resolve({ data: { ok: true, data: [] } })
  await flush()
  assert.equal(f.context.automation.value.milk_tea_cashier, false)
  assert.equal(f.context.logs.value.length, 0)
  assert.equal(f.context.contextLoading.value, false)
})

test('context failures remain separate from activity state and the next poll can recover', async () => {
  let failed = true
  const f = fixture({ contextGet: async (path) => {
    if (failed)
      throw new Error('context failed')
    return { data: { ok: true, data: path === '/api/settings' ? { automation: {} } : [] } }
  } })
  await f.context.refresh()
  await flush()
  assert.equal(f.context.state.value.account, 'a')
  assert.match(f.context.contextError.value, /读取失败/)
  assert.equal(f.context.error.value, '')
  failed = false
  await f.context.refreshContext()
  assert.equal(f.context.contextError.value, '')
})

test('both automation pages share all milk tea keys and business-phase visibility', () => {
  assert.equal(MILK_TEA_AUTOMATION_OPTIONS.length, 12)
  assert.equal(MILK_TEA_AUTOMATION_OPTIONS.find(item => item.key === 'milk_tea_interact').businessOnly, true)
  assert.equal(MILK_TEA_AUTOMATION_OPTIONS.filter(item => !item.businessOnly).length, 6)
  for (const file of ['AccountFeatureSettings.vue', 'AutomationSettingsTab.vue']) {
    const page = readFileSync(new URL(`../src/components/settings/${file}`, import.meta.url), 'utf8')
    assert.match(page, /MILK_TEA_AUTOMATION_OPTIONS\.filter/)
    assert.match(page, /v-if="showMilkTeaActivity"/)
    assert.match(page, /!setting.businessOnly \|\| showMilkTeaBusiness.value/)
    assert.match(page, /v-if="showMilkTeaBusiness && [^"]*\.automation\.milk_tea_interact"[^>]*v-model="[^"]*\.automation\.milk_tea_interaction_type"/)
  }
  for (const window of [MILK_TEA_ACTIVITY_WINDOW, MILK_TEA_BUSINESS_WINDOW]) {
    assert.equal(isWithinActivityWindowMs(window, window.startMs - 1), false)
    assert.equal(isWithinActivityWindowMs(window, window.startMs), true)
    assert.equal(isWithinActivityWindowMs(window, window.endMs), true)
    assert.equal(isWithinActivityWindowMs(window, window.endMs + 1), false)
  }
})

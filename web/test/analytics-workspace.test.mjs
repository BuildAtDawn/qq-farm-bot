import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, reactive, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'

const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

test('analytics owns the research entry and legacy links preserve queries while selecting research', () => {
  const exports = {}
  vm.runInNewContext(transpile(read('utils/analytics-tabs.ts')), { exports })
  assert.equal(exports.resolveAnalyticsTab('mutations'), 'mutations')
  assert.equal(exports.resolveAnalyticsTab('crops'), 'crops')
  for (const value of [undefined, null, '', 'invalid', ['mutations']])
    assert.equal(exports.resolveAnalyticsTab(value), 'strategy')
  assert.equal(exports.analyticsTabs.length, 4)
  assert.doesNotMatch(read('router/menu.ts'), /path: 'mutations'/)
  assert.match(read('router/index.ts'), /path: '\/mutations'[\s\S]*?query: \{ \.\.\.to.query, tab: 'mutations' \}/)
  const analytics = read('views/Analytics.vue')
  assert.match(analytics, /<Mutations v-if="activeTab === 'mutations'"/)
  assert.match(analytics, /useRoute\(\)/)
  assert.match(analytics, /router.replace\(/)
  assert.match(read('views/Mutations.vue'), /<MutationTestCard :account-id="account.currentAccountId"/)
  const settings = read('components/settings/AccountFeatureSettings.vue')
  assert.doesNotMatch(settings, /MutationTestCard/)
  assert.match(settings, /useMutationResource[\s\S]*?'\/api\/mutation-test'/)
  assert.match(settings, /!mutationTestState.value \|\| !!mutationTestError.value \|\| mutationTestState.value.enabled/)
})

const { descriptor } = parse(read('components/settings/MutationTestCard.vue'))
test('mutation setup explains resource-consuming automation and uses a responsive scrollable dialog', () => {
  const template = descriptor.template.content
  for (const text of ['开启后自动执行', '普通肥', '有机肥', '不会自动购买种子或化肥', '不保证获得变异', '所有已解锁土地均为空地', '目标测试株数', '不是执行轮数', '关闭弹窗或离开页面不会停止', '已消耗的资源不会退回', '任务不会自动恢复'])
    assert.ok(template.includes(text), text)
  assert.match(template, /aria-describedby="mutation-test-consumption"/)
  assert.match(template, /hint="0–60000 毫秒/)
  const css = descriptor.styles[0].content
  assert.match(css, /overflow-y: auto/)
  assert.match(css, /100dvh/)
  assert.match(css, /@media \(max-width: 540px\)/)
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/)
})

const cardScript = transpile(`${descriptor.scriptSetup.content}
export { command, configure, startDisabled, seedId, target, delayMs, pending, open, commandError, conflict };`)
function fixture() {
  const props = reactive({ accountId: 'a' })
  const account = reactive({ currentAccount: { running: true } })
  const resources = {
    '/api/mutation-test': { data: ref({ enabled: false, status: 'idle' }), error: ref(''), loading: ref(false) },
    '/api/settings': { data: ref({ automation: { farm: false, fertilizer: 'none', land_upgrade: false, fertilizer_2x2_ripen: false } }), error: ref(''), loading: ref(false) },
    '/api/mutation-test/seeds': { data: ref([{ seedId: 20002, name: 'Test seed', count: 10 }]), error: ref(''), loading: ref(false) },
  }
  const calls = []
  const api = { post: async (...args) => {
    calls.push(args)
    return { data: { ok: true, data: { enabled: true, status: 'running' } } }
  } }
  const exports = {}
  vm.runInNewContext(cardScript, {
    exports,
    defineProps: () => props,
    defineEmits: () => () => {},
    require: name => ({
      'vue': { computed, ref, watch, onUnmounted: () => {} },
      '@/api': { default: api },
      '@/stores/account': { useAccountStore: () => account },
      '@/composables/useMutationResource': { useMutationResource: (_id, endpoint) => ({
        ...resources[endpoint],
        refresh: async () => {},
        invalidate: () => {},
      }) },
    })[name] || {},
  })
  exports.configure()
  exports.seedId.value = 20002
  return { ...exports, props, account, resources, calls, api }
}

test('research start fails closed on unknown settings and blocks each conflicting automation', async () => {
  for (const key of ['farm', 'fertilizer', 'land_upgrade', 'fertilizer_2x2_ripen']) {
    const f = fixture()
    f.resources['/api/settings'].data.value.automation[key] = key === 'fertilizer' ? 'normal' : true
    assert.equal(f.startDisabled.value, true)
    await f.command('start')
    assert.equal(f.calls.length, 0)
  }
  for (const mode of ['missing', 'error', 'loading', 'offline', 'inventory']) {
    const f = fixture()
    if (mode === 'missing')
      f.resources['/api/settings'].data.value = null
    if (mode === 'error')
      f.resources['/api/settings'].error.value = 'unavailable'
    if (mode === 'loading')
      f.resources['/api/settings'].loading.value = true
    if (mode === 'offline')
      f.account.currentAccount.running = false
    if (mode === 'inventory')
      f.target.value = 11
    await f.command('start')
    assert.equal(f.calls.length, 0, mode)
  }
})

test('valid research starts use the existing endpoint and cannot overlap; account switches discard old replies', async () => {
  const f = fixture()
  assert.equal(f.startDisabled.value, false)
  let finish
  f.api.post = (...args) => {
    f.calls.push(args)
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const started = f.command('start')
  await f.command('start')
  assert.equal(f.calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), [
    '/api/mutation-test/start',
    { seedId: 20002, target: 1, delayMs: 200 },
    { headers: { 'x-account-id': 'a' }, timeout: 60000 },
  ])
  f.props.accountId = 'b'
  assert.equal(f.open.value, false)
  assert.equal(f.seedId.value, '')
  finish({ data: { ok: true, data: { enabled: true, status: 'running', seedName: 'Old account' } } })
  await started
  assert.equal(f.resources['/api/mutation-test'].data.value.enabled, false)
  assert.equal(f.pending.value, false)
})

test('research stop remains available when planting settings conflict or cannot load', async () => {
  const f = fixture()
  f.resources['/api/mutation-test'].data.value = { enabled: true, status: 'running' }
  f.resources['/api/settings'].error.value = 'unavailable'
  await f.command('stop')
  assert.equal(f.calls[0][0], '/api/mutation-test/stop')
})

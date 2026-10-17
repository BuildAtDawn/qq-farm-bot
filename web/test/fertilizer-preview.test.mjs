/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function evaluate(source, imports = {}) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => imports[name], console })
  return exports
}
const lock = evaluate(readFileSync(new URL('../src/utils/bag-lock.ts', import.meta.url), 'utf8'))
const helpers = evaluate(readFileSync(new URL('../src/utils/fertilizer-preview.ts', import.meta.url), 'utf8'), { './bag-lock': lock })
const operations = evaluate(readFileSync(new URL('../src/utils/dashboard-operations.ts', import.meta.url), 'utf8'))
const H = 3600
const normal = { id: 80003, name: '化肥(8小时)', usable: true, fertilizerRefill: { pool: 'normal', containerId: 1011, capacitySeconds: 999 * H, secondsPerItem: 8 * H } }

test('preview preserves exact second boundaries, pool separation and unlocked stock', () => {
  const containers = { normal: { seconds: 983 * H + 1, capacitySeconds: 999 * H }, organic: { seconds: 999 * H, capacitySeconds: 999 * H } }
  const stock = [{ id: 80003, count: 10 }, { id: 80003, count: 10, locked: true }]
  const preview = helpers.fertilizerUsePreview(normal, containers, stock, 1)
  assert.equal(preview.maxCount, 1)
  assert.equal(preview.addedSeconds, 8 * H)
  assert.equal(preview.afterSeconds, 991 * H + 1)
  assert.equal(preview.valid, true)
  assert.equal(helpers.fertilizerUsePreview(normal, containers, stock, 2).valid, false)
  containers.normal.seconds = 983 * H
  assert.equal(helpers.fertilizerUsePreview(normal, containers, stock, 2).afterSeconds, 999 * H)
  assert.equal(helpers.fertilizerUsePreview(normal, containers, [{ id: 80003, count: 1 }], 2).maxCount, 1)
})

test('unknown capacity and invalid quantities cannot create a valid preview', () => {
  assert.equal(helpers.fertilizerUsePreview({ id: 100003 }, null, [], 1), null)
  assert.equal(helpers.fertilizerUsePreview(normal, null, [{ id: 80003, count: 1 }], 1).ready, false)
  const containers = { normal: { seconds: 0, capacitySeconds: 999 * H } }
  for (const quantity of ['', 0, -1, 1.5, Infinity, 'bad'])
    assert.equal(helpers.fertilizerUsePreview(normal, containers, [{ id: 80003, count: 10 }], quantity).valid, false)
  assert.equal(helpers.formatFertilizerHours(8 * H), '8 h')
  assert.equal(helpers.formatFertilizerHours(0), '0 h')
})

function fixture() {
  const ref = value => ({ value })
  const watchers = []
  const cleanup = []
  const calls = []
  const notifications = []
  const account = { currentAccountId: ref('a'), currentAccount: ref({ running: true }) }
  const bag = {
    items: ref([normal]),
    originalItems: ref([{ id: 80003, count: 10, uid: 7 }]),
    fertilizerContainers: { normal: { seconds: 975 * H, capacitySeconds: 999 * H } },
    loading: ref(false),
    loadedAccountId: 'a',
    error: '',
    async fetchBag(...args) { calls.push(['fetch', ...args]) },
    async useItem(...args) {
      calls.push(['use', ...args])
      return { ok: true }
    },
    clearBag() {},
  }
  const source = readFileSync(new URL('../src/components/BagPanel.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const result = evaluate(`${source}\nexports.panel = { handleUseClick, handleConfirm, confirmFertilizerUse, fertilizerDialog, fertilizerPreview, selectedCategory };`, {
    'vue': { ref, computed: fn => ({ get value() { return fn() } }), watch: (...args) => watchers.push(args), onUnmounted: fn => cleanup.push(fn) },
    'pinia': { storeToRefs: store => store },
    '@vueuse/core': { useIntervalFn() {} },
    '@/stores/account': { useAccountStore: () => account },
    '@/stores/bag': { useBagStore: () => bag },
    '@/stores/status': { useStatusStore: () => ({}) },
    '@/stores/toast': { useToastStore: () => ({ success: msg => notifications.push(msg), error: msg => notifications.push(msg), warning() {} }) },
    '@/utils/bag-lock': lock,
    '@/utils/fertilizer-preview': helpers,
  })
  return { ...result.panel, bag, account, calls, watchers, cleanup, notifications }
}

test('bag defaults to seeds and fertilizer opens with the safe maximum; reduced quantity reaches the API', async () => {
  const f = fixture()
  assert.equal(f.selectedCategory.value, 'seed')
  await f.handleUseClick(normal)
  assert.equal(f.fertilizerDialog.value.count, 3)
  assert.equal(f.calls.some(call => call[0] === 'use'), false)
  f.fertilizerDialog.value.count = 2
  await f.confirmFertilizerUse()
  assert.deepEqual(f.calls.find(call => call[0] === 'use'), ['use', 'a', 80003, 2, 0])
  assert.equal(f.fertilizerDialog.value.show, false)
})

test('invalid input, failed reads and switched accounts cannot submit fertilizer', async () => {
  const f = fixture()
  await f.handleUseClick(normal)
  for (const count of [0, 4, 1.5]) {
    f.fertilizerDialog.value.count = count
    await f.confirmFertilizerUse()
  }
  f.fertilizerDialog.value.count = 1
  f.account.currentAccountId.value = 'b'
  await f.confirmFertilizerUse()
  assert.equal(f.calls.some(call => call[0] === 'use'), false)
  const failed = fixture()
  failed.bag.error = 'fixture read failed'
  await failed.handleUseClick(normal)
  await failed.confirmFertilizerUse()
  assert.equal(failed.calls.some(call => call[0] === 'use'), false)
  assert.match(failed.fertilizerDialog.value.error, /fixture read failed/)
})

test('capacity rejection refreshes the preview and requires confirmation again', async () => {
  const f = fixture()
  await f.handleUseClick(normal)
  f.bag.useItem = async () => {
    f.bag.fertilizerContainers.normal.seconds = 995 * H
    return { ok: false, error: '容量不足' }
  }
  await f.confirmFertilizerUse()
  assert.equal(f.fertilizerDialog.value.show, true)
  assert.equal(f.fertilizerPreview.value.maxCount, 0)
  assert.match(f.fertilizerDialog.value.error, /容量不足/)
})

test('in-flight fertilizer use is single-flight and stale completion cannot notify the next account', async () => {
  const f = fixture()
  await f.handleUseClick(normal)
  let finish
  f.bag.useItem = (...args) => {
    f.calls.push(['use', ...args])
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = f.confirmFertilizerUse()
  await f.confirmFertilizerUse()
  assert.equal(f.calls.filter(call => call[0] === 'use').length, 1)
  f.account.currentAccountId.value = 'b'
  finish({ ok: true })
  await first
  assert.equal(f.notifications.length, 0)
})

test('closing the component during a read prevents late fertilizer previews', async () => {
  const f = fixture()
  let finish
  f.bag.fetchBag = () => new Promise((resolve) => {
    finish = resolve
  })
  const pending = f.handleUseClick(normal)
  f.cleanup.forEach(fn => fn())
  finish()
  await pending
  assert.equal(f.fertilizerDialog.value.count, 0)
})

test('ordinary items retain all-item use and fireworks retain single-item use', async () => {
  for (const [id, count] of [[100003, 5], [6001, 1]]) {
    const f = fixture()
    await f.handleUseClick({ id, count: 5, name: 'fixture' })
    await f.handleConfirm()
    assert.deepEqual(f.calls.find(call => call[0] === 'use'), ['use', 'a', id, count, 0])
  }
})

test('statistics prioritize populated counters without losing zero counters or mutating input', () => {
  const input = Object.freeze({ plant: 0, harvest: 5, steal: 30, water: 0, unknown: 2 })
  const result = operations.partitionOperations(input)
  assert.deepEqual(Array.from(result.active, row => row[0]), ['steal', 'harvest', 'unknown'])
  assert.deepEqual(Array.from(result.inactive, row => row[0]), ['plant', 'water'])
  assert.equal(result.active.length + result.inactive.length, Object.keys(input).length)
  assert.equal(operations.partitionOperations({ plant: 0 }).active.length, 0)
})

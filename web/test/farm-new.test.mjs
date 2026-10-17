import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { renderTea } from './helpers/milk-tea-render.mjs'

function loadModule(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => imports[name], ...globals })
  return exports
}
const { ripenLand } = loadModule('../src/utils/ripen-land.ts')
const { runRipenAll, fertilizerHours } = loadModule('../src/utils/ripen-all.ts')

test('bulk ripening requires a valid preview, follows cursors and cancels between steps', async () => {
  const preview = { token: 'test', expiresAt: Date.now() + 60000, sufficient: true, targetCount: 2, actionCount: 3 }
  const calls = []
  let cancelled = false
  const options = {
    preview, cancelled: () => cancelled, onProgress() {},
    step: async (token, cursor) => {
      calls.push([token, cursor])
      return { success: true, cursor: cursor + 1, done: cursor === 2 }
    },
  }
  assert.equal((await runRipenAll(options)).done, true)
  assert.deepEqual(calls, [['test', 0], ['test', 1], ['test', 2]])
  calls.length = 0
  options.onProgress = () => { cancelled = true }
  assert.equal(await runRipenAll(options), false)
  assert.equal(calls.length, 1)
  for (const patch of [{ sufficient: false }, { targetCount: 0 }, { expiresAt: Date.now() - 1 }])
    await assert.rejects(() => runRipenAll({ ...options, preview: { ...preview, ...patch } }))
  assert.equal(calls.length, 1)
  cancelled = false
  await assert.rejects(() => runRipenAll({ ...options, step: async () => ({ success: true, cursor: 0 }) }), /进度异常/)
  assert.equal(fertilizerHours(5400), '1.5')
})
test('partial batch progress is published before stopping and cannot send a following batch', async () => {
  let requests = 0
  let progress
  await assert.rejects(() => runRipenAll({
    preview: { token: 't', expiresAt: Date.now() + 60000, sufficient: true, targetCount: 2, actionCount: 3 },
    cancelled: () => false,
    step: async () => { requests++; return { success: true, cursor: 1, completed: 1, stopped: '土地 2 未返回最新状态' } },
    onProgress: result => { progress = result.completed },
  }), /土地 2/)
  assert.equal(progress, 1)
  assert.equal(requests, 1)
})
function ripenFixture(behavior) {
  let land = { id: 1, unlocked: true, status: 'growing', matureInSec: 3600, plantId: 123, currentSeason: 1, leftInorcFertTimes: 1 }
  let cancelled = false
  const calls = []
  return {
    calls,
    run: () => ripenLand({
      getLand: () => land, cancelled: () => cancelled,
      fertilize: async (type) => {
        calls.push(type)
        const response = await behavior({ type, index: calls.length, land, cancel: () => { cancelled = true } })
        if (response?.updatedLand)
          land = response.updatedLand
        return response
      },
    }),
  }
}
function reply(land, extra = {}) {
  return { updatedLand: land, fertilizerRemainingSec: 9999, ...extra }
}

test('ripens one land with normal first and repeated organic until confirmed maturity', async () => {
  const f = ripenFixture(({ type, index, land }) => reply({ ...land,
    matureInSec: type === 'normal' ? 2000 : index === 2 ? 1000 : 0,
    status: index === 3 ? 'harvestable' : 'growing',
  }))
  const result = await f.run()
  assert.deepEqual(f.calls, ['normal', 'organic', 'organic'])
  assert.equal(result.matured, true)
  assert.equal(result.normalCount, 1)
  assert.equal(result.organicCount, 2)
})
test('normal failure still allows organic', async () => {
  const f = ripenFixture(({ type, land }) => type === 'normal' ? false : reply({ ...land, status: 'harvestable', matureInSec: 0 }))
  assert.equal((await f.run()).matured, true)
  assert.deepEqual(f.calls, ['normal', 'organic'])
})
test('stops on no progress, unavailable fertilizer, depletion or missing authoritative land', async () => {
  for (const [response, expected] of [
    [land => reply({ ...land }), 'no-progress'],
    [() => false, 'unavailable'],
    [land => reply({ ...land, matureInSec: 500 }, { fertilizerRemainingSec: 0 }), 'empty'],
    [() => reply(null), 'unconfirmed'],
  ]) {
    const f = ripenFixture(({ type, land }) => type === 'normal' ? false : response(land))
    const result = await f.run()
    assert.equal(result.stopped, expected)
    assert.equal(result.matured, false)
    assert.deepEqual(f.calls, ['normal', 'organic'])
  }
})
test('cancellation while waiting prevents any subsequent fertilizer request', async () => {
  const f = ripenFixture(({ land, cancel }) => { cancel(); return reply({ ...land, matureInSec: 500 }) })
  assert.equal((await f.run()).cancelled, true)
  assert.deepEqual(f.calls, ['normal'])
})
test('changed or replaced crop cannot be reported as a successful ripening', async () => {
  const f = ripenFixture(({ land }) => reply({ ...land, plantId: 999, status: 'harvestable', matureInSec: 0 }))
  const result = await f.run()
  assert.equal(result.matured, false)
  assert.equal(result.stopped, 'changed')
  assert.equal(f.calls.length, 1)
})
test('a zero countdown without mature status never counts as confirmed maturity', async () => {
  const f = ripenFixture(({ land }) => reply({ ...land, matureInSec: 0 }))
  assert.equal((await f.run()).matured, false)
  assert.equal(f.calls.length, 1)
})

const timers = new Map()
let nextTimer = 1
const { createFarmRefreshController, normalizeRefreshSeconds } = loadModule('../src/utils/farm-new-refresh.ts', {}, {
  setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id },
  clearInterval(id) { timers.delete(id) },
})
test('refresh interval accepts only bounded whole seconds', () => {
  assert.equal(normalizeRefreshSeconds(0), 1)
  assert.equal(normalizeRefreshSeconds(1.8), 2)
  assert.equal(normalizeRefreshSeconds(99999), 3600)
  assert.equal(normalizeRefreshSeconds('bad'), 3)
})
test('manual and timer refresh coalesce, and account switches do not wait on previous accounts', async () => {
  let accountId = 'a'
  const calls = []
  const completions = new Map()
  const controller = createFarmRefreshController({
    getAccountId: () => accountId, canRefresh: () => true, onError: () => {},
    refresh: id => new Promise(resolve => { calls.push(id); completions.set(id, resolve) }),
  })
  const first = controller.run()
  assert.equal(controller.run(), first)
  await Promise.resolve()
  accountId = 'b'
  const second = controller.run()
  await Promise.resolve()
  assert.deepEqual(calls, ['a', 'b'])
  completions.get('b')()
  completions.get('a')()
  await Promise.all([first, second])
})
test('hidden/unmounted/busy pages cannot poll and stopping removes the timer', async () => {
  let allowed = false
  let count = 0
  const controller = createFarmRefreshController({
    getAccountId: () => 'a', canRefresh: () => allowed,
    refresh: async () => { count++ }, onError: () => {},
  })
  controller.start(3)
  const tick = [...timers.values()][0]
  tick()
  await controller.run()
  assert.equal(count, 0)
  allowed = true
  await controller.run()
  assert.equal(count, 1)
  controller.stop()
  assert.equal(timers.size, 0)
})
test('failed refresh releases concurrency guard and permits retry', async () => {
  let count = 0
  let errors = 0
  const controller = createFarmRefreshController({
    getAccountId: () => 'a', canRefresh: () => true,
    refresh: async () => { count++; throw new Error('fixture') }, onError: () => { errors++ },
  })
  await controller.run()
  await controller.run()
  assert.equal(count, 2)
  assert.equal(errors, 2)
})

function storeFixture() {
  const account = { currentAccountId: 'a' }
  let get = async () => ({ data: { ok: true, data: { lands: [], summary: {} } } })
  let post = async () => ({ data: { ok: true } })
  const api = { get: (...args) => get(...args), post: (...args) => post(...args) }
  const exports = loadModule('../src/stores/farm.ts', {
    vue: { ref: value => ({ value }) },
    pinia: { defineStore: (_name, setup) => setup },
    '@/api': { default: api },
    '@/stores/account': { useAccountStore: () => account },
  })
  return {
    store: exports.useFarmStore(), account,
    setGet: fn => { get = fn }, setPost: fn => { post = fn },
  }
}
const growingLand = { id: 1, unlocked: true, plantId: 123, currentSeason: 1, status: 'growing', matureInSec: 3600, phaseStartTime: 100 }
const landResponse = lands => ({ data: { ok: true, data: { lands, summary: {} } } })

test('old land responses cannot overwrite a newer request or a switched account', async () => {
  const f = storeFixture()
  const finish = []
  f.setGet(() => new Promise(resolve => finish.push(resolve)))
  const oldRequest = f.store.fetchLands('a')
  const newRequest = f.store.fetchLands('a')
  finish[1](landResponse([{ ...growingLand, matureInSec: 100 }]))
  await newRequest
  finish[0](landResponse([growingLand]))
  await oldRequest
  assert.equal(f.store.lands.value[0].matureInSec, 100)
  const switchedRequest = f.store.fetchLands('a')
  f.account.currentAccountId = 'b'
  f.store.clearFarmData()
  finish[2](landResponse([growingLand]))
  await switchedRequest
  assert.equal(f.store.lands.value.length, 0)
  assert.equal(f.store.loading.value, false)
})
test('a successful fertilizer reply survives an older AllLands reply and updates summary', async () => {
  const f = storeFixture()
  f.setGet(async () => landResponse([growingLand]))
  await f.store.fetchLands('a')
  f.setPost(async () => ({ data: { ok: true, data: {
    success: true, updatedLand: { ...growingLand, status: 'harvestable', matureInSec: 0 },
  } } }))
  await f.store.applyFertilizer('a', 1, 'organic')
  await f.store.fetchLands('a')
  assert.equal(f.store.lands.value[0].status, 'harvestable')
  assert.equal(f.store.summary.value.harvestable, 1)
  assert.equal(f.store.summary.value.growing, 0)
  // A genuinely new planting must override the overlay even for the same seed and season.
  f.setGet(async () => landResponse([{ ...growingLand, phaseStartTime: 200 }]))
  await f.store.fetchLands('a')
  assert.equal(f.store.lands.value[0].status, 'growing')
})
test('old fertilizer replies cannot update a switched-and-restored account', async () => {
  const f = storeFixture()
  f.store.lands.value = [{ ...growingLand }]
  let finish
  f.setPost(() => new Promise(resolve => { finish = resolve }))
  const pending = f.store.applyFertilizer('a', 1, 'organic')
  assert.equal(await f.store.applyFertilizer('a', 1, 'organic'), false)
  f.account.currentAccountId = 'b'
  f.store.clearFarmData()
  f.account.currentAccountId = 'a'
  f.store.clearFarmData()
  finish({ data: { ok: true, data: { success: true, updatedLand: growingLand } } })
  assert.equal(await pending, false)
  assert.equal(f.store.lands.value.length, 0)
  assert.equal(f.store.fertilizePending.value, false)
})
test('bulk fertilizer replies share the single-flight guard, update overlays and ignore a switched account', async () => {
  const f = storeFixture()
  const secondLand = { ...growingLand, id: 2 }
  f.store.lands.value = [{ ...growingLand }, secondLand]
  let finish
  f.setPost(() => new Promise(resolve => { finish = resolve }))
  const first = f.store.ripenAllStep('a', 'token', 0)
  await assert.rejects(() => f.store.ripenAllStep('a', 'token', 0), /正在执行/)
  assert.equal(await f.store.applyFertilizer('a', 1, 'organic'), false)
  finish({ data: { ok: true, data: { success: true, landIds: [1, 2],
    updatedLands: [growingLand, secondLand].map(item => ({ ...item, status: 'harvestable', matureInSec: 0 })) } } })
  await first
  assert.equal(f.store.lands.value[0].status, 'harvestable')
  assert.equal(f.store.lands.value[1].status, 'harvestable')
  assert.equal(f.store.summary.value.harvestable, 2)
  f.setGet(async () => landResponse([growingLand, secondLand]))
  await f.store.fetchLands('a')
  assert.equal(f.store.lands.value[0].status, 'harvestable')
  assert.equal(f.store.lands.value[1].status, 'harvestable')
  const old = f.store.ripenAllStep('a', 'token', 1)
  f.store.clearFarmData()
  f.account.currentAccountId = 'b'
  finish({ data: { ok: true, data: { success: true, landIds: [1, 2], updatedLands: [growingLand, secondLand] } } })
  await old
  assert.equal(f.store.lands.value.length, 0)
  assert.equal(f.store.fertilizePending.value, false)
})

test('a partially stopped batch still overlays confirmed updates without marking omitted lands mature', async () => {
  const f = storeFixture()
  f.store.lands.value = [{ ...growingLand }, { ...growingLand, id: 2 }]
  f.setPost(async () => ({ data: { ok: true, data: { success: true, landIds: [1, 2], stopped: 'missing land 2',
    updatedLands: [{ ...growingLand, status: 'harvestable', matureInSec: 0 }] } } }))
  const result = await f.store.ripenAllStep('a', 'token', 0)
  assert.equal(result.stopped, 'missing land 2')
  assert.equal(f.store.lands.value[0].status, 'harvestable')
  assert.equal(f.store.lands.value[1].status, 'growing')
  assert.equal(f.store.summary.value.harvestable, 1)
})
test('failed land reads expose an error instead of a successful empty farm', async () => {
  const f = storeFixture()
  f.setGet(async () => ({ data: { ok: false, error: 'fixture API failure' } }))
  assert.equal(await f.store.fetchLands('a'), false)
  assert.equal(f.store.loaded.value, false)
  assert.equal(f.store.error.value, 'fixture API failure')
  assert.equal(f.store.loading.value, false)
})

const { canNormalFertilize } = loadModule('../src/utils/ripen-land.ts')
test('ordinary fertilizer is available only with a confirmed positive remaining count', () => {
  for (const remaining of [0, -1, null, undefined, 'bad'])
    assert.equal(canNormalFertilize({ ...growingLand, leftInorcFertTimes: remaining }), false)
  assert.equal(canNormalFertilize({ ...growingLand, leftInorcFertTimes: 1 }), true)
  assert.equal(canNormalFertilize({ ...growingLand, leftInorcFertTimes: '1' }), true)
  assert.equal(canNormalFertilize({ ...growingLand, status: 'harvestable', leftInorcFertTimes: 1 }), false)
})
test('ripening skips ordinary fertilizer when it has already been used', async () => {
  let land = { ...growingLand, leftInorcFertTimes: 0 }
  const calls = []
  const result = await ripenLand({
    getLand: () => land, cancelled: () => false,
    fertilize: async (type) => {
      calls.push(type)
      land = { ...land, status: 'harvestable', matureInSec: 0 }
      return reply(land)
    },
  })
  assert.equal(result.matured, true)
  assert.deepEqual(calls, ['organic'])
})

function panelFixture() {
  const ref = value => ({ value })
  const calls = []
  const account = { currentAccountId: ref('a'), currentAccount: ref({ running: true }) }
  const farm = {
    lands: ref([{ ...growingLand }]), summary: ref({}), loading: ref(false), loaded: ref(true), error: ref(''),
    fertilizePending: ref(false), fertilizeError: ref(''),
    async fetchBagSeeds() { return [{ seedId: 1, name: '种子', count: 3 }] },
    async plantSelectedBagSeeds(...args) { calls.push(['plantBag', ...args]); return { planted: 3, remaining: 21 } },
    async operate(...args) { calls.push(['operate', ...args]); return { ok: true } },
    async removePlant(...args) { calls.push(['remove', ...args]); return { ok: true } },
    async removeAllPlants(...args) { calls.push(['removeAll', ...args]); return { ok: true, data: { removed: 3 } } },
    async removeDeadPlants(...args) { calls.push(['removeDead', ...args]); return { ok: true, data: { removed: 1 } } },
    async applyFertilizer(...args) { calls.push(['fertilize', ...args]); return false },
  }
  const source = readFileSync(new URL('../src/components/FarmPanel.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const { outputText } = ts.transpileModule(`${source}\nexports.panel = { operations, pendingOperation, operating, requestOperation, executeOperation, handleFertilize, handleRipen, plantingMode, bagSeeds, selectedSeedIds, bagSeedsLoading, bagSeedsError, loadBagSeeds, requestRemoveLand, landView, loadPreferences, savePreferences, requestRipenAll, executeRipenAll, pendingRipenAll, clock, displayLands };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  const ripening = loadModule('../src/utils/ripen-land.ts')
  vm.runInNewContext(outputText, {
    exports,
    localStorage: { getItem: () => null, setItem() {} },
    require(name) {
      const modules = {
        'vue': { ref, computed: fn => ({ get value() { return fn() } }), watch() {}, onUnmounted() {} },
        '@vueuse/core': { useDocumentVisibility: () => ref('visible'), useIntervalFn: () => ({ pause() {} }) },
        'pinia': { storeToRefs: store => store },
        '@/stores/account': { useAccountStore: () => account },
        '@/stores/farm': { useFarmStore: () => farm },
        '@/stores/status': { useStatusStore: () => ({ realtimeConnected: true, async fetchStatus() {} }) },
        '@/stores/toast': { useToastStore: () => ({ success() {}, error() {}, warning() {} }) },
        '@/utils/ripen-land': ripening,
        '@/utils/ripen-all': { runRipenAll, fertilizerHours },
        '@/utils/farm-land-actions': loadModule('../src/utils/farm-land-actions.ts'),
        '@/utils/farm-new-refresh': { createFarmRefreshController: () => ({ start() {}, stop() {}, run() {} }) },
      }
      return modules[name] || {}
    },
  })
  return { ...exports.panel, calls, farm, account }
}
test('phase countdown uses snapshot elapsed time, clamps at zero and preserves unknown values', () => {
  const f = panelFixture()
  f.clock.value = 100000
  f.farm.lands.value = [
    { ...growingLand, snapshotAt: 90000, phaseInSec: 30 },
    { ...growingLand, id: 2, snapshotAt: 90000, phaseInSec: 5 },
    { ...growingLand, id: 3, phaseInSec: null },
    { ...growingLand, id: 4 },
  ]
  assert.deepEqual(Array.from(f.displayLands.value, land => land.phaseInSec), [20, 0, null, null])
  assert.equal(f.displayLands.value[0].matureInSec, 3590)
  f.clock.value += 1000
  assert.equal(f.displayLands.value[0].phaseInSec, 19)
})

test('standard cards combine short countdowns into one row with precise accessible descriptions', async () => {
  const land = { ...growingLand, phaseName: '初熟', currentPhaseNumber: 5, totalPhases: 6, phaseInSec: 120 }
  const html = await renderTea('../FarmNewLandCard.vue', { land, refined: true })
  assert.match(html, /第 5 阶段，共 6 阶段/)
  assert.match(html, />5\/6</)
  assert.match(html, /class="land-countdowns"/)
  assert.match(html, /本段/)
  assert.match(html, /2分/)
  assert.match(html, /1时/)
  assert.match(html, /本阶段剩余/)
  assert.match(html, /02:00/)
  assert.match(html, /距离成熟/)
  assert.doesNotMatch(html, /class="land-time |land-stage-remaining/)
  const expired = await renderTea('../FarmNewLandCard.vue', { land: { ...land, phaseInSec: 0 }, refined: true })
  assert.match(expired, /待更新/)
  const unknown = await renderTea('../FarmNewLandCard.vue', { land: { ...growingLand }, refined: true })
  assert.match(unknown, /阶段数未知/)
  assert.match(unknown, /--/)
  const compact = await renderTea('../FarmNewLandCard.vue', { land, refined: true, compact: true })
  assert.doesNotMatch(compact, /land-countdowns|本阶段剩余|第 5 阶段/)
  assert.match(compact, /1:00:00/)
  const mature = await renderTea('../FarmNewLandCard.vue', { land: { ...land, status: 'harvestable', matureInSec: 0, phaseName: '成熟' }, refined: true })
  assert.doesNotMatch(mature, /land-countdowns|class="land-time /)
})

test('short countdowns keep subminute, hour and multi-day values readable', async () => {
  for (const [seconds, text] of [[1, '1秒'], [59, '59秒'], [60, '1分'], [3599, '1时'], [3661, '1时2分'], [90000, '1天1时']]) {
    const html = await renderTea('../FarmNewLandCard.vue', {
      land: { ...growingLand, phaseInSec: seconds, matureInSec: seconds }, refined: true,
    })
    assert.ok(html.includes(text), `${seconds} seconds should display ${text}`)
  }
})

test('compact land grid adapts to available width without a four-column or width cap', () => {
  const source = readFileSync(new URL('../src/components/FarmPanel.vue', import.meta.url), 'utf8')
  const grid = source.match(/\.land-grid--compact\s*\{([^}]+)\}/)[1]
  assert.match(grid, /repeat\(auto-fill,/)
  assert.doesNotMatch(grid, /repeat\(4,|max-width/)
})

test('bulk button previews before confirmation, never harvests and rejects a confirmation after account switch', async () => {
  const f = panelFixture()
  const preview = { token: 't', expiresAt: Date.now() + 60000, targetCount: 1, actionCount: 1, sufficient: true }
  f.farm.previewRipenAll = async (...args) => { f.calls.push(['preview', ...args]); return preview }
  f.farm.ripenAllStep = async (...args) => {
    f.calls.push(['step', ...args])
    return { success: true, cursor: 1, done: true, completed: 1, total: 1, used: { normal: 3600, organic: 0 } }
  }
  f.farm.fetchLands = async () => {}
  await f.requestRipenAll()
  assert.equal(f.calls.length, 1)
  assert.equal(f.pendingRipenAll.value.preview.token, 't')
  await f.executeRipenAll()
  assert.deepEqual(f.calls.map(call => call[0]), ['preview', 'step'])
  await f.requestRipenAll()
  f.account.currentAccountId.value = 'b'
  await f.executeRipenAll()
  assert.deepEqual(f.calls.map(call => call[0]), ['preview', 'step', 'preview'])
})
test('all seven operations require confirmation and dispatch to their matching API', async () => {
  const f = panelFixture()
  assert.deepEqual(Array.from(f.operations, item => item.type), ['harvest', 'plant', 'clear', 'all', 'upgrade', 'removeDead', 'removeAll'])
  for (const operation of f.operations) {
    assert.equal(operation.label.length, 2)
    assert.ok(operation.title.length >= operation.label.length)
    const before = f.calls.length
    f.requestOperation(operation)
    assert.equal(f.calls.length, before)
    assert.equal(f.pendingOperation.value.operation.type, operation.type)
    if (operation.type === 'plant') {
      await Promise.resolve()
      f.plantingMode.value = 'strategy'
    }
    await f.executeOperation()
    assert.deepEqual(f.calls.at(-1), ['removeAll', 'removeDead'].includes(operation.type) ? [operation.type, 'a'] : ['operate', 'a', operation.type])
    assert.equal(f.pendingOperation.value, null)
    assert.equal(f.operating.value, false)
  }
})
test('bag planting requires a loaded selection and dispatches only selected seed IDs', async () => {
  const f = panelFixture()
  f.requestOperation(f.operations.find(op => op.type === 'plant'))
  await f.executeOperation()
  assert.equal(f.calls.length, 0)
  await Promise.resolve()
  assert.equal(f.bagSeedsLoading.value, false)
  assert.equal(f.plantingMode.value, 'bag')
  await f.executeOperation()
  assert.equal(f.calls.length, 0)
  f.selectedSeedIds.value = [1]
  await f.executeOperation()
  assert.deepEqual(f.calls.map(call => Array.from(call)), [['plantBag', 'a', [1]]])
})
test('reopened seed dialogs ignore the previous response and cannot dispatch after account switch', async () => {
  const f = panelFixture()
  const finish = []
  f.farm.fetchBagSeeds = () => new Promise(resolve => finish.push(resolve))
  const plant = f.operations.find(op => op.type === 'plant')
  f.requestOperation(plant)
  f.pendingOperation.value = null
  f.requestOperation(plant)
  finish[1]([{ seedId: 2, count: 3 }])
  await new Promise(resolve => setImmediate(resolve))
  finish[0]([{ seedId: 1, count: 99 }])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.bagSeeds.value[0].seedId, 2)
  f.selectedSeedIds.value = [2]
  f.account.currentAccountId.value = 'b'
  await f.executeOperation()
  assert.equal(f.calls.length, 0)
})
test('failed bag reads allow retry and never submit a planting request', async () => {
  const f = panelFixture()
  f.farm.fetchBagSeeds = async () => { throw new Error('bag read failed') }
  f.requestOperation(f.operations.find(op => op.type === 'plant'))
  await new Promise(resolve => setImmediate(resolve))
  assert.match(f.bagSeedsError.value, /bag read failed/)
  f.selectedSeedIds.value = [1]
  await f.executeOperation()
  assert.equal(f.calls.length, 0)
  f.farm.fetchBagSeeds = async () => [{ seedId: 1, count: 3 }]
  await f.loadBagSeeds()
  await f.executeOperation()
  assert.equal(f.calls[0][0], 'plantBag')
})
test('single-land ripening leaves confirmed mature crops in place without harvest or full-farm operations', async () => {
  const f = panelFixture()
  f.farm.applyFertilizer = async (...args) => {
    f.calls.push(['fertilize', ...args])
    const land = { ...growingLand, status: 'harvestable', matureInSec: 0 }
    f.farm.lands.value = [land]
    return reply(land)
  }
  await f.handleRipen(f.farm.lands.value[0])
  assert.deepEqual(f.calls, [['fertilize', 'a', 1, 'organic']])
  assert.equal(f.farm.lands.value[0].status, 'harvestable')
})
test('selected planting store forwards IDs, refreshes lands and surfaces rejection', async () => {
  const f = storeFixture()
  const calls = []
  f.setPost(async (...args) => {
    calls.push(args)
    return { data: { ok: true, data: { planted: 3, remaining: 21 } } }
  })
  const result = await f.store.plantSelectedBagSeeds('a', [1])
  assert.equal(result.planted, 3)
  assert.equal(calls[0][0], '/api/farm/plant-bag')
  assert.deepEqual(Array.from(calls[0][1].seedIds), [1])
  assert.equal(f.store.loaded.value, true)
  f.setPost(async () => ({ data: { ok: false, error: '库存不足' } }))
  await assert.rejects(() => f.store.plantSelectedBagSeeds('a', [1]), /库存不足/)
})
test('merged farm defaults to standard land details and exposes the scene as a third view', () => {
  const f = panelFixture()
  assert.equal(f.landView.value, 'default')
  f.landView.value = 'scene'
  f.loadPreferences('b')
  assert.equal(f.landView.value, 'default')
  const personal = readFileSync(new URL('../src/views/Personal.vue', import.meta.url), 'utf8')
  assert.equal(personal.includes('FarmNewPanel'), false)
  assert.equal(personal.includes('我的农场New'), false)
  const panel = readFileSync(new URL('../src/components/FarmPanel.vue', import.meta.url), 'utf8')
  assert.ok(panel.includes('landView === \'scene\''))
  assert.ok(panel.includes(':lands="displayLands" :weather="weather"'))
})
test('dead removal refreshes lands and reports failed business responses', async () => {
  const f = storeFixture()
  f.setGet(async () => landResponse([growingLand]))
  f.setPost(async () => ({ data: { ok: true, data: { removed: 0 } } }))
  await f.store.removeDeadPlants('a')
  assert.equal(f.store.loaded.value, true)
  f.setPost(async () => ({ data: { ok: false, error: 'fixture failure' } }))
  await assert.rejects(() => f.store.removeDeadPlants('a'), /fixture failure/)
})
test('confirmation cannot target a newly selected account, and executing operations cannot be repeated', async () => {
  const f = panelFixture()
  f.requestOperation(f.operations[0])
  f.account.currentAccountId.value = 'b'
  await f.executeOperation()
  assert.equal(f.calls.length, 0)
  let finish
  f.farm.operate = () => new Promise(resolve => { finish = resolve })
  f.requestOperation(f.operations[0])
  const pending = f.executeOperation()
  f.requestOperation(f.operations[1])
  await f.executeOperation()
  assert.equal(f.pendingOperation.value, null)
  assert.equal(f.operating.value, true)
  finish()
  await pending
  assert.equal(f.operating.value, false)
})
test('bulk operations and ordinary fertilizer are blocked when unavailable', async () => {
  const f = panelFixture()
  f.farm.loading.value = true
  f.requestOperation(f.operations[0])
  assert.equal(f.pendingOperation.value, null)
  f.farm.loading.value = false
  f.farm.lands.value[0].leftInorcFertTimes = 0
  await f.handleFertilize(growingLand, 'normal')
  assert.equal(f.calls.length, 0)
})
test('remove-all clears fertilizer overlays and failed business responses are surfaced', async () => {
  const f = storeFixture()
  f.setGet(async () => landResponse([growingLand]))
  await f.store.fetchLands('a')
  f.setPost(async () => ({ data: { ok: true, data: { success: true, updatedLand: { ...growingLand, matureInSec: 0, status: 'harvestable' } } } }))
  await f.store.applyFertilizer('a', 1, 'organic')
  f.setPost(async () => ({ data: { ok: true, data: { removed: 1 } } }))
  await f.store.removeAllPlants('a')
  assert.equal(f.store.lands.value[0].status, 'growing')
  f.setPost(async () => ({ data: { ok: false, error: 'fixture failure' } }))
  await assert.rejects(() => f.store.removeAllPlants('a'), /fixture failure/)
  await assert.rejects(() => f.store.operate('a', 'all'), /fixture failure/)
})

function overviewFixture() {
  const ref = value => ({ value })
  const account = { currentAccountId: ref('a'), currentAccount: ref({ running: true }) }
  const ready = ref(true)
  const visibility = ref('visible')
  const watchers = []
  const cleanup = []
  const calls = []
  const completions = new Map()
  const statusStore = {
    status: { connection: { connected: true }, uptime: 100 }, realtimeConnected: true,
    currentStatusReady: ready,
    connectRealtime(id) { calls.push(['realtime', id]) },
    async fetchStatus(id) { calls.push(['status', id]) },
  }
  const bag = {
    dashboardItems: ref([]),
    async fetchBag(id) { calls.push(['bag', id]) }, clearBag() { calls.push(['clearBag']) },
  }
  const source = readFileSync(new URL('../src/components/PersonalAccountOverview.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const { outputText } = ts.transpileModule(`${source}\nexports.overview = { refresh, illustratedLevels };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      const modules = {
        'vue': { ref, computed: fn => ({ get value() { return fn() } }), watch: (...args) => watchers.push(args), onUnmounted: fn => cleanup.push(fn) },
        '@vueuse/core': { useDocumentVisibility: () => visibility, useIntervalFn() {} },
        'pinia': { storeToRefs: store => store },
        '@/stores/account': { useAccountStore: () => account },
        '@/stores/status': { useStatusStore: () => statusStore },
        '@/stores/bag': { useBagStore: () => bag },
        '@/stores/farm': { useFarmStore: () => ({ fertilizePending: false }) },
        '@/api': { default: { get(_path, options) {
          const key = `${options.headers['x-account-id']}:${options.params.illustrated_type}`
          calls.push(['illustrated', key])
          return new Promise(resolve => completions.set(key, resolve))
        } } },
      }
      return modules[name] || {}
    },
  })
  return { ...exports.overview, account, ready, visibility, statusStore, watchers, cleanup, calls, completions }
}
function completeLevels(f, accountId, level) {
  for (const type of [1, 2])
    f.completions.get(`${accountId}:${type}`)({ data: { ok: true, data: { level } } })
}
test('personal overview coalesces requests and cannot show an old account illustrated response', async () => {
  const f = overviewFixture()
  const old = f.refresh(true)
  assert.equal(f.refresh(true), old)
  assert.equal(f.calls.filter(call => call[0] === 'bag').length, 1)
  f.account.currentAccountId.value = 'b'
  f.watchers.find(([source]) => source === f.account.currentAccountId)[1]('b', 'a')
  const current = f.refresh(true)
  completeLevels(f, 'b', 42)
  await current
  completeLevels(f, 'a', 3)
  await old
  assert.equal(f.illustratedLevels.value.crop, 42)
  assert.equal(f.illustratedLevels.value.mutant, 42)
})
test('personal overview skips resource calls while hidden, disconnected or unmounted', async () => {
  const f = overviewFixture()
  f.visibility.value = 'hidden'
  await f.refresh(true)
  assert.equal(f.calls.length, 0)
  f.visibility.value = 'visible'
  f.statusStore.status.connection.connected = false
  await f.refresh(true)
  assert.equal(f.calls.length, 0)
  f.statusStore.status.connection.connected = true
  f.cleanup[0]()
  await f.refresh(true)
  assert.equal(f.calls.length, 0)
})
test('normal overview polling throttles inventory reads and avoids repeated illustrated requests', async () => {
  const f = overviewFixture()
  const first = f.refresh(true)
  completeLevels(f, 'a', 8)
  await first
  await f.refresh()
  assert.equal(f.calls.filter(call => call[0] === 'bag').length, 1)
  assert.equal(f.calls.filter(call => call[0] === 'illustrated').length, 2)
})


test('single-land removal confirms, uses the existing API, and rejects a replaced crop', async () => {
  const f = panelFixture()
  const land = f.farm.lands.value[0]
  f.requestRemoveLand(land)
  assert.equal(f.pendingOperation.value.operation.type, 'remove')
  assert.equal(f.calls.length, 0)
  await f.executeOperation()
  assert.deepEqual(f.calls, [['remove', 'a', land.id]])
  f.requestRemoveLand(land)
  f.farm.lands.value[0] = { ...land, plantId: 999 }
  await f.executeOperation()
  assert.equal(f.calls.length, 1)
  f.requestRemoveLand(f.farm.lands.value[0])
  f.account.currentAccountId.value = 'b'
  await f.executeOperation()
  assert.equal(f.calls.length, 1)
})
test('only planted master lands expose removal for growing, mature and dead crops', () => {
  const { canRemoveLand } = loadModule('../src/utils/farm-land-actions.ts')
  for (const status of ['growing', 'harvestable', 'dead'])
    assert.equal(canRemoveLand({ ...growingLand, status }), true)
  for (const patch of [{ status: 'empty' }, { status: 'locked', unlocked: false }, { occupiedByMaster: true }, { plantId: 0 }])
    assert.equal(canRemoveLand({ ...growingLand, ...patch }), false)
})
test('single-land removal discards fertilizer overlays and reports server rejection', async () => {
  const f = storeFixture()
  f.setGet(async () => landResponse([growingLand]))
  await f.store.fetchLands('a')
  f.setPost(async () => ({ data: { ok: true, data: { success: true, updatedLand: { ...growingLand, matureInSec: 1000 } } } }))
  await f.store.applyFertilizer('a', growingLand.id, 'organic')
  f.setPost(async () => ({ data: { ok: false, error: 'remove rejected' } }))
  await assert.rejects(f.store.removePlant('a', growingLand.id), /remove rejected/)
  f.setPost(async () => ({ data: { ok: true } }))
  await f.store.removePlant('a', growingLand.id)
  assert.equal(f.store.lands.value[0].matureInSec, growingLand.matureInSec)
})

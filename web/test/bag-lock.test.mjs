/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function evaluate(source, imports) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => imports[name], console })
  return exports
}
const lock = evaluate(readFileSync(new URL('../src/utils/bag-lock.ts', import.meta.url), 'utf8'), {})
const original = [
  { id: 20001, uid: 11, count: 3 },
  { id: 20001, uid: 12, count: 4, locked: true },
  { id: 20001, uid: 13, count: 2, locked: 1 },
  { id: 20002, uid: 14, count: 2 },
  { id: 20001, uid: 0, count: 9 },
  { id: 20001, uid: 15, count: 0 },
]
test('merged seed operations select only eligible stack UIDs and preserve partial locks', () => {
  assert.deepEqual(Array.from(lock.getSeedLockUids(original, [20001], true)), [11])
  assert.deepEqual(Array.from(lock.getSeedLockUids(original, [20001], false)), [12, 13])
  assert.deepEqual(Array.from(lock.getSeedLockUids(original, [20001, 20002], true)), [11, 14])
})
function fixture() {
  const ref = value => ({ value })
  const account = { currentAccountId: ref('a'), currentAccount: ref({ running: true }) }
  const calls = []
  const watchers = []
  const items = [{ id: 20001, name: '种子', category: 'seed' }, { id: 20002, name: '种子2', category: 'seed' }]
  const bag = {
    items: ref(items),
    originalItems: ref(original),
    loading: ref(false),
    clearBag() {},
    async setItemsLocked(...args) {
      calls.push(['lock', ...args])
      return { ok: true, data: { changed: 1 } }
    },
    async fetchBag(...args) { calls.push(['fetch', ...args]) },
  }
  const source = readFileSync(new URL('../src/components/BagPanel.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const exported = evaluate(`${source}\nexports.panel = { handleSeedLockClick, handleConfirm, toggleBatchMode, selectAllSellable, selectedForBatch, selectedCategory, confirmModal, operationPending };`, {
    'vue': { ref, computed: fn => ({ get value() { return fn() } }), watch: (...args) => watchers.push(args), onUnmounted() {} },
    'pinia': { storeToRefs: store => store },
    '@vueuse/core': { useIntervalFn() {} },
    '@/stores/account': { useAccountStore: () => account },
    '@/stores/bag': { useBagStore: () => bag },
    '@/stores/status': { useStatusStore: () => ({}) },
    '@/stores/toast': { useToastStore: () => ({ success() {}, error() {}, warning() {} }) },
    '@/utils/bag-lock': lock,
  })
  return { ...exported.panel, account, bag, calls, watchers, items }
}
test('single seed lock executes immediately without confirmation and refreshes inventory', async () => {
  const f = fixture()
  await f.handleSeedLockClick(true, f.items[0])
  assert.equal(f.confirmModal.value.show, false)
  assert.deepEqual(f.calls.map(call => [call[0], call[1], ...(call[0] === 'lock' ? [Array.from(call[2]), call[3]] : [call[2]])]), [['lock', 'a', [11], true], ['fetch', 'a', true]])
})
test('batch unlock all directly sends locked seed UIDs without confirmation', async () => {
  const f = fixture()
  f.selectedCategory.value = 'seed'
  f.toggleBatchMode('unlock')
  f.selectAllSellable()
  assert.deepEqual(Array.from(f.selectedForBatch.value), [20001])
  await f.handleSeedLockClick(false)
  assert.equal(f.confirmModal.value.show, false)
  assert.deepEqual(Array.from(f.calls[0][2]), [12, 13])
  assert.equal(f.calls[0][3], false)
})
test('pending lock cannot be submitted twice or refresh a newly selected account', async () => {
  const f = fixture()
  let finish
  f.bag.setItemsLocked = (...args) => {
    f.calls.push(args)
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = f.handleSeedLockClick(true, f.items[0])
  await f.handleSeedLockClick(true, f.items[0])
  assert.equal(f.calls.length, 1)
  f.account.currentAccountId.value = 'b'
  finish({ ok: true, data: { changed: 1 } })
  await first
  assert.equal(f.operationPending.value, false)
  assert.equal(f.calls[0][0], 'a')
  assert.equal(f.calls.length, 1)
})

test('forced inventory refresh waits for an older pending read then makes a new read', async () => {
  const ref = value => ({ value })
  const replies = []
  const account = { currentAccountId: 'a' }
  const storeModule = evaluate(readFileSync(new URL('../src/stores/bag.ts', import.meta.url), 'utf8'), {
    'vue': { ref, computed: fn => ({ get value() { return fn() } }) },
    'pinia': { defineStore: (_name, setup) => setup },
    '@/stores/account': { useAccountStore: () => account },
    '@/api': { default: { get: () => new Promise(resolve => replies.push(resolve)) } },
  })
  const bag = storeModule.useBagStore()
  const before = bag.fetchBag('a')
  const refresh = bag.fetchBag('a', true)
  assert.equal(replies.length, 1)
  replies[0]({ data: { ok: true, data: { items: [{ id: 20001, locked: false }] } } })
  await before
  await Promise.resolve()
  assert.equal(replies.length, 2)
  replies[1]({ data: { ok: true, data: { items: [{ id: 20001, locked: true }] } } })
  await refresh
  assert.equal(bag.allItems.value[0].locked, true)
})

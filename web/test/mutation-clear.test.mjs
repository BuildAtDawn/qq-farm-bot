import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'

const source = readFileSync(new URL('../src/views/Mutations.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const { outputText } = ts.transpileModule(`${descriptor.scriptSetup.content}
export { requestClear, cancelClear, confirmClear, clearTarget, clearing, clearError, page, mutation, status, statistics, percent, view, seedId, testId, params };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
function fixture() {
  const account = reactive({ currentAccountId: 'a', currentAccount: { name: 'Account A' } })
  const events = []
  const calls = []
  const data = ref({ rows: [{ id: 1 }], total: 1, mutationTypes: [] })
  const api = {
    async post(...args) {
      calls.push(args)
      return { data: { ok: true, data: { deleted: 1 } } }
    },
  }
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    require: name => ({
      'vue': { computed, ref, watch },
      '@/api': { default: api },
      '@/stores/account': { useAccountStore: () => account },
      '@/composables/useMutationResource': { useMutationResource: () => ({
        data,
        loading: ref(false),
        error: ref(''),
        invalidate: () => events.push('invalidate'),
        refresh: async () => events.push('refresh'),
      }) },
    })[name] || {},
  })
  return { ...exports, account, api, calls, data, events }
}

test('clear requires opening and confirming the account-specific modal; cancel sends no request', async () => {
  const f = fixture()
  await f.confirmClear()
  assert.equal(f.calls.length, 0)
  f.requestClear()
  assert.equal(f.clearTarget.value.name, 'Account A')
  assert.equal(f.calls.length, 0)
  f.cancelClear()
  await f.confirmClear()
  assert.equal(f.calls.length, 0)
  f.account.currentAccountId = ''
  f.requestClear()
  assert.equal(f.clearTarget.value, null)
  assert.match(descriptor.template.content, /<ConfirmModal[\s\S]*@confirm="confirmClear"/)
})

test('confirmed clear targets the captured account, resets filters and invalidates old reads before refreshing', async () => {
  const f = fixture()
  f.mutation.value = '5'
  f.status.value = 'harvested'
  f.page.value = 3
  f.requestClear()
  await f.confirmClear()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    ['/api/mutations/clear', { confirm: true }, { headers: { 'x-account-id': 'a' } }],
  ])
  assert.deepEqual(f.events, ['invalidate', 'refresh'])
  assert.equal(f.data.value, null)
  assert.equal(f.page.value, 1)
  assert.equal(f.mutation.value, '')
  assert.equal(f.status.value, '')
  assert.equal(f.clearTarget.value, null)
  assert.equal(f.clearing.value, false)
})

test('account switching cancels unsubmitted confirmation; late deletion responses cannot clear a new view', async () => {
  const f = fixture()
  f.requestClear()
  f.account.currentAccountId = 'b'
  await f.confirmClear()
  assert.equal(f.calls.length, 0)
  f.account.currentAccountId = 'a'
  let finish
  f.api.post = (...args) => {
    f.calls.push(args)
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  f.requestClear()
  const pending = f.confirmClear()
  await f.confirmClear()
  f.cancelClear()
  assert.notEqual(f.clearTarget.value, null)
  assert.equal(f.calls.length, 1)
  f.account.currentAccountId = 'b'
  f.account.currentAccountId = 'a'
  finish({ data: { ok: true } })
  await pending
  assert.equal(f.data.value.total, 1)
  assert.equal(f.events.length, 0)
  assert.equal(f.clearing.value, false)
})

test('business and network failures preserve records, show the error and allow a confirmed retry', async () => {
  for (const network of [false, true]) {
    const f = fixture()
    f.api.post = async () => {
      if (network)
        throw Object.assign(new Error('failed'), { response: { data: { error: 'test is active' } } })
      return { data: { ok: false, error: 'test is active' } }
    }
    f.requestClear()
    await f.confirmClear()
    assert.equal(f.clearError.value, 'test is active')
    assert.equal(f.data.value.total, 1)
    assert.equal(f.events.length, 0)
    assert.equal(f.clearTarget.value, null)
    assert.equal(f.clearing.value, false)
    f.requestClear()
    assert.equal(f.clearError.value, '')
    assert.equal(f.clearTarget.value.id, 'a')
  }
})

test('statistics use the server account totals, update with polling and disappear when data is invalidated', async () => {
  const f = fixture()
  assert.equal(f.statistics.value, null)
  f.data.value = {
    rows: [{ id: 1 }],
    total: 1,
    mutationTypes: [],
    statistics: {
      completedRecords: 100,
      mutatedRecords: 30,
      mutationRate: 30,
      types: [{ id: 5, name: 'gold', count: 20, percentage: 20 }],
    },
  }
  f.page.value = 2
  f.mutation.value = '5'
  assert.equal(f.statistics.value.completedRecords, 100)
  assert.equal(f.statistics.value.types[0].percentage, 20)
  f.data.value.statistics = { ...f.data.value.statistics, completedRecords: 101 }
  assert.equal(f.statistics.value.completedRecords, 101)
  f.requestClear()
  await f.confirmClear()
  assert.equal(f.statistics.value, null)
})

test('statistics format unknown, zero, fractional and full percentages distinctly', () => {
  const f = fixture()
  assert.equal(f.percent(null), '—')
  assert.equal(f.percent(0), '0.00%')
  assert.equal(f.percent(100 / 3), '33.33%')
  assert.equal(f.percent(100), '100.00%')
})

test('phase views and crop/task filters scope API queries and reset safely across accounts', async () => {
  const f = fixture()
  f.seedId.value = '20002'
  f.testId.value = 'task-a'
  f.page.value = 4
  f.mutation.value = '5'
  f.view.value = 'stages'
  await nextTick()
  assert.equal(f.page.value, 1)
  assert.equal(f.mutation.value, '')
  assert.equal(f.params().view, 'stages')
  assert.equal(f.params().seedId, '20002')
  assert.equal(f.params().testId, 'task-a')
  f.account.currentAccountId = 'b'
  assert.equal(f.params().seedId, '')
  assert.equal(f.params().testId, '')
  assert.match(descriptor.template.content, /MutationDetailsTable/)
  assert.match(descriptor.template.content, /stageStatistics/)
})

/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { milkTeaActivity } from './helpers/milk-tea-data.mjs'

const helper = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/utils/milk-tea.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, helper)
const tea = helper.exports
function state() {
  return {
    startTime: 1000,
    settleTime: 2000,
    endTime: 2100,
    summary: { can_upgrade: true },
    shop: { level: 2, slots: [{ slot_index: 0, end_at: 1600 }], total_revenue: '90071992547409930', next_level_revenue: '90071992547409929' },
    levels: [{ level: 2, employee_slot_count: 2 }],
    work: { my_shift: { begin_at: 1100, end_at: 1600, interact_count: 0, interact_limit: 1 }, interact_done: false },
  }
}
const goods = () => ({ unlocked: true, paid: false, costs: [{ id: '1041', count: '80' }], remaining: 10, maxPurchasable: 7, category_tag: 'seed' })

test('inventory estimates preserve exact amounts, unknown values and business cutoff', () => {
  const s = milkTeaActivity()
  s.recipes = [{ unlocked: true, is_advanced: true, stock_cups: '90071992547409930', token_price: '45' }]
  assert.equal(tea.teaInventoryEstimate(s, s.serverTime).tokens, '4053239664633446850')
  assert.equal(tea.teaInventoryEstimate(s, s.serverTime).until, null)
  s.recipes[0].stock_cups = '100'
  s.shop.effective_cups_per_hour = '40'
  const estimate = tea.teaInventoryEstimate(s, s.settleTime - 60)
  assert.equal(estimate.until, s.settleTime)
  assert.equal(estimate.capped, true)
  s.recipes[0].token_price = 'unknown'
  assert.equal(tea.teaInventoryEstimate(s, s.serverTime).tokens, null)
  s.recipes[0].token_price = '45'
  s.shop.effective_cups_per_hour = '0'
  assert.equal(tea.teaInventoryEstimate(s, s.serverTime).until, null)
})

test('quick entries reflect server work limits and unknown progress without fake denominators', () => {
  const s = milkTeaActivity()
  assert.equal(tea.teaQuickEntries(s, s.serverTime)[0].progress, null)
  assert.equal(tea.teaQuickEntries(s, s.serverTime)[1].progress, null)
  s.summary.has_unclaimed_wage = true
  assert.match(tea.teaQuickEntries(s, s.serverTime)[0].text, /工资待领取/)
  s.fund = { unlocked: false, tiers: [{ state: 2 }] }
  assert.equal(tea.teaQuickEntries(s, s.serverTime)[2].attention, false)
})

test('milk tea workbench uses exact large amounts and explicit Shanghai dates', () => {
  assert.equal(tea.teaNumber('90071992547409930'), '90,071,992,547,409,930')
  assert.equal(tea.teaInteger('not-a-count'), 0n)
  assert.equal(tea.teaNumber(undefined), '—')
  assert.equal(tea.teaDate(0), '—')
  assert.equal(tea.teaDate(Number.MAX_VALUE), '—')
  assert.match(tea.teaDate(1792029600), /2026\/10\/15 10:00:00/)
  assert.equal(tea.teaDuration(-1), '00:00')
  assert.equal(tea.teaDuration(9000), '02:30')
})

test('only unlocked advanced materials with positive numeric UIDs are selectable', () => {
  const r = { unlocked: true, is_advanced: true, fruits: [
    { uid: '11', count: '3' },
    { uid: '90071992547409930', count: '1' },
    { uid: '0', count: '5' },
    { uid: '-1', count: '2' },
    { uid: 'x', count: '4' },
    { uid: '20', count: '0' },
  ] }
  assert.deepEqual(Array.from(tea.teaFruitUids([r, r])), ['11', '90071992547409930'])
  assert.equal(tea.teaFruits({ ...r, unlocked: false }).length, 0)
  assert.equal(tea.teaFruits({ ...r, is_advanced: false }).length, 0)
})

test('goods reasons honor paid currency, original limits and settlement boundaries', () => {
  assert.equal(tea.teaPurchaseMax(goods()), 7)
  assert.equal(tea.teaPurchaseMax({ ...goods(), maxPurchasable: 100 }), 10)
  for (const maximum of [0, -1, 0.5, Number.NaN, Infinity])
    assert.equal(tea.teaPurchaseMax({ ...goods(), maxPurchasable: maximum }), 0)
  assert.equal(tea.teaGoodsReason(goods(), 'business'), '')
  assert.match(tea.teaGoodsReason(goods(), 'settling'), /结算期/)
  assert.match(tea.teaGoodsReason(goods(), 'ended'), /已结束/)
  assert.match(tea.teaGoodsReason({ ...goods(), costs: [{ id: '1004', count: '1' }] }, 'business'), /钻石/)
  assert.match(tea.teaGoodsReason({ ...goods(), remaining: 0 }, 'business'), /限购/)
  assert.match(tea.teaGoodsReason({ ...goods(), maxPurchasable: 0 }, 'business'), /资源/)
  assert.equal(tea.teaPurchaseMax({ ...goods(), costs: [] }), 0)
  assert.equal(tea.teaPurchaseMax({ ...goods(), costs: [{ id: '1041', count: '0' }] }), 0)
  assert.equal(tea.teaPurchaseMax({ ...goods(), affordable: false }), 0)
  assert.equal(tea.teaGoodsReason({ ...goods(), unlocked: false, cond_hints: [{ satisfied: false, cond_type: 'milk_tea_store_level', target: 3 }] }, 'business'), '店铺 3 级解锁')
})

test('time gates, upgrade, employee slots and interaction limits fail closed', () => {
  const s = state()
  assert.equal(tea.teaPhase(s, 999), 'upcoming')
  assert.equal(tea.teaPhase(s, 1000), 'business')
  assert.equal(tea.teaPhase(s, 1999), 'business')
  assert.equal(tea.teaPhase(s, 2000), 'settling')
  assert.equal(tea.teaPhase(s, 2100), 'settling')
  assert.equal(tea.teaPhase(s, 2101), 'ended')
  assert.equal(tea.teaPhase(s, Number.NaN), 'ended')
  assert.equal(tea.teaPhase({ ...s, settleTime: 0 }, 1200), 'ended')
  assert.equal(tea.teaCanUpgrade(s, 1200), true)
  assert.equal(tea.teaCanUpgrade({ ...s, summary: { can_upgrade: false } }, 1200), false)
  assert.equal(tea.teaCanUpgrade(s, 2000), false)
  assert.deepEqual(Array.from(tea.teaOpenSlots(s, 1500)), [1])
  assert.deepEqual(Array.from(tea.teaOpenSlots(s, 1600)), [0, 1])
  const duration = { min_remaining_business_sec: 100 }
  assert.equal(tea.teaHireReason(s, duration, 1900), '')
  assert.match(tea.teaHireReason(s, duration, 1901), /时间不足/)
  assert.equal(tea.teaCanInteract(s, 1100), true)
  assert.equal(tea.teaCanInteract(s, 1099), false)
  assert.equal(tea.teaCanInteract(s, 1600), false)
  assert.equal(tea.teaCanInteract({ ...s, work: { ...s.work, interact_done: true } }, 1200), false)
  assert.equal(tea.teaCanInteract({ ...s, work: { my_shift: { ...s.work.my_shift, interact_count: 1 } } }, 1200), false)
})

test('employee candidates and names reject stale, invalid or unsafe values', () => {
  const worker = { friend: { gid: '42' }, state: 0, state_until_at: 0, rehire_available_at: 100 }
  assert.equal(tea.teaCandidateAvailable(worker, 100), true)
  assert.equal(tea.teaCandidateAvailable({ ...worker, rehire_available_at: 101 }, 100), false)
  assert.equal(tea.teaCandidateAvailable({ ...worker, state: 1 }, 100), false)
  for (const name of ['a', '123456789', '<店铺>', '奶\u0000茶'])
    assert.equal(tea.teaNameValid(name), false)
  assert.equal(tea.teaNameValid('  奶茶冲鸭  '), true)
})

test('execution rows come from current-account milk tea logs rather than demo data', () => {
  const logs = [
    { ts: 4, accountId: 'other', msg: '奶茶热销中制作', meta: { module: 'activity' } },
    { ts: 3, accountId: 'a', msg: '奶茶热销中制作', meta: { module: 'activity' } },
    { ts: 2, accountId: 'a', msg: '其他活动', meta: { module: 'activity' } },
    { ts: 1, accountId: 'a', msg: '奶茶热销中领取', meta: { module: 'activity' } },
  ]
  assert.deepEqual(Array.from(tea.teaRecentLogs(logs, 'a'), log => log.ts), [3, 1])
  assert.equal(logs[0].ts, 4)
})

test('shared action guards preserve ownership-independent resource, phase and entitlement checks', () => {
  const s = milkTeaActivity()
  const now = s.serverTime
  assert.equal(tea.teaActionReason(s, 'cashier', {}, now), '')
  assert.equal(tea.teaActionReason(s, 'buy', { goodsId: '301', count: 12 }, now), '')
  assert.match(tea.teaActionReason(s, 'buy', { goodsId: '301', count: 13 }, now), /范围/)
  assert.match(tea.teaActionReason(s, 'craft', { fruitUids: ['0'] }, now), /果实/)
  assert.match(tea.teaActionReason(s, 'fundRewards', {}, now), /暂无/)
  assert.match(tea.teaActionReason(s, 'boost', {}, s.settleTime), /结算期/)
  assert.match(tea.teaActionReason(s, 'cashier', {}, s.startTime - 1), /未开始/)
  assert.match(tea.teaActionReason(s, 'cashier', {}, s.endTime + 1), /已结束/)
  assert.match(tea.teaActionReason(s, 'not-a-command', {}, now), /操作无效/)
  assert.equal(tea.teaItemName({ id: '1041', count: '10' }), '奶茶券')
})

test('actual craft selection drops spent/old-account UIDs and cannot emit while busy or settling', async () => {
  const { descriptor } = parse(readFileSync(new URL('../src/components/activity/MilkTeaCraftDialog.vue', import.meta.url), 'utf8'))
  const script = ts.createSourceFile('craft.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const source = script.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(script)).join('\n')
  const props = reactive({ state: milkTeaActivity(), now: 1792029601, busy: false, loading: false, error: '', initialUids: [] })
  const events = []
  const context = vm.createContext({
    ...tea,
    computed,
    ref,
    watch,
    defineProps: () => props,
    defineEmits: () => (...args) => events.push(args),
  })
  const scope = effectScope()
  try {
    scope.run(() => vm.runInContext(ts.transpileModule(`${source}\nObject.assign(globalThis, { selected, submit, toggle });`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context))
    assert.deepEqual(Array.from(context.selected.value), ['11'])
    context.toggle('11')
    assert.equal(context.selected.value.length, 0)
    context.submit()
    assert.equal(events.length, 0)
    context.toggle('11')
    context.submit()
    assert.deepEqual(Array.from(events[0][1].fruitUids), ['11'])
    props.busy = true
    context.submit()
    assert.equal(events.length, 1)
    props.busy = false
    props.state.recipes.find(recipe => recipe.recipe_id === '2').fruits[0].count = '0'
    await nextTick()
    assert.equal(context.selected.value.length, 0)
    props.state = milkTeaActivity('b')
    props.state.recipes.find(recipe => recipe.recipe_id === '2').fruits[0].uid = '22'
    await nextTick()
    context.toggle('22')
    assert.deepEqual(Array.from(context.selected.value), ['22'])
    props.state = milkTeaActivity('c')
    await nextTick()
    assert.equal(context.selected.value.length, 0)
    props.now = props.state.settleTime
    context.toggle('11')
    context.submit()
    assert.equal(events.length, 1)
  }
  finally {
    scope.stop()
  }
})

/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { milkTeaActivity } from './helpers/milk-tea-data.mjs'
import { renderTea } from './helpers/milk-tea-render.mjs'

const now = 1792029601
test('native workbench renders real inventory, prices, automation and execution without demo values', async () => {
  const html = await renderTea('MilkTeaShopPanel.vue', {
    state: milkTeaActivity(),
    now,
    blocked: false,
    automation: { milk_tea_cashier: true },
    logs: [{ ts: now * 1000, msg: '奶茶热销中领取收益完成', meta: { result: 'success' } }],
    contextLoading: false,
    contextError: '',
  })
  for (const text of ['夹具小铺', '在售库存', '普通奶茶', '不限量', '12 枚', '店铺成长', '自动化状态', '1 项开启', '奶茶热销中领取收益完成', '库存预估券收益', '高级库存预计支撑至'])
    assert.ok(html.includes(text), text)
  assert.equal((html.match(/class="tea-stock-item"/g) || []).length, 2)
  assert.match(html, /role="switch"[^>]*aria-checked="true"/)
  assert.match(html, /aria-label="允许被雇佣"/)
  assert.doesNotMatch(html, /tea-recipe-row|可用材料全选/)
  assert.doesNotMatch(html, /5,956|24,161|06:48:52|DEMO/)
})

test('unavailable goods expose the exact blocking reason rather than a live purchase action', async () => {
  const state = milkTeaActivity()
  state.goods[0].paid = true
  const html = await renderTea('MilkTeaExchangePanel.vue', { state, now, blocked: false })
  assert.match(html, /暂不可兑换/)
  assert.match(html, /不支持钻石购买/)
  assert.match(html, /disabled[^>]*><span class="i-carbon-locked"/)
  const settling = milkTeaActivity()
  const settlementHtml = await renderTea('MilkTeaExchangePanel.vue', { state: settling, now: settling.settleTime, blocked: false })
  assert.match(settlementHtml, /结算期不可兑换种子/)
})

test('craft entry only appears with usable materials and automation states remain explicit', async () => {
  const state = milkTeaActivity()
  for (const recipe of state.recipes)
    recipe.fruits = []
  const html = await renderTea('MilkTeaShopPanel.vue', { state, now, blocked: false, automation: { milk_tea_cashier: true }, logs: [], contextLoading: false, contextError: '' })
  assert.doesNotMatch(html, /tea-craft-prompt/)
  assert.match(html, /在售库存/)
  const on = await renderTea('MilkTeaAutomationStatus.vue', { enabled: true })
  const off = await renderTea('MilkTeaAutomationStatus.vue', { enabled: false })
  assert.match(on, /tea-auto-state--on/)
  assert.match(on, /已开启/)
  assert.match(off, /tea-auto-state--off/)
  assert.match(off, /已关闭/)
})

test('work page distinguishes no shift, expired shift and server interaction limits', async () => {
  const state = milkTeaActivity()
  const empty = await renderTea('MilkTeaWorkPanel.vue', { state, now, blocked: false })
  assert.match(empty, /暂无进行中的兼职/)
  assert.doesNotMatch(empty, /邀请好友雇佣/)
  state.work.my_shift = {
    shift_id: '10',
    employer: { name: '夹具老板' },
    shop_name: '夹具店铺',
    talent_name: '特长',
    begin_at: now - 3600,
    end_at: now - 1,
    interact_count: 1,
    interact_limit: 1,
    wage_total: '40',
  }
  const expired = await renderTea('MilkTeaWorkPanel.vue', { state, now, blocked: false })
  assert.match(expired, /已下班/)
  assert.match(expired, /当前班次已结束/)
  assert.equal((expired.match(/class="tea-interaction" disabled/g) || []).length, state.interactions.length)
  state.work.slips = [{ shift_id: '9', shop_name: '历史夹具茶铺', employer: { name: '历史老板' }, end_at: now - 86400, work_sec: 10800, wages: { final_wage: '120' } }]
  const history = await renderTea('MilkTeaWorkPanel.vue', { state, now, blocked: false })
  for (const text of ['兼职记录', '历史夹具茶铺', '历史老板', '120 奶茶券', '工作时长', '领取工资'])
    assert.ok(history.includes(text), text)
  state.shop = null
  state.summary.shop_open_at = '0'
  const unopened = await renderTea('MilkTeaWorkPanel.vue', { state, now, blocked: false })
  assert.doesNotMatch(unopened, /aria-label="允许被雇佣"/)
})

test('rewards come from normalized names, thresholds and entitlements; fund purchase stays absent', async () => {
  const state = milkTeaActivity()
  state.share = { current_score: '17', daily: { daily_reward_claimed: false }, milestones: [
    { tier_id: 1, threshold: '17', state: 2, rewards: [{ id: '1041', count: '77', name: '夹具奖励' }] },
  ] }
  state.fund = { unlocked: false, unlock_cost: [{ id: '1004', count: '360', name: '钻石' }], tiers: [
    { tier_id: 1, state: 2, conditions: [{ target_value: '3', reached: false }], reward: [{ id: '80011', count: '4', name: '基金夹具奖励' }] },
  ] }
  const html = await renderTea('MilkTeaRewardsPanel.vue', { state, blocked: false })
  for (const text of ['17 快乐值', '夹具奖励', '×77', 'Lv.3', '基金未解锁', '不支持在网页购买付费基金'])
    assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /确认购买|立即购买/)
  const fund = await renderTea('MilkTeaRewardsPanel.vue', { state, blocked: false, section: 'fund' })
  assert.match(fund, /基金夹具奖励/)
  assert.doesNotMatch(fund, /每日快乐值|活动奖励/)
  const rewards = await renderTea('MilkTeaRewardsPanel.vue', { state, blocked: false, section: 'rewards' })
  assert.match(rewards, /夹具奖励/)
  assert.doesNotMatch(rewards, /基金夹具奖励/)
})

test('craft dialog shows selectable real fruit batches without fabricated output counts', async () => {
  const html = await renderTea('MilkTeaCraftDialog.vue', {
    state: milkTeaActivity(),
    now,
    busy: false,
    loading: false,
    error: '',
  })
  assert.match(html, /UID 11/)
  assert.doesNotMatch(html, /暂无可用材料|未解锁/)
  assert.match(html, /checked/)
  assert.match(html, /实际产量由服务端结算/)
  assert.match(html, /选材制作/)
  assert.equal((html.match(/class="tea-material-recipe"/g) || []).length, 1)
  assert.doesNotMatch(html, /金露云酪|普通奶茶/)
})

test('full-date records and level preview retain current, next and reward information', async () => {
  const state = milkTeaActivity()
  const levels = await renderTea('MilkTeaShopDialogs.vue', { state, now, kind: 'levels', records: null, busy: false, error: '' })
  assert.match(levels, /当前等级/)
  assert.match(levels, /下一等级/)
  assert.match(levels, /Lv.13/)
  assert.match(levels, /选择预览等级/)
  assert.equal((levels.match(/class="tea-level-detail"/g) || []).length, 1)
  assert.doesNotMatch(levels, /class="tea-level-preview/)
  const sales = await renderTea('MilkTeaShopDialogs.vue', {
    state,
    now,
    kind: 'sales',
    busy: false,
    error: '',
    records: { day: '20261017', cups: '19', drinks: [{ recipe_id: '2', name: '甜莓奶茶', cups: '19' }], rewards: [{ id: '1041', count: '190', name: '奶茶券' }], hires: [] },
  })
  assert.match(sales, /2026-10-17/)
  assert.match(sales, /甜莓奶茶/)
  assert.match(sales, /×190/)
})

test('no-account entry is distinct and must not render fake balances or stale actions', async () => {
  const html = await renderTea('MilkTeaActivityPanel.vue', {}, '')
  assert.match(html, /请先选择账号/)
  assert.doesNotMatch(html, /tea-metrics|tea-recipe-row|确认兑换/)
})

test('new background and all original protocol-mapped assets remain present and hash-matched', () => {
  const root = new URL('../public/activity/milk-tea/', import.meta.url)
  const mapped = JSON.parse(readFileSync(new URL('assets.json', root), 'utf8'))
  for (const entry of mapped) {
    const file = new URL(entry.file, root)
    assert.ok(existsSync(file), entry.file)
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256, entry.file)
  }
  const art = JSON.parse(readFileSync(new URL('workbench/assets.json', root), 'utf8'))
  for (const entry of art.assets)
    assert.equal(createHash('sha256').update(readFileSync(new URL(`workbench/${entry.file}`, root))).digest('hex'), entry.sha256)
  assert.equal(createHash('sha256').update(readFileSync(new URL(`workbench/${art.prompt}`, root))).digest('hex'), art.prompt_sha256)
})

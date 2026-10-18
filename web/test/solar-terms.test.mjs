import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { renderTea } from './helpers/milk-tea-render.mjs'

const require = createRequire(import.meta.url)
const { solarTermsConfig } = require('../../core/src/config/solar-terms')
const { createSolarTermsService } = require('../../core/src/services/activity-solar-terms')
const normalize = createSolarTermsService({
  now: () => solarTermsConfig.get(401).startTime,
  mapItem: item => ({ itemId: item.id, itemName: item.id === 1002 ? '经验' : '夹具种子', count: item.count }),
}).normalizeEvent
function term(overrides = {}) {
  const config = solarTermsConfig.get(401)
  return normalize({
    id: 401, window_status: 2, open_start_time: config.startTime, open_end_time: config.endTime,
    rewards: [{ id: 20165, count: 20 }], question_rewards: [{ id: 20165, count: 10 }, { id: 1002, count: 100 }],
    ...overrides,
  })
}
function render(row) {
  return renderTea('HeluSolarTermsPanel.vue', {
    labels: { notesTab: '节令日历', empty: '暂无数据' },
    solarTerms: { version: 'v2', terms: [row], currentTerm: row, claimableCount: row.claimable ? 1 : 0 },
  })
}

test('quiz shows official question, four radio choices, correct answer and additional rewards', async () => {
  const html = await render(term())
  assert.match(html, /重阳节又被称为什么节？/)
  assert.match(html, /A\.敬老节/)
  assert.equal((html.match(/type="radio"/g) || []).length, 4)
  assert.equal((html.match(/正确答案/g) || []).length, 1)
  assert.match(html, /答题附加奖励/)
  assert.match(html, /×10/)
  assert.match(html, /×100/)
  assert.match(html, /答题领奖/)
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/)
});

test('base gift claimed does not disable the independent quiz', async () => {
  const html = await render(term({ direct_claimed: true }))
  assert.match(html, /基础赠礼已领取/)
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/)
});

test('expired V2 status is never mistaken for a claimed base reward', async () => {
  const html = await render(term({ window_status: 3 }))
  assert.match(html, /已结束/)
  assert.doesNotMatch(html, /基础赠礼已领取|赠礼已收下/)
  assert.match(html, /<fieldset[^>]*disabled/)
});

test('awarded and wrong-today states disable answers with the specific reason', async () => {
  for (const [overrides, reason] of [[{ quiz_claimed: true }, '答题奖励已领取'], [{ quiz_wrong_today: true }, '今日答错，明日再试']]) {
    const html = await render(term(overrides))
    assert.ok(html.includes(reason))
    assert.match(html, /<fieldset[^>]*disabled/)
  }
});

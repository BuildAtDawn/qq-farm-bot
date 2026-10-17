/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const exports = {}
  vm.runInNewContext(outputText, { exports })
  return exports
}
const { groupMallGoods } = load('../src/utils/shop-presentation.ts')
const { createShopAvailability } = load('../src/composables/shop/useShopAvailability.ts')
const { initialActivityKey } = load('../src/utils/activity-presentation.ts')

test('mall grouping preserves every item and source order while using the existing purchase conditions', () => {
  const { canAffordMall } = createShopAvailability({ currentLevel: () => 48, currentGold: () => 500, currentCoupon: () => 200, currentDiamond: () => 0, userGoldBean: () => 20 })
  const items = Object.freeze([
    { id: 'sold', canBuy: true, isSoldOut: true, price: 1 },
    { id: 'gold', canBuy: true, currencyId: 1001, price: 500 },
    { id: 'expensive', canBuy: true, currencyId: 1002, price: 201 },
    { id: 'free', canBuy: true, isFree: true },
    { id: 'closed', canBuy: false, isFree: true },
    { id: 'known-balance', canBuy: true, balanceKnown: true, currencyBalance: 5, price: 6 },
    { id: 'unknown-balance', canBuy: true, balanceKnown: false, price: 999 },
    { id: 'diamond', canBuy: true, currencyId: 1004, price: 1 },
  ].map(Object.freeze))
  const result = groupMallGoods(items, canAffordMall)
  assert.deepEqual(Array.from(result.available, x => x.id), ['gold', 'free', 'unknown-balance'])
  assert.deepEqual(Array.from(result.unavailable, x => x.id), ['sold', 'expensive', 'closed', 'known-balance', 'diamond'])
  assert.equal(new Set([...result.available, ...result.unavailable]).size, items.length)
  assert.equal(items[0].id, 'sold')
  for (const item of items)
    assert.equal(result.available.includes(item), !!item.canBuy && !item.isSoldOut && canAffordMall(item))
})

test('milk tea is the default only when active, retaining open alternatives and the empty directory', () => {
  const solar = { key: 'solar', adaptedKey: null, permanent: true, status: 'active' }
  const other = { key: 'other', adaptedKey: 'other', permanent: false, status: 'active' }
  for (const status of ['active', 'ended', 'upcoming']) {
    const milk = { key: 'milk', adaptedKey: 'milk-tea', permanent: false, status }
    assert.equal(initialActivityKey([solar, other, milk]), status === 'active' ? 'milk' : 'other')
    assert.equal(initialActivityKey([milk]), status === 'active' ? 'milk' : null)
  }
  assert.equal(initialActivityKey([solar]), 'solar')
  assert.equal(initialActivityKey([]), null)
})

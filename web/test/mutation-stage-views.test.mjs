import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed } from 'vue'
import { parse } from 'vue/compiler-sfc'

const { descriptor } = parse(readFileSync(new URL('../src/components/MutationDetailsTable.vue', import.meta.url), 'utf8'))
const { outputText } = ts.transpileModule(`${descriptor.scriptSetup.content}\nexport { columns };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
function renderValues(view, row) {
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    defineProps: () => ({ view, rows: [row] }),
    require: () => ({ computed }),
  })
  return Object.fromEntries(exports.columns.value.map(column => [column.label, column.value(row)]))
}

test('unchecked stages show unknown rather than no mutation; checked carry-over mutations are not labeled new', () => {
  const row = { stage: 4, totalStages: 8, name: 'four', checked: false, sources: [], observedMutations: [], newMutations: [], serverEnteredAt: null, firstObservedAt: null }
  assert.equal(renderValues('stages', row)['本阶段首次发现'], '未知')
  assert.equal(renderValues('stages', row)['阶段开始 / 首次观察'], '—\n—')
  const values = renderValues('stages', { ...row, checked: true, observedMutations: [{ name: 'gold' }] })
  assert.equal(values['本阶段首次发现'], '无')
  assert.equal(values['本阶段观察到'], 'gold')
  assert.equal(values['阶段'], '4/8 · four')
})

test('discovery and fertilizer views preserve unknown times, stages, weather and consumption', () => {
  const discovery = renderValues('discoveries', {
    name: 'gold',
    mutationId: 5,
    stage: null,
    totalStages: 8,
    firstObservedAt: 1000,
    serverMutationAt: null,
    weatherId: null,
    source: 'fertilizer_after',
  })
  assert.equal(discovery['首次发现阶段'], '未知')
  assert.equal(discovery['服务端变异时间'], '—')
  assert.equal(discovery['天气 ID'], '—')
  const operation = renderValues('operations', {
    fertilizerId: 1012,
    beforeStage: 6,
    afterStage: 7,
    totalStages: 8,
    requestedAt: 1000,
    finishedAt: 2000,
    consumedSeconds: null,
    status: 'unknown',
    quality: 'after_missing',
  })
  assert.equal(operation['施肥前 → 后'], '6/8 → 7/8')
  assert.equal(operation['实际消耗'], '未知')
  assert.equal(operation['结果'], '结果未确认')
})

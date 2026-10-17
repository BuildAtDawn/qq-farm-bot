/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/utils/mutation-charts.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const exports = {}
vm.runInNewContext(outputText, { exports })
const { mutationChartData, chartPercent } = exports

test('overlapping mutation types retain their account-wide denominators and are not normalized to a pie', () => {
  const statistics = Object.freeze({
    completedRecords: 100,
    mutatedRecords: 80,
    mutationRate: 80,
    types: Object.freeze([
      Object.freeze({ id: 2, name: '冰冻', count: 60, percentage: 60 }),
      Object.freeze({ id: 1, name: '金色', count: 70, percentage: 70 }),
    ]),
  })
  const chart = mutationChartData(statistics)
  assert.equal(chart.rate, 80)
  assert.equal(chart.unmutated, 20)
  assert.equal(chart.hasRate, true)
  assert.deepEqual(Array.from(chart.types, item => [item.id, item.count, item.width]), [[1, 70, 70], [2, 60, 60]])
  assert.equal(chart.types.reduce((sum, item) => sum + item.width, 0), 130)
  assert.equal(statistics.types[0].id, 2)
})

test('empty and unknown samples remain distinct from a measured zero mutation rate', () => {
  const empty = { completedRecords: 0, mutatedRecords: 0, mutationRate: null, types: [] }
  assert.equal(mutationChartData(empty).hasRate, false)
  assert.equal(mutationChartData({ ...empty, completedRecords: 10 }).hasRate, false)
  const zero = mutationChartData({ ...empty, completedRecords: 10, mutationRate: 0 })
  assert.equal(zero.hasRate, true)
  assert.equal(zero.rate, 0)
  assert.equal(zero.unmutated, 10)
  const full = mutationChartData({ ...empty, completedRecords: 10, mutatedRecords: 10, mutationRate: 100 })
  assert.equal(full.rate, 100)
  assert.equal(full.unmutated, 0)
})

test('chart geometry stays finite and bounded without changing source percentages', () => {
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -10])
    assert.equal(chartPercent(value), 0)
  assert.equal(chartPercent(12.75), 12.75)
  assert.equal(chartPercent(130), 100)
  const chart = mutationChartData({
    completedRecords: 10,
    mutatedRecords: 2,
    mutationRate: 20,
    types: [{ id: 1, name: 'sample', count: 2, percentage: 130 }],
  })
  assert.equal(chart.types[0].percentage, 130)
  assert.equal(chart.types[0].width, 100)
})

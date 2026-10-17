import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const context = { exports: {} }
const source = readFileSync(new URL('../src/utils/dashboard-activity-check.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const { milkTeaCountdown } = context.exports
const base = { state: 'scheduled', intervalSec: 300, enabledActionCount: 3, nextRunAt: 310000 }

test('activity countdown uses an absolute deadline without subtracting an extra second on sync', () => {
  assert.equal(milkTeaCountdown(base, 10000).time, '00:05:00')
  assert.equal(milkTeaCountdown(base, 11000).time, '00:04:59')
  assert.equal(milkTeaCountdown(base, 11000).time, '00:04:59')
  assert.equal(milkTeaCountdown({ ...base, nextRunAt: 12000 }, 10000).time, '00:00:02')
  assert.equal(milkTeaCountdown(base, 310000).time, '等待检查')
  assert.equal(milkTeaCountdown(base, 999999).progress, 0)
  assert.match(milkTeaCountdown(base, 10000).description, /已开启 3 项 · 每 5 分钟检查/)
})

test('inactive and unavailable states never pretend to be checking', () => {
  for (const [state, label] of Object.entries({ upcoming: '未开始', ended: '已结束', disabled: '未开启', paused: '已暂停', running: '检查中...', idle: '等待调度' })) {
    const result = milkTeaCountdown({ ...base, state, nextRunAt: null }, 10000)
    assert.equal(result.time, label)
    assert.equal(result.progress, 0)
  }
  assert.equal(milkTeaCountdown(undefined, 10000).time, '等待同步')
  assert.equal(milkTeaCountdown({ ...base, nextRunAt: null }, 10000).time, '等待调度')
})

test('dashboard adds milk tea to the existing patrol list using account scoped status', () => {
  const dashboard = readFileSync(new URL('../src/views/Dashboard.vue', import.meta.url), 'utf8')
  assert.match(dashboard, /milkTeaCountdown\(status.value\?\.nextChecks\?\.milkTea, countdownNow.value\)/)
  assert.match(dashboard, /key: 'milk-tea', label: '奶茶自动化'/)
  assert.match(dashboard, /check.description \|\| '下次检查倒计时'/)
})

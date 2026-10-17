/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function transpile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
const helper = { exports: {} }
vm.runInNewContext(transpile(readFileSync(new URL('../src/utils/activity-layout.ts', import.meta.url), 'utf8')), helper)
const { portraitActivityWidth } = helper.exports

test('stacked activity layouts use the content width even below the first viewport', () => {
  for (const width of [280, 320, 366, 430, 620, 800]) {
    for (const height of [-500, 0, 30, 600, 1200])
      assert.equal(portraitActivityWidth(width, height, true), Math.min(width, 620))
  }
})

test('desktop fitting retains the portrait ratio with a readable width and no horizontal overflow', () => {
  assert.equal(portraitActivityWidth(620, 800, false), 450)
  assert.equal(portraitActivityWidth(620, 2000, false), 620)
  assert.equal(portraitActivityWidth(620, 0, false), 280)
  assert.equal(portraitActivityWidth(620, -400, false), 280)
  assert.equal(portraitActivityWidth(200, 0, false), 200)
  assert.equal(portraitActivityWidth(150, 1000, false), 150)
  for (const width of [0, -20, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(portraitActivityWidth(width, 500, true), null)
  assert.equal(portraitActivityWidth(320, Number.NaN, false), 280)
})

test('milk tea workbench replaces the portrait fitter with responsive native columns and modals', () => {
  const panel = readFileSync(new URL('../src/components/activity/MilkTeaActivityPanel.vue', import.meta.url), 'utf8')
  const style = readFileSync(new URL('../src/styles/milk-tea-workbench.css', import.meta.url), 'utf8')
  const dialog = readFileSync(new URL('../src/components/activity/MilkTeaDialog.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(panel, /fitGame|portraitActivityWidth|ResizeObserver|--game-width|milk-game/)
  assert.match(panel, /class="milk-workbench"/)
  assert.match(style, /grid-template-columns: minmax\(0, 1fr\) 285px/)
  assert.match(style, /@media \(max-width: 639px\)/)
  assert.match(style, /max-height:.*100dvh/)
  assert.match(dialog, /Teleport to="body"/)
  assert.match(dialog, /useModalFocus/)
  assert.doesNotMatch(style, /\bcqw\b|aspect-ratio: 900/)
})

test('only milk tea uses a full-width workspace; other activity navigation and history remain intact', () => {
  const activity = readFileSync(new URL('../src/views/Activity.vue', import.meta.url), 'utf8')
  assert.match(activity, /const milkTeaWorkbench = computed/)
  assert.match(activity, /'activity-workspace--directory': !selectedActivity \|\| milkTeaWorkbench/)
  assert.match(activity, /v-if="selectedActivity && !milkTeaWorkbench"/)
  assert.match(activity, /v-for="card in sidebarActivityCards"/)
  assert.match(activity, /v-model="showEndedActivities"/)
  assert.match(activity, /:disabled="card.status !== 'active'"/)
})

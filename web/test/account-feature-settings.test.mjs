import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const source = readFileSync(new URL('../src/components/settings/AccountFeatureSettings.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = ts.createSourceFile('AccountFeatureSettings.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const functions = script.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['moduleEnabled', 'setModuleEnabled'].includes(node.name?.text))
assert.equal(functions.length, 2)
const { outputText } = ts.transpileModule(functions.map(node => node.getText(script)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
})

function fixture(settings, active = false) {
  const automation = { value: { automation: { ...settings } } }
  const events = []
  const context = vm.createContext({
    automation,
    mutationTestActive: { value: active },
    emit: (...args) => events.push({ args, saved: { ...automation.value.automation } }),
  })
  vm.runInContext(outputText, context)
  return { ...context, settings: automation.value.automation, events }
}

test('disabling land/fertilizer clears both enabling fields before saving', () => {
  for (const fertilizer of ['none', 'normal', 'smart_normal']) {
    for (const land_upgrade of [false, true]) {
      const f = fixture({ fertilizer, land_upgrade, farm: false, friend: true })
      assert.equal(f.moduleEnabled('fertilizer'), fertilizer !== 'none' || land_upgrade)
      f.setModuleEnabled('fertilizer', false)
      assert.equal(f.moduleEnabled('fertilizer'), false)
      assert.equal(f.settings.fertilizer, 'none')
      assert.equal(f.settings.land_upgrade, false)
      assert.equal(f.settings.friend, true)
      assert.equal(f.settings.farm, false)
      assert.deepEqual(f.events, [{
        args: ['save', 'fertilizer', true],
        saved: { fertilizer: 'none', land_upgrade: false, fertilizer_2x2_ripen: false, farm: false, friend: true },
      }])
      assert.equal(fixture(f.events[0].saved).moduleEnabled('fertilizer'), false)
    }
  }
})

test('enabling fertilizer uses normal when off, preserves existing strategy, and does not enable upgrades', () => {
  for (const fertilizer of ['none', 'normal', 'smart_normal']) {
    const f = fixture({ fertilizer, land_upgrade: false })
    f.setModuleEnabled('fertilizer', true)
    assert.equal(f.moduleEnabled('fertilizer'), true)
    assert.equal(f.settings.fertilizer, fertilizer === 'none' ? 'normal' : fertilizer)
    assert.equal(f.settings.land_upgrade, false)
    assert.equal(f.events.length, 1)
  }
})

test('active mutation tests still prevent conflicting modules from being enabled', () => {
  const f = fixture({ fertilizer: 'none', land_upgrade: false, farm: false }, true)
  f.setModuleEnabled('fertilizer', true)
  f.setModuleEnabled('planting', true)
  assert.equal(f.moduleEnabled('fertilizer'), false)
  assert.equal(f.moduleEnabled('planting'), false)
  assert.equal(f.events.length, 0)
})

test('2x2 ripening alone enables the fertilizer module and disabling it clears the override', () => {
  const f = fixture({ fertilizer: 'none', land_upgrade: false, fertilizer_2x2_ripen: true })
  assert.equal(f.moduleEnabled('fertilizer'), true)
  f.setModuleEnabled('fertilizer', false)
  assert.equal(f.settings.fertilizer_2x2_ripen, false)
  assert.equal(f.moduleEnabled('fertilizer'), false)
  assert.equal(f.events[0].saved.fertilizer_2x2_ripen, false)
})

test('both settings pages bind the same default-off 2x2 switch', () => {
  for (const filename of ['AccountFeatureSettings.vue', 'AutomationSettingsTab.vue']) {
    const page = readFileSync(new URL(`../src/components/settings/${filename}`, import.meta.url), 'utf8')
    assert.match(page, /<BaseSwitch[^>]*v-model="[^"]*\.automation\.fertilizer_2x2_ripen"[^>]*label="2x2催熟"/)
  }
  const defaults = readFileSync(new URL('../src/composables/settings/useAutomationSettings.ts', import.meta.url), 'utf8')
  assert.match(defaults, /fertilizer_2x2_ripen: false/)
})

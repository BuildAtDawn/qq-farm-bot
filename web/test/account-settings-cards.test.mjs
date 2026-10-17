import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const configs = {
  AutoCodeRefreshCard: { enabled: true, intervalMinutes: 60, offlineEnabled: true, offlineDelaySeconds: 30 },
  FriendMonitorCard: { enabled: true, friendGids: [10], barkKeys: { 10: 'original' }, intervalMinSec: 180, intervalMaxSec: 300, leadSeconds: 120, forecastEnabled: true, matureEnabled: true, protectFriends: true },
}

function fixture(name, saveConfig = async () => true) {
  const source = readFileSync(new URL(`../src/components/settings/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const script = ts.createSourceFile(`${name}.ts`, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const functions = script.statements.filter(node => ts.isFunctionDeclaration(node) && ['configure', 'save', 'toggle'].includes(node.name?.text))
  const { outputText } = ts.transpileModule(functions.map(node => node.getText(script)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  const config = { value: structuredClone(configs[name]) }
  const context = vm.createContext({
    props: { accountId: 'a', currentAccountId: 'a', saveConfig },
    config,
    savedConfig: config,
    draft: { value: null },
    open: { value: false },
    pending: { value: false },
    disabled: { get value() { return context.pending.value } },
    loadFriends: async () => {},
  })
  vm.runInContext(outputText, context)
  return context
}

for (const name of Object.keys(configs)) {
  test(`${name}: editing and cancelling leave the saved configuration untouched`, () => {
    const f = fixture(name)
    f.configure()
    assert.equal(f.open.value, true)
    f.draft.value.enabled = false
    if (name === 'FriendMonitorCard') {
      f.draft.value.friendGids.push(20)
      f.draft.value.barkKeys[10] = 'edited'
    }
    f.open.value = false
    assert.deepEqual(f.config.value, configs[name])
    f.configure()
    assert.equal(f.draft.value.enabled, true)
    assert.deepEqual(JSON.parse(JSON.stringify(f.draft.value)), configs[name])
  })

  test(`${name}: failed saves retain the draft and successful saves close the dialog`, async () => {
    let success = false
    let payload
    const f = fixture(name, async (value) => {
      payload = value
      return success
    })
    f.configure()
    f.draft.value.enabled = false
    await f.save()
    assert.equal(f.open.value, true)
    assert.equal(f.pending.value, false)
    assert.equal(payload.enabled, false)
    assert.equal(f.config.value.enabled, true)
    success = true
    await f.save()
    assert.equal(f.open.value, false)
  })

  test(`${name}: repeated saves coalesce and account switches only affect account-scoped editors`, async () => {
    let resolve
    let calls = 0
    const f = fixture(name, async () => {
      calls++
      return new Promise((done) => {
        resolve = done
      })
    })
    f.configure()
    const first = f.save()
    await f.save()
    assert.equal(calls, 1)
    assert.equal(f.pending.value, true)
    f.props.accountId = 'b'
    f.props.currentAccountId = 'b'
    resolve(true)
    await first
    assert.equal(f.open.value, name === 'FriendMonitorCard')
    assert.equal(f.pending.value, false)
  })

  test(`${name}: card toggles save immediately without discarding other configuration`, async () => {
    let payload
    const f = fixture(name, async (value) => {
      payload = value
      return true
    })
    f.toggle(false)
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(payload.enabled, false)
    assert.equal(f.config.value.enabled, true)
    if (name === 'AutoCodeRefreshCard') {
      assert.equal(payload.offlineEnabled, false)
      assert.equal(payload.intervalMinutes, 60)
      assert.equal(payload.offlineDelaySeconds, 30)
    }
    else {
      assert.deepEqual(JSON.parse(JSON.stringify(payload.friendGids)), [10])
      assert.equal(payload.barkKeys[10], 'original')
    }
  })
}

test('keepalive is global while friend monitoring stays account-scoped', () => {
  const settings = readFileSync(new URL('../src/views/Settings.vue', import.meta.url), 'utf8')
  const feature = readFileSync(new URL('../src/components/settings/AccountFeatureSettings.vue', import.meta.url), 'utf8')
  const slot = settings.match(/<AccountFeatureSettings\b[^>]*>([\s\S]*?)<\/AccountFeatureSettings>/)?.[1]
  assert.doesNotMatch(settings, /<AutoCodeRefreshCard/)
  const global = readFileSync(new URL('../src/components/settings/SystemSettingsTab.vue', import.meta.url), 'utf8')
  assert.match(global, /<AutoCodeRefreshCard/)
  assert.match(global, /form.autoCodeRefresh/)
  assert.match(slot, /<FriendMonitorCard/)
  assert.match(feature, /v-if="loading && !saving"/)
  assert.match(feature, /<slot \/>/)
})

test('dialogs share focus management and block dismissal and edits during saving', () => {
  const dialog = readFileSync(new URL('../src/components/settings/AccountSettingsDialog.vue', import.meta.url), 'utf8')
  assert.match(dialog, /useModalFocus\(/)
  assert.match(dialog, /role="dialog" aria-modal="true"/)
  assert.match(dialog, /<fieldset :disabled="saving"/)
  assert.match(dialog, /@click\.self="!saving && emit\('cancel'\)"/)
})

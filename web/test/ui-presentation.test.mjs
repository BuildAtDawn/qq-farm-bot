/* eslint-disable test/no-import-node-test -- This repository runs tests with node --test. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loadTs(path, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, ...globals })
  return exports
}

function storageFixture(initial = {}) {
  const values = new Map(Object.entries(initial))
  const preferences = loadTs('../src/utils/ui-preferences.ts', {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  })
  return { preferences, values }
}

test('presentation preferences round-trip without writing any account or theme configuration', () => {
  const { preferences: p, values } = storageFixture({ ui_theme: 'dark-purple', account_settings: 'untouched', ui_farm_background: 'false' })
  assert.equal(p.readUiPreference(p.UI_PREFERENCES.compactDashboard, false), false)
  p.writeUiPreference(p.UI_PREFERENCES.compactDashboard, true)
  assert.equal(p.readUiPreference(p.UI_PREFERENCES.compactDashboard, false), true)
  assert.equal(values.get('ui_theme'), 'dark-purple')
  assert.equal(values.get('account_settings'), 'untouched')
  assert.equal(values.get('ui_farm_background'), 'false')
})

test('malformed and unavailable browser storage cannot prevent the UI from mounting', () => {
  const { preferences: p } = storageFixture({ corrupt: 'yes' })
  assert.equal(p.readUiPreference('corrupt', false), false)
  assert.equal(p.readUiPreference('corrupt', true), true)
  const denied = loadTs('../src/utils/ui-preferences.ts', {
    localStorage: {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('quota') },
    },
  })
  assert.equal(denied.readUiPreference('background', true), true)
  assert.doesNotThrow(() => denied.writeUiPreference('background', false))
})

test('new identity removes legacy inline colors and dark class, independent of saved palette', () => {
  const { preferences: p } = storageFixture({ ui_theme: 'dark-purple' })
  const removed = []
  p.initializeFarmAppearance({ classList: { remove: name => removed.push(name) }, style: { removeProperty: key => removed.push(key) } })
  assert.deepEqual(removed, ['dark', '--theme-bg', '--theme-text', '--theme-primary', '--theme-secondary', '--theme-gradient'])
})

test('desktop and mobile navigation retain public entries with research folded into analytics', () => {
  const m = loadTs('../src/router/menu.ts')
  const visible = m.visibleMenuRoutes(false)
  assert.equal(visible.length, 9)
  assert.equal(visible.some(item => item.name === 'analytics'), true)
  assert.equal(visible.some(item => item.name === 'mutations'), false)
  assert.equal(visible.some(item => item.name === 'debug'), false)
  assert.ok(visible.every(item => m.menuGroups.some(group => group.key === item.group)))
  assert.equal(new Set(visible.map(m.menuPath)).size, visible.length)
  assert.deepEqual(Array.from(visible.filter(item => item.mobileLabel), m.menuPath), ['/', '/personal', '/activity', '/settings'])
  assert.ok(visible.filter(item => !item.mobileLabel).every(item => item.group), 'all secondary pages remain in the drawer')
  m.menuRoutes.push({ path: 'fixture-admin', group: 'manage', adminOnly: true })
  assert.equal(m.visibleMenuRoutes(false).some(item => item.path === 'fixture-admin'), false)
  assert.equal(m.visibleMenuRoutes(true).some(item => item.path === 'fixture-admin'), true)
})

test('packaged background variants match their manifest and stay within the image budget', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/backgrounds/assets.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.assets.map(asset => asset.file), ['farm-day.webp', 'farm-day-mobile.webp', 'farm-market.webp'])
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(`../public/backgrounds/${asset.file}`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
    assert.equal(bytes.length, asset.bytes)
    assert.ok(bytes.length < (asset.file.includes('mobile') ? 150_000 : 300_000))
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
  }
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function fixture() {
  const account = { currentAccountId: 'a' }
  const saved = new Map()
  const posts = []
  const exports = {}
  const { outputText } = ts.transpileModule(readFileSync(new URL('../src/stores/setting.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      return {
        'pinia': { defineStore: (_name, setup) => setup },
        'vue': { ref: value => ({ value }) },
        '@/stores/account': { useAccountStore: () => account },
        '@/utils/notification-template': { normalizeNotificationTemplates: () => ({}) },
        '@/api': { default: {
          get: async (_path, options) => ({ data: { ok: true, data: saved.get(options.headers['x-account-id']) || {} } }),
          post: async (path, payload, options) => {
            const id = options.headers['x-account-id']
            posts.push({ path, id, payload })
            if (path === '/api/settings/save')
              saved.set(id, { ...payload })
            return { data: { ok: true } }
          },
        } },
      }[name]
    },
  })
  return { store: exports.useSettingStore(), account, posts }
}

test('exclusive mode survives saving and reading without changing primary or fallback strategies', async () => {
  const { store, posts } = fixture()
  const config = { ...store.settings.value, plantingStrategy: 'bag_priority', bagSeedFallbackStrategy: 'max_profit', onlyPlant2x2: true }
  await store.saveSettings('a', config)
  assert.equal(posts[0].id, 'a')
  assert.equal(posts[0].payload.onlyPlant2x2, true)
  assert.equal(store.settings.value.onlyPlant2x2, true)
  assert.equal(store.settings.value.plantingStrategy, 'bag_priority')
  assert.equal(store.settings.value.bagSeedFallbackStrategy, 'max_profit')
  await store.saveSettings('a', { ...config, onlyPlant2x2: false })
  assert.equal(store.settings.value.onlyPlant2x2, false)
  assert.equal(store.settings.value.bagSeedFallbackStrategy, 'max_profit')
})

test('switching to an account without exclusive mode cannot inherit the previous account flag', async () => {
  const { store, account } = fixture()
  await store.saveSettings('a', { ...store.settings.value, onlyPlant2x2: true })
  account.currentAccountId = 'b'
  store.clearSettingsState()
  assert.equal(store.settings.value.onlyPlant2x2, false)
  await store.fetchSettings('b')
  assert.equal(store.settings.value.onlyPlant2x2, false)
  account.currentAccountId = 'a'
  await store.fetchSettings('a')
  assert.equal(store.settings.value.onlyPlant2x2, true)
})

test('disabled bag fallback survives saving and reading settings', async () => {
  const { store, posts } = fixture()
  await store.saveSettings('a', { ...store.settings.value, plantingStrategy: 'bag_priority', bagSeedFallbackStrategy: 'none' })
  assert.equal(posts[0].payload.bagSeedFallbackStrategy, 'none')
  await store.fetchSettings('a')
  assert.equal(store.settings.value.bagSeedFallbackStrategy, 'none')
})

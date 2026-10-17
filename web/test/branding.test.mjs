/* eslint-disable test/no-import-node-test -- This repository runs tests with node --test. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function loadTs(path, globals = {}) {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, ...globals })
  return exports
}

const { FARM_BRAND } = loadTs('../src/utils/branding.ts')

test('browser and login share a versioned self-contained SVG identity', () => {
  const html = read('../index.html')
  assert.ok(html.includes(`href="${FARM_BRAND.icon}"`))
  assert.ok(html.includes('lang="zh-CN"'))
  assert.doesNotMatch(html, /<iframe/)
  const svg = read(`../public${FARM_BRAND.icon.split('?')[0]}`)
  assert.match(svg, /viewBox="0 0 64 64"/)
  assert.match(svg, /<title id="brand-title">/)
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|(?:href|src)=/)
  assert.ok(Buffer.byteLength(svg) < 2000)
  for (const path of ['../src/views/CodeLogin.vue']) {
    const source = read(path)
    assert.ok(source.includes(':src="FARM_BRAND.icon"'))
    assert.ok(source.includes('FARM_BRAND.tagline'))
    assert.doesNotMatch(source, /\/icon\.png/)
  }
})

test('signed-in navigation keeps a text-only brand without a redundant logo', () => {
  const source = read('../src/components/Sidebar.vue')
  const brand = source.split('<div class="farm-brand">')[1].split('<nav')[0]
  assert.doesNotMatch(brand, /<img|FARM_BRAND\.icon/)
  assert.ok(brand.includes('{{ brandTitle }}'))
  assert.ok(brand.includes('FARM_BRAND.tagline'))
})

test('login and dashboard use the same smart farm headline and supporting copy', () => {
  assert.equal(FARM_BRAND.headlineLead + FARM_BRAND.headlineTail, '智慧农场，让生长有数。')
  for (const path of ['../src/views/CodeLogin.vue', '../src/views/Dashboard.vue']) {
    const source = read(path)
    assert.ok(source.includes('FARM_BRAND.headlineLead'))
    assert.ok(source.includes('FARM_BRAND.headlineTail'))
    assert.ok(source.includes('FARM_BRAND.description'))
    assert.doesNotMatch(source, /把日常，|种成好时光|智慧耕作，轻松管理/)
  }
})

test('brand fallback changes no administrator-customized site title', () => {
  const document = { title: '' }
  const { useAppStore } = loadTs('../src/stores/app.ts', {
    document,
    require(id) {
      if (id === 'pinia')
        return { defineStore: (_id, setup) => setup }
      if (id === 'vue') {
        return {
          ref: value => ({ value }),
          computed: getter => ({ get value() { return getter() } }),
          watch: (source, callback, options) => options?.immediate && callback(source.value),
        }
      }
      if (id === '@/utils/branding')
        return { FARM_BRAND }
      if (id === '@/utils/ui-preferences')
        return { UI_PREFERENCES: {}, readUiPreference: (_key, fallback) => fallback }
      if (id === '@/api')
        return {}
      throw new Error(`Unexpected import ${id}`)
    },
  })
  const store = useAppStore()
  assert.equal(store.brandTitle.value, FARM_BRAND.name)
  assert.equal(document.title, FARM_BRAND.name)
  store.loginPageConfig.value.title = '我的智慧农场'
  assert.equal(store.brandTitle.value, '我的智慧农场')
  store.loginPageConfig.value.title = ''
  assert.equal(store.brandTitle.value, FARM_BRAND.name)
})

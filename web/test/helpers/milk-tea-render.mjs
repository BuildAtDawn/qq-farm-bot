import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

const nodeRequire = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url))
const cache = new Map()
const account = { currentAccountId: '' }

function load(path) {
  if (cache.has(path))
    return cache.get(path)
  const original = readFileSync(path, 'utf8')
  const source = path.endsWith('.vue')
    ? compileScript(parse(original, { filename: path }).descriptor, { id: 'tea-fixture', inlineTemplate: true }).content
    : original
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  const require = (name) => {
    if (name === 'vue')
      return Vue
    if (name === '@/api') {
      return { default: {
        get() {
          throw new Error('SSR fixture must not request a server')
        },
        post() {
          throw new Error('SSR fixture must not mutate')
        },
      } }
    }
    if (name === '@/stores/account')
      return { useAccountStore: () => account }
    // DOM focus and inert behavior is deliberately outside the SSR fixture.
    if (name === '@/composables/useModalFocus')
      return { useModalFocus() {} }
    if (name.endsWith('.css'))
      return {}
    if (name.startsWith('@/') || name.startsWith('.')) {
      const full = name.startsWith('@/') ? resolve(sourceRoot, name.slice(2)) : resolve(dirname(path), name)
      return load(/\.(?:vue|ts)$/.test(full) ? full : `${full}.ts`)
    }
    return nodeRequire(name)
  }
  vm.runInNewContext(code, { exports, require, console, Date, setInterval, clearInterval }, { filename: path })
  cache.set(path, exports)
  return exports
}

export async function renderTea(name, props = {}, accountId = 'fixture') {
  account.currentAccountId = accountId
  const component = load(resolve(sourceRoot, 'components/activity', name)).default
  const app = Vue.createSSRApp({ render: () => Vue.h(component, props) })
  app.component('RouterLink', { props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
  const context = {}
  const html = await renderToString(app, context)
  return `${html}${Object.values(context.teleports || {}).join('')}`
}

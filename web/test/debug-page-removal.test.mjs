import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/router/menu.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const exports = {}
vm.runInNewContext(outputText, { exports })

test('debug page is absent from both route registrations and every navigation role', () => {
  assert.equal(exports.menuRoutes.some(route => route.path === 'debug' || route.name === 'debug'), false)
  assert.doesNotMatch(source, /views\/Debug\.vue/)
  for (const isAdmin of [false, true]) {
    assert.equal(exports.visibleMenuRoutes(isAdmin).some(route => route.path === 'debug'), false)
    assert.ok(exports.visibleMenuRoutes(isAdmin).some(route => route.path === 'settings'))
  }
})

test('unregistered direct URLs still use the existing home fallback', () => {
  const router = readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8')
  assert.match(router, /children: menuRoutes\.map/)
  assert.match(router, /path: '\/:pathMatch\(\.\*\)\*', redirect: '\/'/)
  assert.doesNotMatch(router, /views\/Debug\.vue|path: ['"]\/?debug['"]|name: ['"]debug['"]/)
})

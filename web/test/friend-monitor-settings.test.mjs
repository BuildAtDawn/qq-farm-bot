import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const source = readFileSync(new URL('../src/components/settings/FriendMonitorCard.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = ts.createSourceFile('FriendMonitorCard.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const functions = script.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['loadFriends', 'toggleFriend'].includes(node.name?.text))
const { outputText } = ts.transpileModule(functions.map(node => node.getText(script)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } })

function fixture(get) {
  const context = vm.createContext({ props: { accountId: 'a' }, config: { value: { friendGids: [] } }, requestVersion: 0, fetching: { value: false }, error: { value: '' }, friends: { value: [] }, records: { value: [] }, api: { get } })
  vm.runInContext(outputText, context)
  return context
}

test('friend selection supports multiple gids without duplicates and allows removal', () => {
  const f = fixture(async () => {})
  f.toggleFriend(10, true)
  f.toggleFriend(20, true)
  f.toggleFriend(10, true)
  assert.deepEqual(Array.from(f.config.value.friendGids), [10, 20])
  f.toggleFriend(10, false)
  assert.deepEqual(Array.from(f.config.value.friendGids), [20])
})

test('account switch invalidates stale friend reads and preserves explicit captured account headers', async () => {
  let resolveOld
  const f = fixture(async (_path, options) => {
    if (options.headers['x-account-id'] === 'a')
      return new Promise((resolve) => { resolveOld = resolve })
    return { data: { ok: true, data: { friends: [{ gid: 20, name: 'B' }], records: [{ gid: 20 }] } } }
  })
  const old = f.loadFriends()
  f.props.accountId = 'b'
  f.requestVersion++
  f.fetching.value = false
  await f.loadFriends()
  resolveOld({ data: { ok: true, data: { friends: [{ gid: 10, name: 'A' }], records: [] } } })
  await old
  assert.equal(f.friends.value[0].name, 'B')
  assert.equal(f.records.value[0].gid, 20)
  assert.equal(f.fetching.value, false)
})

test('friend loading uses single-flight protection and leaves explicit failure feedback', async () => {
  let reject
  let calls = 0
  const f = fixture(async () => {
    calls++
    return new Promise((_resolve, failure) => {
      reject = failure
    })
  })
  const first = f.loadFriends()
  await f.loadFriends()
  assert.equal(calls, 1)
  reject(new Error('账号已停止'))
  await first
  assert.equal(f.error.value, '账号已停止')
  assert.equal(f.fetching.value, false)
  assert.equal(f.friends.value.length, 0)
})

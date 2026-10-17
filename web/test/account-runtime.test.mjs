import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/utils/account-runtime.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
const { getAccountRuntimeStatus, isAccountActive } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('relogin countdown uses seconds, rounds up, and never shows negative time', () => {
  const account = { runtimeState: 'relogin_waiting', reloginAt: 61000 }
  assert.equal(getAccountRuntimeStatus(account, 1000).text, '掉线重登，剩余 60 秒')
  assert.equal(getAccountRuntimeStatus(account, 59500).text, '掉线重登，剩余 2 秒')
  assert.equal(getAccountRuntimeStatus(account, 60000).text, '掉线重登，剩余 1 秒')
  assert.equal(getAccountRuntimeStatus(account, 61000).text, '掉线重登，即将登录')
  assert.equal(getAccountRuntimeStatus(account, 99999).text, '掉线重登，即将登录')
})

test('login and recovery are active before a Worker exists and must not be cleared as stopped accounts', () => {
  for (const runtimeState of ['logging_in', 'relogin_waiting']) {
    assert.equal(isAccountActive({ running: false, runtimeState }), true)
  }
  assert.equal(isAccountActive({ running: true, runtimeState: 'offline' }), true)
  assert.equal(isAccountActive({ running: false, runtimeState: 'stopped' }), false)
})

test('account cards distinguish each runtime phase and retain legacy fallback', () => {
  for (const [runtimeState, text, busy] of [
    ['logging_in', '登录中', true],
    ['running', '运行中', false],
    ['offline', '已掉线', false],
    ['stopping', '停止中', true],
    ['stopped', '已停止', false],
  ]) {
    const status = getAccountRuntimeStatus({ runtimeState, running: true }, 0)
    assert.equal(status.text, text)
    assert.equal(status.busy, busy)
  }
  assert.equal(getAccountRuntimeStatus({ running: true }, 0).text, '运行中')
  assert.equal(getAccountRuntimeStatus({ running: false }, 0).text, '已停止')
})

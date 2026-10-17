import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const require = createRequire(import.meta.url)
const definitions = require('../../core/src/config/notification-templates.json')
const backend = require('../../core/src/services/notification-templates.js')

const source = readFileSync(new URL('../src/utils/notification-template.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
const context = vm.createContext({ exports: {}, require: () => definitions })
vm.runInContext(outputText, context)
const utils = context.exports

test('both crop previews match backend test messages with independently edited templates', () => {
  const templates = utils.normalizeNotificationTemplates({ friend_crop_forecast: { title: '{好友名称} {地块数量}', content: '{作物明细}\n{成熟时间}' } })
  for (const event of ['friend_crop_forecast', 'friend_crop_mature']) {
    assert.equal(JSON.stringify(utils.previewCropNotification(event, templates)), JSON.stringify(backend.sampleCropNotification(event, templates)))
  }
})

test('variable insertion replaces selection, appends at caret and detects unknown variables', () => {
  const inserted = utils.insertTemplateVariable('成熟：这里。', '成熟时间', 3, 5)
  assert.equal(inserted.text, '成熟：{成熟时间}。')
  assert.equal(inserted.caret, 9)
  assert.equal(utils.insertTemplateVariable('标题', '好友名称', 2, 2).text, '标题{好友名称}')
  assert.deepEqual(Array.from(utils.unknownTemplateVariables('{成熟时间}{bad}{bad}')), ['bad'])
})

const accountSource = readFileSync(new URL('../src/components/settings/AccountSettingsTab.vue', import.meta.url), 'utf8')
const { descriptor } = parse(accountSource)
test('account cards retain colored credential countdown but hide the exact expiry date', () => {
  assert.match(accountSource, /useNow\(\{ interval: 1000 \}\)/)
  assert.match(descriptor.template.content, /getAccountRuntimeStatus\(acc, now.getTime\(\)\).text/)
  assert.match(descriptor.template.content, /emit\('refreshWxCodes'\)/)
  assert.match(descriptor.template.content, /<p v-if="acc.platform === 'wx'"[^>]*:class="credentialStatus\(acc\).color">\s*\{\{ credentialStatus\(acc\).text \}\}\s*<\/p>/)
  assert.equal(descriptor.template.content.includes('credentialStatus(acc).detail'), false)
  assert.equal(accountSource.includes('到期：'), false)
  assert.equal(descriptor.template.content.includes('expires_at'), false)
  assert.equal(descriptor.template.content.includes('授权到期时间'), false)
  assert.equal(descriptor.template.content.includes('最后更新'), false)
  assert.equal(descriptor.template.content.includes('wxCredentialRefreshError'), false)
})

const accountScript = ts.createSourceFile('Account.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const statusFunctions = accountScript.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'credentialStatus')
const statusCode = ts.transpileModule(statusFunctions.map(node => node.getText(accountScript)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

test('credential countdown retains time boundaries, colors and ticking updates', () => {
  const timestamp = Date.UTC(2026, 9, 17, 4)
  const now = { value: new Date(timestamp) }
  const f = vm.createContext({ now })
  vm.runInContext(statusCode, f)
  const account = { wxCredentialRefreshedAt: timestamp - 1799000 }
  assert.equal(f.credentialStatus(account).text, '访问凭证：剩余 1 小时 30 分 01 秒')
  assert.match(f.credentialStatus(account).color, /green/)
  const due = f.credentialStatus({ expires_at: timestamp + 2700000 })
  assert.match(due.text, /待续期/)
  assert.match(due.color, /amber/)
  assert.match(f.credentialStatus({ expires_at: timestamp + 2700001 }).color, /green/)
  const expired = f.credentialStatus({ expires_at: timestamp })
  assert.equal(expired.text, '访问凭证：已过期')
  assert.match(expired.color, /red/)
  assert.match(f.credentialStatus({ ...account, wxCredentialRefreshError: 'failed' }).color, /amber/)
  for (const wxCredentialRefreshedAt of [undefined, null, 0, -1, 'invalid', Infinity]) {
    const unknown = f.credentialStatus({ wxCredentialRefreshedAt })
    assert.equal(unknown.text, '访问凭证：到期时间未知')
    assert.match(unknown.color, /gray/)
  }
  assert.equal(f.credentialStatus({ wxCredentialRefreshedAt: timestamp + 1000 }).text, '访问凭证：时间异常')
  now.value = new Date(timestamp + 1000)
  assert.equal(f.credentialStatus(account).text, '访问凭证：剩余 1 小时 30 分 00 秒')
  now.value = new Date(timestamp + 62000)
  assert.equal(f.credentialStatus(account).text, '访问凭证：剩余 1 小时 28 分 59 秒')
})

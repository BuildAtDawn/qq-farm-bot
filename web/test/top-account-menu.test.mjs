/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const source = readFileSync(new URL('../src/components/TopAccountMenu.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = ts.createSourceFile('TopAccountMenu.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = [
  'openDropdown',
  'closeDropdown',
  'toggleDropdown',
  'updateDropdownPos',
  'onMenuFocusout',
  'selectAccount',
  'openAddAccount',
  'openRemarkModal',
]
const functions = script.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
assert.equal(functions.length, names.length)
const { outputText } = ts.transpileModule(functions.map(node => node.getText(script)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
})

function fixture() {
  const first = { id: 'first' }
  const second = { id: 'second' }
  const remark = {}
  const trigger = {
    contains: node => node === trigger,
    focus() { this.focused = true },
    getBoundingClientRect: () => ({ right: 380, bottom: 60 }),
  }
  const context = vm.createContext({
    showAccountDropdown: { value: false },
    showAccountModal: { value: false },
    showRemarkModal: { value: false },
    accountToEdit: { value: null },
    triggerRef: { value: trigger },
    menuSurface: {
      value: {
        contains: node => [first, second, remark].includes(node),
        querySelector: () => ({ focus() {} }),
      },
    },
    dropdownPos: { value: {} },
    window: { innerWidth: 390, innerHeight: 844 },
    nextTick: async () => {},
    accountStore: {
      currentAccount: first,
      setCurrentAccount(account) { this.currentAccount = account },
    },
  })
  vm.runInContext(outputText, context)
  return { context, first, second, remark, trigger }
}

test('touch blur without a related target keeps the account button mounted until click', async () => {
  const { context: c, second, trigger } = fixture()
  await c.openDropdown()
  c.onMenuFocusout({ relatedTarget: null })
  assert.equal(c.showAccountDropdown.value, true, 'blur must not remove the pending click target')
  c.selectAccount(second)
  assert.equal(c.accountStore.currentAccount, second)
  assert.equal(c.showAccountDropdown.value, false)
  assert.equal(trigger.focused, true)
})

test('focus moving between menu controls or back to the trigger keeps the menu open', async () => {
  const { context: c, first, second, remark, trigger } = fixture()
  for (const target of [first, second, remark, trigger]) {
    await c.openDropdown()
    c.onMenuFocusout({ relatedTarget: target })
    assert.equal(c.showAccountDropdown.value, true)
  }
})

test('keyboard focus moving outside still dismisses the menu without stealing focus', async () => {
  const { context: c, first, trigger } = fixture()
  await c.openDropdown()
  c.onMenuFocusout({ relatedTarget: {} })
  assert.equal(c.showAccountDropdown.value, false)
  assert.equal(c.accountStore.currentAccount, first)
  assert.equal(trigger.focused, undefined)
})

test('backdrop and Escape keep their close handler; reopening and switching still work', async () => {
  assert.match(descriptor.template.content, /class="fixed inset-0[^"]*"[\s\S]*?@click="closeDropdown"/)
  assert.match(descriptor.template.content, /@keydown\.escape\.stop\.prevent="closeDropdown"/)
  assert.match(descriptor.template.content, /@focusout="onMenuFocusout"/)
  assert.match(descriptor.template.content, /@click="selectAccount\(acc\)"/)
  const { context: c, second } = fixture()
  await c.openDropdown()
  c.closeDropdown()
  assert.equal(c.showAccountDropdown.value, false)
  c.toggleDropdown()
  await c.nextTick()
  assert.equal(c.showAccountDropdown.value, true)
  c.selectAccount(second)
  assert.equal(c.accountStore.currentAccount, second)
})

test('touch blur also leaves add-account and remark actions available', async () => {
  const { context: c, second } = fixture()
  await c.openDropdown()
  c.onMenuFocusout({ relatedTarget: null })
  assert.equal(c.showAccountDropdown.value, true)
  c.openRemarkModal(second)
  assert.equal(c.showRemarkModal.value, true)
  assert.equal(c.accountToEdit.value, second)
  assert.equal(c.showAccountDropdown.value, false)
  await c.openDropdown()
  c.onMenuFocusout({ relatedTarget: null })
  assert.equal(c.showAccountDropdown.value, true)
  c.openAddAccount()
  assert.equal(c.showAccountModal.value, true)
  assert.equal(c.accountToEdit.value, null)
  assert.equal(c.showAccountDropdown.value, false)
})

/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

function loadComponent(name) {
  const filename = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const compiled = compileScript(descriptor, { id: name, inlineTemplate: true }).content
  const { outputText } = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    require: name => name === 'vue' ? Vue : { default: loadComponent('DailyTaskDetails') },
  })
  return exports.default
}

const Details = loadComponent('DailyTaskDetails')
const Overview = loadComponent('DailyOverview')
function task(id, overrides = {}) {
  return {
    id,
    desc: `夹具任务${id}`,
    progress: 2,
    totalProgress: 5,
    isClaimed: false,
    isUnlocked: true,
    isCompleted: false,
    canClaim: false,
    ...overrides,
  }
}
const render = props => renderToString(Vue.createSSRApp({ render: () => Vue.h(Details, props) }))

test('details render descriptions, real progress, rewards and completion states', async () => {
  const html = await render({ tasks: [
    task(1, { rewardSummary: '金币200/经验30' }),
    task(2, { canClaim: true, isCompleted: true, progress: 5 }),
    task(3, { isClaimed: true, isCompleted: true, progress: 0 }),
    task(4, { isUnlocked: false }),
  ] })
  for (const text of ['夹具任务1', '进度：2/5', '金币200/经验30', '进行中', '待领取', '已领取', '未解锁'])
    assert.ok(html.includes(text), text)
  assert.match(html, /width:40%/)
  assert.match(html, /aria-valuenow="100"/)
})

test('missing targets are not fabricated; empty and failed details stay distinct', async () => {
  const unknown = await render({ tasks: [task(1, { totalProgress: 0 })] })
  assert.match(unknown, /进度：2/)
  assert.doesNotMatch(unknown, /2\/0|progressbar|NaN|Infinity/)
  assert.match(await render({ tasks: [] }), /暂无每日任务详情/)
  const failed = await render({ tasks: [], error: '详情读取失败' })
  assert.match(failed, /详情读取失败/)
  assert.doesNotMatch(failed, /暂无每日任务详情/)
})

function mountOverview(props) {
  const node = (type, text = '') => ({ type, text, children: [], props: {}, parent: null })
  const renderer = Vue.createRenderer({
    createElement: type => node(type),
    createText: text => node('#text', text),
    createComment: text => node('#comment', text),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => {
      node.text = text
      node.children = []
    },
    patchProp: (node, key, _previous, value) => { node.props[key] = value },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    insert(node, parent, anchor = null) {
      if (node.parent)
        node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    },
    remove(node) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = null
    },
  })
  const root = node('root')
  const app = renderer.createApp({ render: () => Vue.h(Overview, props) })
  app.mount(root)
  const find = (predicate) => {
    const visit = node => predicate(node) ? node : node.children.map(visit).find(Boolean)
    return visit(root)
  }
  return { app, find }
}

test('only daily task card is a button and toggles details; clearing account data closes it', async () => {
  const props = Vue.reactive({ dailyGifts: { gifts: [
    { key: 'task_claim', label: '每日任务', tasks: [task(1)], doneToday: false },
    { key: 'email_rewards', label: '邮箱奖励', doneToday: false },
  ] } })
  const mounted = mountOverview(props)
  const button = mounted.find(node => node.type === 'button')
  assert.equal(button.props['aria-expanded'], false)
  assert.equal(mounted.find(node => node.props['aria-label'] === '每日任务详情'), undefined)
  button.props.onClick()
  await Vue.nextTick()
  assert.equal(button.props['aria-expanded'], true)
  assert.ok(mounted.find(node => node.props['aria-label'] === '每日任务详情'))
  button.props.onClick()
  await Vue.nextTick()
  assert.equal(button.props['aria-expanded'], false)
  button.props.onClick()
  await Vue.nextTick()
  props.dailyGifts = null
  await Vue.nextTick()
  props.dailyGifts = { gifts: [{ key: 'task_claim', label: '每日任务', tasks: [task(2)] }] }
  await Vue.nextTick()
  assert.equal(mounted.find(node => node.type === 'button').props['aria-expanded'], false)
  mounted.app.unmount()
})

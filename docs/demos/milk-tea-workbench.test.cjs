const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Small DOM stand-in: verify the standalone fixture without opening a browser.
function demo() {
  const html = fs.readFileSync(path.join(__dirname, 'milk-tea-workbench.html'), 'utf8');
  const nodes = new Map();
  const listeners = {};
  const selection = [];
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', dataset: {}, open: false,
      close() { this.open = false; }, showModal() { this.open = true; }, addEventListener() {},
    });
    return nodes.get(id);
  }
  const entries = [element('desktop'), element('mobile')];
  const context = vm.createContext({
    Intl, Date, console, setTimeout: () => 1, clearTimeout() {},
    document: {
      getElementById: element,
      querySelectorAll: s => s === '[data-entries]' ? entries : s.includes('craft') ? selection : [],
      querySelector: s => s.includes('duration') ? { value: '12', dataset: { cost: '130' } } : null,
      addEventListener: (event, handler) => { listeners[event] = handler; },
    },
  });
  const run = code => vm.runInContext(code, context);
  run(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const click = data => listeners.click({ target: { closest: () => ({ disabled: false, dataset: data, querySelector: () => null }) } });
  return { html, run, click, element, entries, selection };
}

test('all preview scenarios render without account access or missing resources', () => {
  const d = demo();
  const scenarios = [...d.html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  for (const scenario of scenarios) {
    d.run(`reset('${scenario}')`);
    if (['empty', 'loading', 'error', 'ended', 'not-open'].includes(scenario)) assert(d.element('live-content').hidden);
  }
  const assets = new Set([...d.html.matchAll(/src="(\.\.\/[^"$]+)"/g)].map(m => path.resolve(__dirname, m[1])));
  d.run('reset()');
  const kinds = ['work', 'rewards', 'fund', 'hire', 'market', 'recipes', 'levels', 'sales', 'rank', 'automation', 'rules', 'boost', 'rename', 'create', 'upgrade', 'estimate', 'invite', 'share', 'share-log', 'show-off', 'settings', 'recipe:1', 'recipe:4', 'interact:1'];
  for (const kind of kinds) {
    d.run(`open('${kind}')`);
    assert(d.element('dialog-content').innerHTML.length > 20, kind);
    for (const m of d.element('dialog-content').innerHTML.matchAll(/src="([^"]+)"/g)) assets.add(path.resolve(__dirname, m[1]));
  }
  for (const f of assets) assert(fs.existsSync(f), f);
  assert.doesNotMatch(d.html, /\bfetch\(|XMLHttpRequest|localStorage/);
});

test('inventory is horizontal, keeps details and updates estimates after crafting', () => {
  const d = demo();
  assert.equal(d.run('totals().income'), 7140);
  assert.equal(d.element('eta').textContent, '10/17 20:00');
  assert.equal((d.element('inventory').innerHTML.match(/class="stock-item"/g) || []).length, 3);
  assert.match(d.element('inventory').innerHTML, /recipe:1/);
  d.selection.push({ value: '2' }, { value: '3' });
  d.click({ action: 'craft' });
  assert.equal(d.run('totals().cups'), 500);
  assert.equal(d.run('totals().income'), 7348);
  assert(d.element('craft').hidden);
  d.run('reset("no-material")');
  assert(d.element('craft').hidden);
  assert.match(d.element('inventory').innerHTML, /甜莓奶茶/);
});

test('work preserves all five interactions, confirmation, limits, wages and history', () => {
  const d = demo();
  d.run('open("work")');
  for (const text of ['宣传推广', '花式摇杯', '招牌试饮', '划水摸鱼', '申请涨薪', '历史工作记录', '最终工资', '工作时长', '互动收益', '允许被雇佣', '本班互动', '晚风茶室']) assert(d.element('dialog-content').innerHTML.includes(text), text);
  assert.doesNotMatch(d.element('dialog-content').innerHTML, /data-open="invite"|邀请好友/);
  d.click({ open: 'interact:2' });
  assert.match(d.element('dialog-content').innerHTML, /确认互动/);
  d.click({ action: 'interact', id: '2' });
  assert(d.run('state.interacted'));
  assert.match(d.element('dialog-content').innerHTML, /本班互动次数已用完/);
  assert.match(d.element('dialog-content').innerHTML, /花式摇杯 · 固定演示结果/);
  assert.equal((d.element('dialog-content').innerHTML.match(/data-open="interact:\d" disabled/g) || []).length, 5);
  d.click({ action: 'interact', id: '5' });
  assert.match(d.run('state.interactionResult'), /花式摇杯/);
  d.run('reset("idle");open("work")');
  assert.match(d.element('dialog-content').innerHTML, /晚风茶室/);
  d.run('reset("no-history");open("work")');
  assert.match(d.element('dialog-content').innerHTML, /暂无工作记录/);
  d.run('reset("wages")'); d.click({ action: 'wages' });
  assert.equal(d.run('state.balance'), 12990);
  assert.match(d.element('dialog-content').innerHTML, /历史工作记录/);
  assert.match(d.entries[0].innerHTML, /空闲/);
});

test('automation status uses explicit on/off indicators in detail and preview', () => {
  const d = demo();
  d.run('open("automation")');
  const html = d.element('dialog-content').innerHTML;
  assert.equal((html.match(/class="automation-row"/g) || []).length, 12);
  assert.equal((html.match(/>已开启<\/span>/g) || []).length, 10);
  assert.equal((html.match(/>已关闭<\/span>/g) || []).length, 2);
  for (const text of ['10 项开启', '2 项关闭', '状态只读', 'auto-track', '账号设置']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /role="switch"|<input|data-action="toggle/);
  const preview = d.element('automation-preview').innerHTML;
  assert.equal((preview.match(/class="auto-state on"/g) || []).length, 3);
  assert.equal((preview.match(/class="auto-state off"/g) || []).length, 1);
});

test('quantity selection, hire, daily reward, rename, boost and upgrade remain usable', () => {
  const d = demo();
  d.click({ buy: '1' }); assert.equal(d.run('state.balance'), 12860);
  assert.match(d.element('dialog-content').innerHTML, /兑换数量/);
  d.click({ action: 'quantity-more' }); d.click({ action: 'purchase-confirm' });
  assert.equal(d.run('state.balance'), 12700); assert.equal(d.run('goods[0].remaining'), 106);
  d.run('reset();open("hire")');
  for (const text of ['好友', '实习员工', '暂不可雇佣', '员工位 2', '4 小时', '12 小时', '24 小时']) assert(d.element('dialog-content').innerHTML.includes(text), text);
  d.click({ action: 'hire' }); assert.equal(d.run('state.staff'), 2);
  d.click({ action: 'daily' }); assert(d.run('state.dailyClaimed'));
  d.element('shop-name-input').value = '新茶铺'; d.click({ action: 'save-name', mode: 'rename' });
  assert.equal(d.element('shop-name').textContent, '新茶铺');
  d.run('reset()'); d.click({ action: 'boost' });
  assert.equal(d.run('state.boosts'), 1); assert.equal(d.run('totals().cups'), 440);
  d.run('reset("upgrade-ready")'); d.click({ action: 'upgrade' });
  assert.equal(d.run('state.level'), 4); assert.equal(d.element('current-level').textContent, 'Lv.4');
  d.run('reset("not-open")'); d.element('shop-name-input').value = '开业茶铺';
  d.click({ action: 'save-name', mode: 'create' }); assert.equal(d.element('live-content').hidden, false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const push = require('../src/services/push');
const { registerAdminSettingsRoutes } = require('../src/controllers/admin-settings-routes');

function harness({ accessible = true, publicWebOrigin = '' } = {}) {
  const routes = new Map();
  registerAdminSettingsRoutes({
    app: Object.fromEntries(['get', 'post', 'put'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    store: {
      getOfflineReminder: () => ({ smtpEnabled: false, barkEnabled: false }),
      getAccounts: () => ({ accounts: [{ id: 'a1', name: '账号甲' }] }),
      getSystemSettings: () => ({ publicWebOrigin }),
    },
    getAccountIdFromRequest: req => req.headers?.['x-account-id'] || '',
    canAccessAccount: () => accessible,
  });
  return async (req) => {
    let status = 200;
    let body;
    const res = { status: code => { status = code; return res; }, json: value => { body = value; return res; } };
    await routes.get('post /api/settings/offline-reminder/test')(req, res);
    return { status, body };
  };
}

test('crop event tests use custom draft templates and selected channels without farm requests', async (t) => {
  const original = push.sendBarkMessage;
  const calls = [];
  push.sendBarkMessage = async message => { calls.push(message); return { ok: true }; };
  t.after(() => { push.sendBarkMessage = original; });
  const invoke = harness();
  for (const testEvent of ['friend_crop_forecast', 'friend_crop_mature']) {
    const body = { testEvent, smtpEnabled: false, barkEnabled: true, barkTestKey: 'test-key', events: { [testEvent]: ['bark'] }, templates: { [testEvent]: { title: `${testEvent} {好友名称}`, content: '{地块数量}块 {成熟时间}' } } };
    assert.equal((await invoke({ currentUser: { username: 'alice' }, body })).status, 200);
    assert.equal(calls.at(-1).title, `${testEvent} 我的大号`);
    assert.match(calls.at(-1).content, /块 今天 12:00/);
    body.events[testEvent] = [];
    assert.equal((await invoke({ currentUser: { username: 'alice' }, body })).status, 400);
  }
  assert.equal(calls.length, 2);
  assert.equal((await invoke({ currentUser: { username: 'alice' }, body: { testEvent: 'bad' } })).status, 400);
  assert.equal((await invoke({ currentUser: { username: 'alice' }, body: { templates: { friend_crop_forecast: { title: '{bad}' } } } })).status, 400);
});

test('测试接口只通知已开启的渠道，使用当前账号名和自定义标题说明', async (t) => {
  const original = push.sendBarkMessage;
  const calls = [];
  push.sendBarkMessage = async message => { calls.push(message); return { ok: true, msg: '已受理' }; };
  t.after(() => { push.sendBarkMessage = original; });
  const invoke = harness();
  const result = await invoke({ currentUser: { username: 'alice' }, headers: { 'x-account-id': 'a1' }, body: { smtpEnabled: false, barkEnabled: true, barkTestKey: 'fake-token', title: '自定义标题', msg: '自定义说明' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(calls[0].title, '自定义标题（测试）');
  assert.match(calls[0].content, /自定义说明\n账号名称: 账号甲/);
});

test('全关、未登录及无账号权限不会发出任何请求', async (t) => {
  const original = push.sendBarkMessage;
  push.sendBarkMessage = async () => { assert.fail('不应发送通知'); };
  t.after(() => { push.sendBarkMessage = original; });
  assert.equal((await harness()({ body: {} })).status, 401);
  assert.equal((await harness({ accessible: false })({ currentUser: { username: 'alice' }, headers: { 'x-account-id': 'a1' }, body: { barkEnabled: true } })).status, 403);
  const disabled = await harness()({ currentUser: { username: 'alice' }, body: { smtpEnabled: false, barkEnabled: false } });
  assert.equal(disabled.status, 400);
  assert.match(disabled.body.error, /至少开启/);
});

test('部分渠道失败时测试接口包含各渠道结果，成功渠道仍发送', async (t) => {
  const smtp = push.sendSmtpEmail;
  const bark = push.sendBarkMessage;
  let sent = false;
  push.sendSmtpEmail = async () => { throw new Error('secret'); };
  push.sendBarkMessage = async () => { sent = true; return { ok: true, msg: '已受理' }; };
  t.after(() => { push.sendSmtpEmail = smtp; push.sendBarkMessage = bark; });
  const result = await harness()({ currentUser: { username: 'alice' }, body: { smtpEnabled: true, barkEnabled: true, barkTestKey: 'fake-token' } });
  assert.equal(result.status, 400);
  assert.equal(sent, true);
  assert.deepEqual(result.body.data.results.map(item => item.ok), [false, true]);
  assert.doesNotMatch(JSON.stringify(result.body), /secret/);
});

test('channel-specific tests bypass event subscription without sending the other enabled channel', async t => {
  const smtp = push.sendSmtpEmail;
  const bark = push.sendBarkMessage;
  const calls = [];
  push.sendSmtpEmail = async () => { calls.push('smtp'); return { ok: true }; };
  push.sendBarkMessage = async () => { calls.push('bark'); return { ok: true }; };
  t.after(() => { push.sendSmtpEmail = smtp; push.sendBarkMessage = bark; });
  const result = await harness()({ currentUser: { username: 'alice' }, body: {
    smtpEnabled: true, barkEnabled: true, testChannel: 'smtp', events: { account_offline: [] },
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ['smtp']);
});

test('Bark tests use only transient Key, selected event level and do not need a selected account or enabled channel', async t => {
  const original = push.sendBarkMessage;
  const calls = [];
  push.sendBarkMessage = async payload => { calls.push(payload); return { ok: true }; };
  t.after(() => { push.sendBarkMessage = original; });
  const invoke = harness();
  const body = { testChannel: 'bark', testEvent: 'friend_crop_mature', barkTestKey: 'test-key', barkEnabled: false,
    barkAccountKeys: { a1: 'never-use' }, barkLevels: { friend_crop_mature: 'critical' }, events: { friend_crop_mature: [] } };
  assert.equal((await invoke({ currentUser: { username: 'alice' }, body })).status, 200);
  assert.equal(calls[0].key, 'test-key');
  assert.equal(calls[0].level, 'critical');
  assert.equal((await invoke({ currentUser: { username: 'alice' }, body: { ...body, barkTestKey: '' } })).status, 400);
  assert.equal((await invoke({ currentUser: { username: 'alice' }, body: { ...body, testChannel: 'xtuis' } })).status, 400);
  assert.equal(calls.length, 1);
});

test('maturity reminder tests attach the saved system domain, other events omit URL and request bodies cannot replace it', async t => {
  const original = push.sendBarkMessage;
  const calls = [];
  push.sendBarkMessage = async payload => { calls.push(payload); return { ok: true }; };
  t.after(() => { push.sendBarkMessage = original; });
  const invoke = harness({ publicWebOrigin: 'https://123.com' });
  for (const testEvent of ['friend_crop_forecast', 'friend_crop_mature', 'account_offline']) {
    const result = await invoke({ currentUser: { username: 'alice' }, body: {
      testChannel: 'bark', testEvent, barkTestKey: 'test-key', notificationUrl: 'https://ignored.example',
    } });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(calls.map(payload => payload.url), [undefined, 'https://123.com/open-weixin.html', undefined]);
});

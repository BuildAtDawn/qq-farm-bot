const test = require('node:test');
const assert = require('node:assert/strict');
const { enabledNotificationChannels, buildOfflineNotification, sendOfflineNotifications } = require('../src/services/offline-notification');
const { sendBarkMessage } = require('../src/services/push');
const { createReloginReminderService } = require('../src/runtime/relogin-reminder');

for (const smtpEnabled of [false, true]) {
  for (const barkEnabled of [false, true]) {
    test(`渠道组合: 邮件=${smtpEnabled}, Bark=${barkEnabled}`, async () => {
      const calls = [];
      const config = { smtpEnabled, barkEnabled, barkKey: 'fake-token' };
      const result = await sendOfflineNotifications(config, buildOfflineNotification(config, { accountName: '农场 A' }), {
        sendSmtpEmail: async payload => { calls.push('smtp'); assert.match(payload.content, /账号名称: 农场 A/); return { ok: true }; },
        sendBarkMessage: async payload => { calls.push('bark'); assert.match(payload.content, /账号名称: 农场 A/); return { ok: true }; },
      });
      assert.deepEqual(calls.sort(), [smtpEnabled && 'smtp', barkEnabled && 'bark'].filter(Boolean).sort());
      assert.equal(result.ok, smtpEnabled || barkEnabled);
    });
  }
}

test('标题说明使用自定义文本，账号名和下线上下文始终附带', () => {
  assert.deepEqual(buildOfflineNotification({ title: '快来看看', msg: '请重新登录\n第二行' }, { accountName: 'kk', reason: '异地登录', offlineMs: 120000 }), {
    title: '快来看看', content: '请重新登录\n第二行\n账号名称: kk\n原因: 异地登录\n离线时长: 2 分钟',
  });
  assert.match(buildOfflineNotification({}, { test: true }).content, /账号名称: 测试账号/);
});

test('一个渠道异常不阻止另一个渠道发送，错误不包含密钥', async () => {
  let sent = false;
  const result = await sendOfflineNotifications({ smtpEnabled: true, barkEnabled: true, barkKey: 'fixture' }, { title: '标题', content: '说明' }, {
    sendSmtpEmail: async () => { throw new Error('password=secret'); },
    sendBarkMessage: async () => { sent = true; return { ok: true, msg: '已受理' }; },
  });
  assert.equal(sent, true);
  assert.equal(result.ok, false);
  assert.equal(result.results[1].ok, true);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('Bark uses JSON POST with device key, exact content and configurable level', async () => {
  const result = await sendBarkMessage({ key: 'fake-token', title: '标题 & ? #', content: '账号名称: A\n说明=100%', level: 'critical' }, async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.day.app');
    assert.equal(url.pathname, '/push');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { device_key: 'fake-token', title: '标题 & ? #', body: '账号名称: A\n说明=100%', level: 'critical' });
    assert.equal(options.timeout, 10000);
    return { ok: true, json: async () => ({ code: 200, message: 'success' }) };
  });
  assert.equal(result.ok, true);
});

test('Bark拒绝 HTTP 错误、业务失败及未知响应，网络异常隐藏 Token', async () => {
  const payload = { key: 'private-token', title: '标题', content: '说明' };
  for (const response of [
    { ok: false, status: 429 },
    { ok: true, json: async () => ({ code: 403, message: 'private-token' }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => ({ success: true }) },
    { ok: true, json: async () => ({ code: '200' }) },
  ]) assert.equal((await sendBarkMessage(payload, async () => response)).ok, false);
  await assert.rejects(sendBarkMessage(payload, async () => { throw new Error('URL contains private-token'); }), error => !error.message.includes('private-token'));
  await assert.rejects(sendBarkMessage({ ...payload, key: '../other?token' }), /格式无效/);
  await assert.rejects(sendBarkMessage({ ...payload, level: 'unknown' }), /等级无效/);
  await assert.rejects(sendBarkMessage(payload, async () => ({ ok: true, json: async () => { throw new Error('private-token'); } })), /Bark 请求失败/);
});

test('运行时按账号所属用户取配置，缺省账号名从账号记录补全', async () => {
  const calls = [];
  const service = createReloginReminderService({
    store: { getOfflineReminder: username => { assert.equal(username, 'alice'); return { smtpEnabled: false, barkEnabled: true, barkAccountKeys: { a1: 'fake-token' }, title: '自定义', msg: '说明' }; } },
    getAccounts: () => ({ accounts: [{ id: 'a1', username: 'alice', name: '小农场' }] }),
    sendBarkMessage: async message => { calls.push(message); return { ok: true }; },
    log: () => {},
  });
  await service.triggerOfflineReminder({ accountId: 'a1', reason: 'kickout' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, '自定义');
  assert.match(calls[0].content, /账号名称: 小农场/);
});

test('旧邮件配置兼容，显式关闭优先于历史 channel 字段', () => {
  const legacy = { channel: 'smtp', smtpHost: 'host', smtpUser: 'user', smtpPass: 'pass', recipientEmail: 'recipient' };
  assert.deepEqual(enabledNotificationChannels(legacy), ['smtp']);
  assert.deepEqual(enabledNotificationChannels({ ...legacy, smtpEnabled: false, barkEnabled: false }), []);
  assert.deepEqual(enabledNotificationChannels({}), []);
});

test('Bark optional URL reaches JSON body and unsafe schemes are rejected before sending', async () => {
  const payload = { key: 'fake-key', title: 'title', content: 'content', url: 'https://123.com/open-weixin.html' };
  const result = await sendBarkMessage(payload, async (_url, options) => {
    assert.equal(JSON.parse(options.body).url, payload.url);
    return { ok: true, json: async () => ({ code: 200 }) };
  });
  assert.equal(result.ok, true);
  for (const url of ['javascript:alert(1)', 'weixin://dl/business/', 'https://user:pass@example.com', '/relative']) {
    await assert.rejects(sendBarkMessage({ ...payload, url }, () => assert.fail('must not send')), /跳转地址无效/);
  }
});

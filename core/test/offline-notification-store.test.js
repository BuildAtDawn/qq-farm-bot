const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-notification-'));
process.env.FARM_DATA_DIR = dataDir;
fs.writeFileSync(path.join(dataDir, 'store.json'), JSON.stringify({ userOfflineReminders: { legacy: {
  channel: 'smtp', smtpHost: 'host', smtpUser: 'user', smtpPass: 'pass', recipientEmail: 'recipient', emailContent: '旧自定义内容',
} } }));
const store = require('../src/models/store');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('历史邮件设置迁移，保留自定义说明', () => {
  const config = store.getOfflineReminder('legacy');
  assert.equal(config.smtpEnabled, true);
  assert.equal(config.barkEnabled, false);
  assert.equal(config.msg, '旧自定义内容');
});

test('四种渠道状态持久化，全部关闭不会因旧 channel 回启', () => {
  for (const smtpEnabled of [false, true]) for (const barkEnabled of [false, true]) {
    store.setOfflineReminder({ smtpEnabled, barkEnabled, barkAccountKeys: { a1: 'fake-token' }, barkTestKey: 'transient-key', title: '标题', msg: '说明' }, 'legacy');
    const config = store.getOfflineReminder('legacy');
    assert.equal(config.smtpEnabled, smtpEnabled);
    assert.equal(config.barkEnabled, barkEnabled);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'))).userOfflineReminders.legacy;
    assert.equal(saved.smtpEnabled, smtpEnabled);
    assert.equal(saved.barkEnabled, barkEnabled);
    assert.deepEqual(saved.barkAccountKeys, { a1: 'fake-token' });
    assert.equal(saved.barkTestKey, undefined);
    assert.equal(saved.msg, '说明');
  }
  assert.deepEqual(store.getOfflineReminder('other').barkAccountKeys, {});
});

test('event subscriptions persist independently and reject unknown channels without leaking another user configuration', () => {
  store.setOfflineReminder({ events: {
    account_offline: [], friend_crop_forecast: ['smtp', 'smtp', 'fake'], friend_crop_mature: ['bark'],
  } }, 'alice');
  const config = store.getOfflineReminder('alice');
  assert.deepEqual(config.events, { account_offline: [], friend_crop_forecast: ['smtp'], friend_crop_mature: ['bark'] });
  store.setOfflineReminder({ title: 'new title' }, 'alice');
  assert.deepEqual(store.getOfflineReminder('alice').events, config.events);
  assert.deepEqual(store.getOfflineReminder('bob').events.account_offline, ['smtp', 'bark']);
});

test('crop templates persist per user and partial edits preserve both event templates', () => {
  store.setOfflineReminder({ templates: { friend_crop_forecast: { title: '预告 {好友名称}', content: '{作物明细}' }, friend_crop_mature: { title: '提醒 {好友名称}' } } }, 'alice');
  store.setOfflineReminder({ templates: { friend_crop_forecast: { title: '更新 {好友名称}' } } }, 'alice');
  const config = store.getOfflineReminder('alice');
  assert.equal(config.templates.friend_crop_forecast.content, '{作物明细}');
  assert.equal(config.templates.friend_crop_mature.title, '提醒 {好友名称}');
  assert.equal(store.getOfflineReminder('bob').templates.friend_crop_forecast.title, '成熟预告｜{好友名称}');
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'))).userOfflineReminders.alice;
  assert.deepEqual(saved.templates, config.templates);
});

test('legacy shrimp push is removed; Bark levels persist with safe defaults and partial updates', () => {
  store.setOfflineReminder({ channel: 'xtuis', xtuisEnabled: true, xtuisToken: 'obsolete', token: 'obsolete',
    events: { account_offline: ['xtuis', 'bark'] }, barkLevels: { friend_crop_mature: 'passive' } }, 'old');
  const config = store.getOfflineReminder('old');
  assert.equal(config.barkEnabled, false);
  assert.equal(config.xtuisToken, undefined);
  assert.equal(config.token, '');
  assert.deepEqual(config.events.account_offline, ['bark']);
  store.setOfflineReminder({ barkLevels: { account_offline: 'active', friend_crop_forecast: 'invalid' } }, 'old');
  assert.deepEqual(store.getOfflineReminder('old').barkLevels, { account_offline: 'active', friend_crop_forecast: 'timeSensitive', friend_crop_mature: 'passive' });
});

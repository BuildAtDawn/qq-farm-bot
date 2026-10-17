const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNotificationTemplates, validateNotificationTemplates, renderNotificationTemplate, sampleCropNotification } = require('../src/services/notification-templates');
const { buildCropNotification } = require('../src/services/friend-monitor-plan');
const { formatMaturityTime } = require('../src/services/friend-monitor-plan');

test('legacy templates receive independent defaults and reject invalid input', () => {
  const a = normalizeNotificationTemplates();
  const b = normalizeNotificationTemplates();
  a.friend_crop_forecast.title = 'changed';
  assert.equal(b.friend_crop_forecast.title, '成熟预告｜{好友名称}');
  assert.match(validateNotificationTemplates({ friend_crop_mature: { content: '{不存在}' } }), /未知通知变量/);
  assert.match(validateNotificationTemplates({ friend_crop_mature: { title: ' ' } }), /不能为空/);
  assert.match(validateNotificationTemplates({ friend_crop_mature: { title: 'x'.repeat(201) } }), /长度/);
  assert.equal(validateNotificationTemplates(b), '');
});

test('variables are substituted once and unrecognized placeholders never execute code', () => {
  assert.deepEqual(renderNotificationTemplate({ title: '{好友名称}', content: '{成熟时间}\n{constructor}' }, { 好友名称: '{成熟时间}', 成熟时间: '<hello>' }), {
    title: '{成熟时间}', content: '<hello>\n{constructor}',
  });
});

test('live crop templates retain minute batches, exact maturity and 2x2 plant/land counts', () => {
  const nowSec = Date.UTC(2026, 9, 11, 3, 30) / 1000;
  const groups = [
    { matureAt: nowSec + 1800, crops: [{ name: '草莓', count: 6, landCount: 6, size: 1 }] },
    { matureAt: nowSec + 2100, crops: [{ name: '大作物', count: 1, landCount: 4, size: 2 }] },
  ];
  const templates = { friend_crop_forecast: { title: '{好友名称}：{地块数量}块/{作物数量}株', content: '{成熟时间}\n{剩余分钟}\n{作物名称}\n{作物明细}\n{账号名称}' } };
  const message = buildCropNotification('friend_crop_forecast', { friendName: '大号', accountName: '小号', groups, nowSec, templates });
  assert.equal(message.title, '大号：10块/7株');
  assert.match(message.content, /今天 12:00 · 还有 30 分钟\n30/);
  assert.match(message.content, /今天 12:05 · 还有 35 分钟\n大作物 1 株（占 4 块地）/);
  const matured = buildCropNotification('friend_crop_mature', { friendName: '大号', accountName: '小号', groups, nowSec: nowSec + 2000 });
  assert.equal(matured.title, '已成熟｜大号');
  assert.match(matured.content, /^共 10 块地 · 7 株作物\n\n/);
  assert.match(matured.content, /大作物 1 株（占 4 块地）/);
  assert.match(matured.content, /监听账号：小号 · 北京时间$/);
  assert.equal(normalizeNotificationTemplates(templates).friend_crop_forecast.content, templates.friend_crop_forecast.content);
});

test('forecast and near test examples render the actual edited templates independently', () => {
  const templates = { friend_crop_mature: { title: '提醒 {好友名称}', content: '{地块数量}块 {成熟时间}' } };
  assert.deepEqual(sampleCropNotification('friend_crop_mature', templates), { title: '提醒 我的大号', content: '6块 今天 12:00 · 还有 2 分钟' });
  assert.equal(sampleCropNotification('friend_crop_forecast', templates).title, '成熟预告｜我的大号');
});

test('remaining minutes are shown through 120 minutes and exact Beijing maturity stays visible beyond it', () => {
  const nowSec = Date.UTC(2026, 9, 11, 3, 30) / 1000;
  assert.equal(formatMaturityTime(nowSec + 7200, nowSec), '今天 13:30 · 还有 120 分钟');
  assert.equal(formatMaturityTime(nowSec + 7201, nowSec), '今天 13:30');
  assert.equal(formatMaturityTime(nowSec + 86400, nowSec), '明天 11:30');
  assert.match(formatMaturityTime(nowSec, nowSec), /已成熟/);
});

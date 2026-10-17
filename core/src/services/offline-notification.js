const { enabledNotificationChannels, sendNotificationChannels } = require('./notification-channels');

function buildOfflineNotification(config, { accountName = '', accountId = '', reason = '', offlineMs = 0, test = false } = {}) {
  const name = String(accountName || accountId || (test ? '测试账号' : '未知账号')).trim();
  const title = String(config.title || '账号下线提醒').trim();
  let content = `${String(config.msg || config.emailContent || '账号下线').trim()}\n账号名称: ${name}`;
  if (reason) content += `\n原因: ${reason}`;
  const minutes = Math.floor(Number(offlineMs) / 60000);
  if (minutes > 0) content += `\n离线时长: ${minutes} 分钟`;
  if (test) content += '\n这是一条下线提醒测试消息。';
  return { title: test ? `${title}（测试）` : title, content };
}

async function sendOfflineNotifications(config, message, senders) {
  return sendNotificationChannels(config, message, senders, enabledNotificationChannels(config, 'account_offline'));
}

module.exports = { enabledNotificationChannels, buildOfflineNotification, sendOfflineNotifications };

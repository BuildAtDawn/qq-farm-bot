const push = require('./push');
const { normalizeNotificationEvents, normalizeBarkLevels } = require('../config/account-maintenance');

const CHANNELS = {
  smtp: {
    label: '邮件',
    enabled: config => typeof config.smtpEnabled === 'boolean' ? config.smtpEnabled
      : (!config.channel || config.channel === 'smtp') && !!(config.smtpHost && config.smtpUser && config.smtpPass && config.recipientEmail),
    send: (config, message, senders) => senders.sendSmtpEmail({ ...config, subject: message.title, content: message.content }),
  },
  bark: {
    label: 'Bark',
    enabled: config => config.barkEnabled === true && !!config.barkKey,
    send: (config, message, senders) => senders.sendBarkMessage({ ...message, key: config.barkKey,
      url: config.notificationEvent === 'friend_crop_mature' ? config.notificationUrl : undefined,
      level: normalizeBarkLevels(config.barkLevels)[config.notificationEvent || 'account_offline'] }),
  },
};

function enabledNotificationChannels(config = {}, event) {
  const subscribed = event ? normalizeNotificationEvents(config.events)[event] || [] : Object.keys(CHANNELS);
  return Object.keys(CHANNELS).filter(channel => subscribed.includes(channel) && CHANNELS[channel].enabled(config));
}

async function sendNotificationChannels(config, message, senders = push, channels = enabledNotificationChannels(config)) {
  const results = await Promise.all(channels.filter(channel => CHANNELS[channel]).map(async channel => {
    const adapter = CHANNELS[channel];
    try {
      const result = await adapter.send(config, message, senders);
      return { channel, ok: result?.ok === true, msg: result?.ok === true ? `${adapter.label}请求已受理` : `${adapter.label}发送失败，请检查配置及网络` };
    } catch {
      return { channel, ok: false, msg: `${adapter.label}发送失败，请检查配置及网络` };
    }
  }));
  return {
    ok: results.length > 0 && results.every(result => result.ok),
    msg: results.length ? results.map(result => `${CHANNELS[result.channel].label}: ${result.msg}`).join('；') : '请至少开启一个通知渠道',
    results,
  };
}

function resolveNotificationConfig(config, accountId, event, monitor, gid, systemSettings) {
  return { ...config, notificationEvent: event,
    notificationUrl: event === 'friend_crop_mature' ? require('../config/system-settings').getMaturityReminderUrl(systemSettings) : undefined,
    barkKey: event === 'account_offline'
    ? config.barkAccountKeys?.[String(accountId)] || '' : monitor?.barkKeys?.[String(gid)] || '' };
}

module.exports = { CHANNELS, enabledNotificationChannels, sendNotificationChannels, resolveNotificationConfig };

const definitions = require('../config/notification-templates.json');

function normalizeNotificationTemplates(input) {
  return Object.fromEntries(Object.entries(definitions.defaults).map(([event, defaults]) => [event, {
    title: typeof input?.[event]?.title === 'string' && input[event].title.trim() ? input[event].title.slice(0, 200) : defaults.title,
    content: typeof input?.[event]?.content === 'string' && input[event].content.trim() ? input[event].content.slice(0, 8000) : defaults.content,
  }]));
}

function validateNotificationTemplates(input) {
  for (const event of Object.keys(definitions.defaults)) {
    for (const field of ['title', 'content']) {
      const value = input?.[event]?.[field];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value.trim()) return '通知标题和内容不能为空';
      if (value.length > (field === 'title' ? 200 : 8000)) return '通知模板超出长度限制';
      for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
        if (!definitions.variables.includes(match[1])) return `未知通知变量：{${match[1]}}`;
      }
    }
  }
  return '';
}

function renderNotificationTemplate(template, variables) {
  const replace = text => text.replace(/\{([^{}]+)\}/g, (token, key) => Object.hasOwn(variables, key) ? String(variables[key]) : token);
  return { title: replace(template.title), content: replace(template.content) };
}

function sampleCropNotification(event, templates) {
  const variables = { ...definitions.sample, ...(event === 'friend_crop_mature' ? definitions.nearSample : {}) };
  return renderNotificationTemplate(normalizeNotificationTemplates(templates)[event], variables);
}

module.exports = { normalizeNotificationTemplates, validateNotificationTemplates, renderNotificationTemplate, sampleCropNotification };

import definitions from '../../../core/src/config/notification-templates.json'

export type CropNotificationEvent = keyof typeof definitions.defaults
export type NotificationEvent = 'account_offline' | CropNotificationEvent
export type NotificationTemplates = Record<CropNotificationEvent, { title: string, content: string }>

export const templateVariables = definitions.variables
export const defaultNotificationTemplates = definitions.defaults

export function normalizeNotificationTemplates(input?: Partial<NotificationTemplates>): NotificationTemplates {
  return Object.fromEntries(Object.entries(definitions.defaults).map(([event, template]) => [event, {
    ...template,
    ...input?.[event as CropNotificationEvent],
  }])) as NotificationTemplates
}

export function previewCropNotification(event: CropNotificationEvent, templates: NotificationTemplates) {
  const variables: Record<string, string> = { ...definitions.sample, ...(event === 'friend_crop_mature' ? definitions.nearSample : {}) }
  const replace = (text: string) => text.replace(/\{([^{}]+)\}/g, (token, key: string) => Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : token)
  return { title: replace(templates[event].title), content: replace(templates[event].content) }
}

export function unknownTemplateVariables(text: string) {
  return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]!).filter(key => !templateVariables.includes(key)))]
}

export function insertTemplateVariable(text: string, variable: string, start: number, end: number) {
  const token = `{${variable}}`
  return { text: text.slice(0, start) + token + text.slice(end), caret: start + token.length }
}

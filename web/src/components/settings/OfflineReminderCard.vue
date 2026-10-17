<script setup lang="ts">
import type { OfflineConfig } from '@/stores/setting'
import type { NotificationEvent } from '@/utils/notification-template'
import { computed, nextTick, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { defaultNotificationTemplates, insertTemplateVariable, previewCropNotification, templateVariables, unknownTemplateVariables } from '@/utils/notification-template'

defineProps<{ saving: boolean, testing: boolean, showSave?: boolean }>()
const emit = defineEmits<{ test: [channel?: 'smtp' | 'bark', event?: NotificationEvent], save: [] }>()
const config = defineModel<OfflineConfig>('config', { required: true })
const accountStore = useAccountStore()
const expandedChannels = ref({ smtp: false, bark: false })
watch(() => config.value.smtpEnabled, enabled => expandedChannels.value.smtp = !!enabled, { immediate: true })
watch(() => config.value.barkEnabled, enabled => expandedChannels.value.bark = !!enabled, { immediate: true })
const barkLevels = [
  { value: 'passive', label: '被动通知' },
  { value: 'active', label: '普通通知' },
  { value: 'timeSensitive', label: '时效性通知' },
  { value: 'critical', label: '重要警告' },
]
const activeEvent = ref<NotificationEvent>('friend_crop_forecast')
const activeField = ref<'title' | 'content'>('content')
const titleInput = ref<HTMLInputElement>()
const contentInput = ref<HTMLTextAreaElement>()
const events = [
  { key: 'account_offline', label: '账号掉线', icon: 'i-carbon-warning-alt' },
  { key: 'friend_crop_forecast', label: '作物成熟预告', icon: 'i-carbon-calendar' },
  { key: 'friend_crop_mature', label: '作物即将成熟', icon: 'i-carbon-alarm' },
] as const

const title = computed({
  get: () => activeEvent.value === 'account_offline' ? config.value.title : config.value.templates[activeEvent.value].title,
  set: (value) => {
    if (activeEvent.value === 'account_offline')
      config.value.title = value
    else config.value.templates[activeEvent.value].title = value
  },
})
const content = computed({
  get: () => activeEvent.value === 'account_offline' ? config.value.msg : config.value.templates[activeEvent.value].content,
  set: (value) => {
    if (activeEvent.value === 'account_offline')
      config.value.msg = value
    else config.value.templates[activeEvent.value].content = value
  },
})
const preview = computed(() => activeEvent.value === 'account_offline'
  ? { title: `${title.value || '账号下线提醒'}（测试）`, content: `${content.value || '账号下线'}\n账号名称: 测试账号\n这是一条下线提醒测试消息。` }
  : previewCropNotification(activeEvent.value, config.value.templates))
const unknownVariables = computed(() => activeEvent.value === 'account_offline' ? [] : unknownTemplateVariables(`${title.value}\n${content.value}`))
const testEnabled = computed(() => (config.value.smtpEnabled && config.value.events[activeEvent.value].includes('smtp'))
  || (config.value.barkEnabled && !!config.value.barkTestKey?.trim() && config.value.events[activeEvent.value].includes('bark')))

function variableToken(variable: string) {
  return `{${variable}}`
}

function toggleChannel(event: NotificationEvent, channel: string, checked: boolean) {
  const selected = config.value.events[event] || []
  config.value.events[event] = checked ? [...new Set([...selected, channel])] : selected.filter(value => value !== channel)
}

async function insertVariable(variable: string) {
  const input = activeField.value === 'title' ? titleInput.value : contentInput.value
  const target = activeField.value === 'title' ? title : content
  const inserted = insertTemplateVariable(target.value, variable, input?.selectionStart ?? target.value.length, input?.selectionEnd ?? target.value.length)
  target.value = inserted.text
  await nextTick()
  input?.focus()
  input?.setSelectionRange(inserted.caret, inserted.caret)
}

function resetTemplate() {
  if (activeEvent.value === 'account_offline') {
    config.value.title = '账号下线提醒'
    config.value.msg = '账号下线'
  }
  else {
    config.value.templates[activeEvent.value] = { ...defaultNotificationTemplates[activeEvent.value] }
  }
}

function navigateEvents(event: KeyboardEvent, index: number) {
  const next = event.key === 'ArrowRight'
    ? (index + 1) % events.length
    : event.key === 'ArrowLeft'
      ? (index + events.length - 1) % events.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? events.length - 1 : -1
  const target = events[next]
  if (!target)
    return
  event.preventDefault()
  activeEvent.value = target.key
  document.getElementById(`notification-tab-${target.key}`)?.focus()
}
</script>

<template>
  <div class="notification-settings min-w-0 space-y-6">
    <section>
      <div class="notification-section-heading">
        <h4><span class="i-carbon-send" aria-hidden="true" />推送渠道</h4>
        <span>{{ Number(config.smtpEnabled) + Number(config.barkEnabled) }} / 2 已启用</span>
      </div>
      <div class="notification-channels">
        <article class="notification-channel" :class="{ 'notification-channel--enabled': config.smtpEnabled }">
          <header class="notification-channel-heading">
            <span class="notification-channel-icon i-carbon-email" aria-hidden="true" />
            <div class="notification-channel-title">
              <h5>电子邮件</h5><span class="notification-channel-status" :class="{ 'is-enabled': config.smtpEnabled }">{{ config.smtpEnabled ? '已启用 · SMTP' : '未启用 · SMTP' }}</span>
            </div>
            <BaseSwitch v-model="config.smtpEnabled" aria-label="启用邮件通知" />
            <button type="button" class="notification-channel-expand" :aria-expanded="expandedChannels.smtp" aria-controls="notification-smtp-config" @click="expandedChannels.smtp = !expandedChannels.smtp">
              配置<span :class="expandedChannels.smtp ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'" aria-hidden="true" />
            </button>
          </header>
          <div v-show="expandedChannels.smtp" id="notification-smtp-config">
            <div class="notification-channel-body grid gap-3 sm:grid-cols-2">
              <BaseInput v-model="config.smtpHost" label="SMTP 服务器" placeholder="smtp.qq.com" />
              <BaseInput v-model.number="config.smtpPort" label="端口" type="number" min="1" max="65535" />
              <BaseInput v-model="config.smtpUser" label="邮箱账号" />
              <BaseInput v-model="config.smtpPass" label="授权码" type="password" />
              <BaseInput v-model="config.recipientEmail" label="收件人邮箱" />
              <BaseInput v-model="config.senderName" label="发件人名称" />
            </div>
            <footer class="notification-channel-footer">
              <span class="notification-channel-status" :class="{ 'is-enabled': config.smtpEnabled }">{{ config.smtpEnabled ? '已启用' : '未启用' }}</span>
              <BaseButton v-if="config.smtpEnabled" variant="secondary" size="sm" :loading="testing" :disabled="saving || testing" @click="emit('test', 'smtp')">
                <div class="i-carbon-send mr-1" />测试邮件
              </BaseButton>
            </footer>
          </div>
        </article>
        <article class="notification-channel notification-channel--bark" :class="{ 'notification-channel--enabled': config.barkEnabled }">
          <header class="notification-channel-heading">
            <span class="notification-channel-icon i-carbon-mobile" aria-hidden="true" />
            <div class="notification-channel-title">
              <h5>Bark</h5><span class="notification-channel-status" :class="{ 'is-enabled': config.barkEnabled }">{{ config.barkEnabled ? '已启用 · 设备推送' : '未启用 · 设备推送' }}</span>
            </div>
            <BaseSwitch v-model="config.barkEnabled" aria-label="启用 Bark 通知" />
            <button type="button" class="notification-channel-expand" :aria-expanded="expandedChannels.bark" aria-controls="notification-bark-config" @click="expandedChannels.bark = !expandedChannels.bark">
              配置<span :class="expandedChannels.bark ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'" aria-hidden="true" />
            </button>
          </header>
          <div v-show="expandedChannels.bark" id="notification-bark-config">
            <div class="notification-channel-body space-y-4">
              <BaseInput v-model="config.barkTestKey" label="Bark 测试 Key" type="password" default-visible autocomplete="off" />
              <div v-if="config.barkEnabled" class="notification-account-keys space-y-3">
                <h5>账号掉线 Key <span>{{ accountStore.accounts.length }} 个账号</span></h5>
                <BaseInput v-for="account in accountStore.accounts" :key="account.id" v-model="config.barkAccountKeys[String(account.id)]" :label="account.name || account.nick || String(account.id)" type="password" default-visible autocomplete="off" />
                <p v-if="!accountStore.accounts.length" class="text-sm text-gray-500">
                  暂无账号
                </p>
              </div>
            </div>
            <footer class="notification-channel-footer">
              <span class="notification-channel-status" :class="{ 'is-enabled': config.barkEnabled }">{{ config.barkEnabled ? '已启用' : '未启用' }}</span>
              <BaseButton variant="secondary" size="sm" :loading="testing" :disabled="saving || testing || !config.barkTestKey?.trim()" @click="emit('test', 'bark', activeEvent)">
                <div class="i-carbon-send mr-1" />测试 Bark
              </BaseButton>
            </footer>
          </div>
        </article>
      </div>
    </section>

    <section class="notification-events min-w-0">
      <div class="notification-section-heading">
        <h4><span class="i-carbon-notification" aria-hidden="true" />事件与消息</h4>
        <span>{{ events.length }} 种事件</span>
      </div>
      <div role="tablist" aria-label="通知事件" class="notification-event-tabs">
        <button v-for="(event, index) in events" :id="`notification-tab-${event.key}`" :key="event.key" type="button" role="tab" :aria-selected="activeEvent === event.key" :tabindex="activeEvent === event.key ? 0 : -1" aria-controls="notification-event-editor" class="notification-event-tab" @click="activeEvent = event.key" @keydown="navigateEvents($event, index)">
          <span :class="event.icon" aria-hidden="true" />
          <span>{{ event.label }}<small>{{ config.events[event.key].map(channel => channel === 'smtp' ? '邮件' : channel === 'bark' ? 'Bark' : channel).join(' · ') || '未选择渠道' }}</small></span>
        </button>
      </div>
      <div id="notification-event-editor" role="tabpanel" :aria-labelledby="`notification-tab-${activeEvent}`">
        <div class="notification-routing">
          <span class="notification-routing-label">接收渠道</span>
          <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4" :checked="config.events[activeEvent].includes('smtp')" @change="toggleChannel(activeEvent, 'smtp', ($event.target as HTMLInputElement).checked)">邮件<span v-if="!config.smtpEnabled" class="text-xs text-gray-400">未启用</span></label>
          <label class="flex items-center gap-2"><input type="checkbox" class="h-4 w-4" :checked="config.events[activeEvent].includes('bark')" @change="toggleChannel(activeEvent, 'bark', ($event.target as HTMLInputElement).checked)">Bark<span v-if="!config.barkEnabled" class="text-xs text-gray-400">未启用</span></label>
          <label class="flex items-center gap-2">Bark 等级<select v-model="config.barkLevels[activeEvent]" class="template-input"><option v-for="level in barkLevels" :key="level.value" :value="level.value">{{ level.label }}</option></select></label>
        </div>
        <div class="notification-editor-layout">
          <div class="notification-editor min-w-0 space-y-4">
            <div class="space-y-1.5">
              <label for="notification-template-title" class="block text-sm font-medium">通知标题</label>
              <input id="notification-template-title" ref="titleInput" v-model="title" maxlength="200" class="template-input w-full" @focus="activeField = 'title'">
            </div>
            <div class="space-y-1.5">
              <label for="notification-template-content" class="block text-sm font-medium">{{ activeEvent === 'account_offline' ? '通知说明' : '通知内容' }}</label>
              <textarea id="notification-template-content" ref="contentInput" v-model="content" maxlength="8000" rows="9" class="template-input w-full resize-y" @focus="activeField = 'content'" />
            </div>
            <div v-if="activeEvent !== 'account_offline'" class="space-y-2">
              <span class="text-xs text-gray-500">消息变量</span>
              <div class="notification-variables">
                <button v-for="variable in templateVariables" :key="variable" type="button" class="notification-variable" :title="`插入到${activeField === 'title' ? '标题' : '正文'}`" @mousedown.prevent @click="insertVariable(variable)">
                  <div class="i-carbon-add" />{{ variableToken(variable) }}
                </button>
              </div>
            </div>
            <p v-if="unknownVariables.length" class="break-words text-sm text-red-500">
              未知变量：{{ unknownVariables.map(variableToken).join('、') }}
            </p>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <BaseButton variant="ghost" size="sm" @click="resetTemplate">
                <div class="i-carbon-reset mr-1" />恢复默认
              </BaseButton>
              <BaseButton variant="secondary" size="sm" :loading="testing" :disabled="saving || testing || !testEnabled || !!unknownVariables.length || !title.trim() || !content.trim()" @click="emit('test', undefined, activeEvent)">
                <div class="i-carbon-send mr-1" />测试此事件
              </BaseButton>
            </div>
          </div>
          <aside class="notification-preview">
            <div class="notification-preview-heading">
              <span class="i-carbon-view" aria-hidden="true" /><span>消息预览</span><small>{{ activeEvent === 'account_offline' ? '测试账号' : '示例数据 · 北京时间' }}</small>
            </div>
            <div class="notification-preview-content">
              <span class="notification-preview-source"><span class="i-carbon-sprout" aria-hidden="true" />科技助农</span>
              <p class="notification-preview-title">
                {{ preview.title }}
              </p>
              <p class="notification-preview-message">
                {{ preview.content }}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
    <div v-if="showSave !== false" class="flex justify-end border-t border-gray-200 pt-4 dark:border-gray-700">
      <BaseButton variant="primary" size="sm" :loading="saving" :disabled="testing || !!unknownVariables.length" @click="emit('save')">
        <div class="i-carbon-save mr-1" />保存通知设置
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.template-input {
  min-width: 0;
  max-width: 100%;
  color: var(--theme-text);
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  background: var(--input-bg);
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
}
.template-input:focus {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px rgb(35 132 82 / 10%);
}
.notification-section-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
}
.notification-section-heading h4 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 650;
}
.notification-section-heading > span {
  color: var(--muted-text);
  font-size: 12px;
}
.notification-channels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.notification-channel {
  min-width: 0;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-1);
  overflow: hidden;
}
.notification-channel--enabled {
  border-color: #b9d6bf;
}
.notification-channel-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
.notification-channel-icon {
  font-size: 24px;
  color: var(--theme-primary);
  flex-shrink: 0;
}
.notification-channel--bark .notification-channel-icon {
  color: #377ca0;
}
.notification-channel-title {
  flex: 1;
  min-width: 60px;
}
.notification-channel-title h5 {
  font-size: 14px;
  font-weight: 650;
}
.notification-channel-title > span {
  font-size: 12px;
  color: var(--muted-text);
}
.notification-channel-body {
  padding: 14px;
  border-top: 1px solid var(--surface-border);
}
.notification-channel-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 36px;
  padding: 5px;
  color: var(--theme-primary);
  font-size: 12px;
}
.notification-channel-expand:hover {
  background: var(--surface-2);
}
.notification-channel-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-top: 1px solid var(--surface-border);
  background: var(--surface-2);
  min-height: 44px;
}
.notification-channel-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-text);
}
.notification-channel-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9aa499;
}
.notification-channel-status.is-enabled::before {
  background: var(--theme-primary);
}
.notification-account-keys {
  border-top: 1px solid var(--surface-border);
  padding-top: 15px;
}
.notification-account-keys h5 {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}
.notification-account-keys h5 > span {
  color: var(--muted-text);
  font-size: 12px;
  font-weight: 400;
}
.notification-events {
  padding: 18px;
  border-block: 1px solid var(--surface-border);
  background: var(--surface-1);
}
.notification-event-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid var(--surface-border);
}
.notification-event-tab {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 10px;
  border-bottom: 3px solid transparent;
  text-align: left;
  color: var(--muted-text);
  font-size: 13px;
}
.notification-event-tab > span:first-child {
  font-size: 20px;
  flex-shrink: 0;
}
.notification-event-tab small {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.notification-event-tab[aria-selected='true'] {
  color: var(--theme-primary);
  border-bottom-color: var(--theme-primary);
  background: #edf5e9;
  font-weight: 650;
}
.notification-event-tab:hover {
  background: var(--surface-2);
}
.notification-routing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  padding: 16px 0;
  font-size: 13px;
}
.notification-routing label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
}
.notification-routing input {
  accent-color: var(--theme-primary);
}
.notification-routing-label {
  color: var(--muted-text);
}
.notification-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.notification-editor {
  padding-top: 8px;
}
.notification-settings :deep(.base-input),
.template-input {
  border-radius: 6px;
  border-color: var(--surface-border-strong);
}
.notification-variables {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.notification-variable {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 28px;
  padding: 3px 7px;
  border-radius: 4px;
  color: #38677d;
  background: #edf4f8;
  font-family: monospace;
  font-size: 12px;
}
.notification-variable:hover {
  background: #deedf5;
}
.notification-preview {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-1);
}
.notification-preview-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-2);
  font-size: 12px;
}
.notification-preview-heading small {
  margin-left: auto;
  color: var(--muted-text);
  font-size: 12px;
}
.notification-preview-content {
  padding: 20px;
}
.notification-preview-source {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--theme-primary);
  font-size: 12px;
}
.notification-preview-title {
  margin-top: 14px;
  font-size: 15px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.notification-preview-message {
  margin-top: 12px;
  color: var(--muted-text);
  font-size: 13px;
  line-height: 1.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notification-settings button:focus-visible {
  outline: 2px solid var(--theme-primary);
  outline-offset: 2px;
}
@media (max-width: 1100px) {
  .notification-channels,
  .notification-editor-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 639px) {
  .notification-channel-heading,
  .notification-channel-body {
    padding: 12px;
  }
  .notification-events {
    padding: 14px 12px;
  }
  .notification-event-tab > span:first-child {
    display: none;
  }
  .notification-event-tab {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 12px 8px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .notification-routing {
    gap: 6px 14px;
  }
  .notification-preview-content {
    padding: 16px;
  }
}
</style>

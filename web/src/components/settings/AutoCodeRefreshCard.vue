<script setup lang="ts">
import type { AutoCodeRefreshConfig } from '@/stores/setting'
import { computed, ref } from 'vue'
import AccountSettingsCard from '@/components/settings/AccountSettingsCard.vue'
import AccountSettingsDialog from '@/components/settings/AccountSettingsDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

const props = defineProps<{
  loading: boolean
  saving: boolean
  saveConfig: (config: AutoCodeRefreshConfig) => Promise<boolean>
}>()

const config = defineModel<AutoCodeRefreshConfig>('config', { required: true })
const draft = ref<AutoCodeRefreshConfig>({ ...config.value })
const open = ref(false)
const pending = ref(false)
const busy = computed(() => props.saving || pending.value)
const disabled = computed(() => props.loading || busy.value)
const enabled = computed(() => config.value.enabled || config.value.offlineEnabled)
const status = computed(() => props.loading ? '加载中' : enabled.value ? '已开启' : '已关闭')
const tags = computed(() => [
  config.value.enabled ? `定时重登 ${config.value.intervalMinutes} 分钟` : '定时重登关闭',
  config.value.offlineEnabled ? `掉线后 ${config.value.offlineDelaySeconds} 秒重登` : '掉线重登关闭',
])

function configure() {
  draft.value = { ...config.value }
  open.value = true
}

async function save(value = draft.value) {
  if (disabled.value)
    return
  pending.value = true
  try {
    const saved = await props.saveConfig({ ...value })
    if (saved)
      open.value = false
  }
  finally {
    pending.value = false
  }
}

function toggle(enabled: boolean) {
  // 保持两种独立模式；总开关首次开启时默认使用定时重登。
  void save({ ...config.value, enabled, offlineEnabled: enabled ? config.value.offlineEnabled : false })
}
</script>

<template>
  <AccountSettingsCard
    title="账号保活" description="所有微信区账号共享 · 定时重登与掉线恢复" icon="i-carbon-renew"
    :enabled="enabled" :disabled="disabled" :status="status" :tags="tags"
    @toggle="toggle" @configure="configure"
  />
  <AccountSettingsDialog
    v-if="open" title="账号保活" description="所有微信区账号共享 · 仅对具备微信登录凭据的账号生效" icon="i-carbon-renew"
    :saving="busy" :disabled="disabled" @cancel="open = false" @save="save()"
  >
    <div class="space-y-4">
      <div class="grid grid-cols-1 items-center gap-3 sm:grid-cols-2">
        <BaseSwitch v-model="draft.enabled" label="定时重登" :disabled="busy" />
        <BaseInput
          v-model.number="draft.intervalMinutes"
          label="重登间隔（分钟）"
          type="number"
          min="1"
          max="1440"
          :disabled="!draft.enabled || busy"
          placeholder="60"
        />
      </div>
      <div class="grid grid-cols-1 items-center gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2 dark:border-gray-700">
        <BaseSwitch v-model="draft.offlineEnabled" label="掉线重登" :disabled="busy" />
        <BaseInput v-model.number="draft.offlineDelaySeconds" label="掉线后等待（秒）" type="number" min="1" max="86400" placeholder="60" :disabled="!draft.offlineEnabled || busy" />
      </div>
    </div>
  </AccountSettingsDialog>
</template>

<script setup lang="ts">
import type { FriendMonitorConfig } from '@/stores/setting'
import { computed, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import AccountSettingsCard from '@/components/settings/AccountSettingsCard.vue'
import AccountSettingsDialog from '@/components/settings/AccountSettingsDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

const props = defineProps<{
  accountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  saveConfig: (config: FriendMonitorConfig) => Promise<boolean>
}>()
const savedConfig = defineModel<FriendMonitorConfig>('config', { required: true })
const draft = ref<FriendMonitorConfig>(JSON.parse(JSON.stringify(savedConfig.value)))
const open = ref(false)
const pending = ref(false)
const config = computed(() => open.value ? draft.value : savedConfig.value)
const busy = computed(() => props.saving || pending.value)
const disabled = computed(() => props.loading || busy.value || !props.accountId)
const tags = computed(() => [
  `已选 ${savedConfig.value.friendGids.length} 位好友`,
  `巡查 ${savedConfig.value.intervalMinSec}-${savedConfig.value.intervalMaxSec} 秒`,
  ...(savedConfig.value.forecastEnabled ? ['成熟预告'] : []),
  ...(savedConfig.value.matureEnabled ? ['即将成熟提醒'] : []),
  ...(savedConfig.value.protectFriends ? ['监听好友保护'] : []),
])
const friends = ref<Array<{ gid: number, name: string, avatarUrl?: string }>>([])
const records = ref<Array<{ gid: number, lastError?: string, current?: { name: string, observedAt: number, lands: Array<{ matureAt: number, phase: number, masterLandId: number }> } }>>([])
const search = ref('')
const fetching = ref(false)
const error = ref('')
let requestVersion = 0

function configure() {
  draft.value = JSON.parse(JSON.stringify(savedConfig.value))
  open.value = true
  if (draft.value.enabled)
    void loadFriends()
}

async function save(value = draft.value) {
  if (disabled.value)
    return
  const accountId = props.accountId
  pending.value = true
  try {
    const saved = await props.saveConfig(JSON.parse(JSON.stringify(value)))
    if (saved && accountId === props.accountId)
      open.value = false
  }
  finally {
    pending.value = false
  }
}

function toggle(enabled: boolean) {
  void save({ ...savedConfig.value, enabled })
}

const availableFriends = computed(() => {
  const map = new Map(friends.value.map(friend => [Number(friend.gid), friend]))
  for (const gid of config.value.friendGids) {
    if (!map.has(gid))
      map.set(gid, { gid, name: records.value.find(item => item.gid === gid)?.current?.name || `GID:${gid}` })
  }
  const term = search.value.trim().toLowerCase()
  return [...map.values()].filter(friend => `${friend.name} ${friend.gid}`.toLowerCase().includes(term)).sort((a, b) => Number(config.value.friendGids.includes(b.gid)) - Number(config.value.friendGids.includes(a.gid)) || a.name.localeCompare(b.name, 'zh-CN'))
})

function toggleFriend(gid: number, checked: boolean) {
  config.value.friendGids = checked ? [...new Set([...config.value.friendGids, gid])] : config.value.friendGids.filter(id => id !== gid)
}

function formatTime(seconds: number) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(seconds * 1000))
}

function statusLabel(gid: number) {
  const record = records.value.find(item => item.gid === gid)
  if (record?.lastError)
    return record.lastError
  if (!record?.current)
    return '等待首次巡查'
  const future = record.current.lands.filter(land => !land.masterLandId && land.phase !== 7 && land.matureAt > Date.now() / 1000)
    .map(land => land.matureAt)
  return `巡查 ${formatTime(record.current.observedAt)}${future.length ? ` · 最早成熟 ${formatTime(Math.min(...future))}` : ' · 暂无待成熟作物'}`
}

async function loadFriends(refresh = false) {
  if (!props.accountId || fetching.value)
    return
  const id = String(props.accountId)
  const version = ++requestVersion
  fetching.value = true
  error.value = ''
  try {
    const headers = { 'x-account-id': id }
    const { data } = await api.get('/api/settings/friend-monitor', { headers })
    if (version !== requestVersion || id !== String(props.accountId))
      return
    if (!data?.ok)
      throw new Error(data?.error || '加载监听状态失败')
    friends.value = data.data.friends || []
    records.value = data.data.records || []
    if (refresh || friends.value.length === 0) {
      const response = await api.get('/api/friends', { headers })
      if (version !== requestVersion || id !== String(props.accountId))
        return
      if (!response.data?.ok)
        throw new Error(response.data?.error || '加载好友失败')
      friends.value = response.data.data || []
    }
  }
  catch (err: any) {
    if (version === requestVersion)
      error.value = err.response?.data?.error || err.message || '好友列表加载失败'
  }
  finally {
    if (version === requestVersion)
      fetching.value = false
  }
}

watch(() => props.accountId, () => {
  open.value = false
  requestVersion++
  fetching.value = false
  friends.value = []
  records.value = []
  error.value = ''
  search.value = ''
  if (config.value.enabled)
    void loadFriends()
})
watch(() => config.value.enabled, (enabled) => {
  if (enabled)
    void loadFriends()
}, { immediate: true })
onUnmounted(() => {
  requestVersion++
})
</script>

<template>
  <AccountSettingsCard
    title="好友作物监听" description="好友巡查、成熟提醒与保护" icon="i-carbon-crop-health"
    :enabled="savedConfig.enabled" :disabled="disabled" :status="loading ? '加载中' : savedConfig.enabled ? '已开启' : '已关闭'" :tags="tags"
    @toggle="toggle" @configure="configure"
  />
  <AccountSettingsDialog
    v-if="open" title="好友作物监听" description="好友巡查、成熟提醒与保护" icon="i-carbon-crop-health"
    :saving="busy" :disabled="disabled" @cancel="open = false" @save="save()"
  >
    <div class="space-y-4">
      <BaseSwitch v-model="config.enabled" label="开启监听" :disabled="busy" />
      <template v-if="config.enabled">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BaseInput v-model.number="config.intervalMinSec" label="巡查最小间隔（秒）" type="number" min="10" max="86400" />
          <BaseInput v-model.number="config.intervalMaxSec" label="巡查最大间隔（秒）" type="number" :min="config.intervalMinSec" max="86400" />
          <BaseInput v-model.number="config.leadSeconds" label="成熟提前量（秒）" type="number" min="0" max="86400" />
        </div>
        <div class="flex flex-wrap gap-x-6 gap-y-3">
          <BaseSwitch v-model="config.forecastEnabled" label="成熟预告" />
          <BaseSwitch v-model="config.matureEnabled" label="即将成熟提醒" />
          <BaseSwitch v-model="config.protectFriends" label="监听好友免偷菜、免捣乱" />
        </div>
        <div class="flex items-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
          <BaseInput v-model="search" class="min-w-0 flex-1" label="监听好友" placeholder="搜索好友名称或 GID" />
          <span class="shrink-0 pb-2 text-xs text-gray-500">已选 {{ config.friendGids.length }} 位</span>
          <BaseButton variant="ghost" class="h-9 w-9 shrink-0 !p-2" :loading="fetching" :disabled="fetching" title="刷新好友与监听状态" aria-label="刷新好友与监听状态" @click="loadFriends(true)">
            <span class="i-carbon-renew" />
          </BaseButton>
        </div>
        <p v-if="error" role="alert" class="break-words text-sm text-red-600">
          {{ error }}
        </p>
        <p v-if="fetching && !availableFriends.length" class="text-sm text-gray-500">
          好友加载中...
        </p>
        <p v-else-if="!availableFriends.length" class="text-sm text-gray-500">
          {{ search ? '没有匹配的好友' : '暂无好友数据' }}
        </p>
        <div v-else class="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
          <div v-for="friend in availableFriends" :key="friend.gid" class="py-3">
            <label class="flex cursor-pointer items-center gap-3">
              <input type="checkbox" class="h-4 w-4 shrink-0" :checked="config.friendGids.includes(friend.gid)" @change="toggleFriend(friend.gid, ($event.target as HTMLInputElement).checked)">
              <img v-if="friend.avatarUrl" :src="friend.avatarUrl" alt="" class="h-8 w-8 shrink-0 rounded-full object-cover">
              <span v-else class="i-carbon-user-avatar h-8 w-8 shrink-0 text-gray-400" />
              <span class="min-w-0 flex-1">
                <span class="block break-words text-sm font-medium">{{ friend.name }}</span>
                <span class="block break-words text-xs text-gray-500">GID: {{ friend.gid }}<template v-if="config.friendGids.includes(friend.gid)"> · {{ statusLabel(friend.gid) }}</template></span>
              </span>
            </label>
            <BaseInput v-if="config.friendGids.includes(friend.gid)" v-model="config.barkKeys[String(friend.gid)]" class="mt-2" :label="`${friend.name} · Bark Key`" type="password" default-visible autocomplete="off" />
          </div>
        </div>
      </template>
    </div>
  </AccountSettingsDialog>
</template>

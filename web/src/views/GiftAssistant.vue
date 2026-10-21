<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import FarmPageHeader from '@/components/ui/FarmPageHeader.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const toast = useToastStore()

const loading = ref(false)
const running = ref(false)
const enabled = ref(false)
const savingSwitch = ref(false)
const items = ref<{ id: number, name: string, count: number, openedToday: number, openedTotal: number }[]>([])
const entries = ref<{ itemId: number, name: string, count: number, at: number }[]>([])
const date = ref('')
const error = ref('')
const totalOpenedToday = computed(() => items.value.reduce((sum, item) => sum + item.openedToday, 0))

async function load() {
  const accountId = String(accountStore.currentAccount?.id || '')
  if (!accountId)
    return
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get('/api/gift-assistant', { headers: { 'x-account-id': accountId } })
    if (!data?.ok)
      throw new Error(data?.error || '读取失败')
    enabled.value = data.data.enabled === true
    items.value = data.data.items || []
    entries.value = data.data.entries || []
    date.value = data.data.date || ''
  }
  catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || '读取失败'
  }
  finally {
    loading.value = false
  }
}

async function toggleEnabled(value: boolean | undefined) {
  const accountId = String(accountStore.currentAccount?.id || '')
  if (!accountId)
    return
  savingSwitch.value = true
  try {
    const { data } = await api.post('/api/automation', { gift_assistant: value === true }, { headers: { 'x-account-id': accountId } })
    if (!data?.ok)
      throw new Error(data?.error || '保存失败')
    enabled.value = value === true
    toast.success(enabled.value ? '礼包助手已开启' : '礼包助手已关闭')
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '保存失败')
  }
  finally {
    savingSwitch.value = false
  }
}

async function runOnce() {
  const accountId = String(accountStore.currentAccount?.id || '')
  if (!accountId)
    return
  running.value = true
  try {
    const { data } = await api.post('/api/gift-assistant/run', {}, { headers: { 'x-account-id': accountId } })
    if (!data?.ok)
      throw new Error(data?.error || '执行失败')
    const opened = (data.data?.opened || []) as { name: string, count: number }[]
    toast.success(opened.length ? `已开启：${opened.map(x => `${x.name} x${x.count}`).join('，')}` : '背包中没有待开启的目标礼包')
    await load()
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '执行失败')
  }
  finally {
    running.value = false
  }
}

watch(() => accountStore.currentAccount?.id, load, { immediate: true })
</script>

<template>
  <div class="gift-assistant-page flex flex-col gap-4">
    <FarmPageHeader title="礼包助手" description="自动开启背包中的活动礼包，开启记录留账可查。" icon="i-carbon-package" />

    <div class="flex flex-wrap items-center justify-between gap-3 border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
      <div>
        <div class="text-sm font-medium">
          自动开启
        </div>
        <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          开启后每日凌晨 1 点自动开启一次；今日（{{ date || '—' }}）已开启 {{ totalOpenedToday }} 个
        </div>
      </div>
      <BaseSwitch :model-value="enabled" :disabled="savingSwitch" label="礼包助手开关" @update:model-value="toggleEnabled" />
    </div>

    <div class="flex items-center gap-3">
      <BaseButton variant="primary" size="sm" :loading="running" :disabled="loading || !accountStore.currentAccount?.id" aria-label="立即检查并开启礼包" @click="runOnce">
        立即检查并开启
      </BaseButton>
      <BaseButton variant="secondary" size="sm" :loading="loading" :disabled="running" @click="load">
        刷新
      </BaseButton>
    </div>

    <p v-if="error" role="alert" class="text-sm text-red-500">
      {{ error }}
    </p>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="item in items" :key="item.id" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-sm font-medium">{{ item.name }}</span>
          <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-4" :class="item.count > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400'">
            背包 {{ item.count }}
          </span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2 border-t border-gray-100 pt-2.5 dark:border-gray-700">
          <div class="text-xs text-gray-500 dark:text-gray-400">今日已开</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">累计已开</div>
          <div class="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ item.openedToday }}</div>
          <div class="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ item.openedTotal }}</div>
        </div>
      </div>
    </div>

    <div v-if="entries.length" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
      <div class="text-sm font-medium">
        今日开启记录（幂等账本）
      </div>
      <ul class="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
        <li v-for="(entry, index) in entries" :key="`${entry.at}-${index}`" class="flex items-center justify-between gap-2">
          <span>{{ entry.name }} x{{ entry.count }}</span>
          <span class="text-gray-400">{{ new Date(entry.at).toLocaleTimeString() }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

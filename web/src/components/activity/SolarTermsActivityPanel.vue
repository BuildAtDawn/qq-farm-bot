<script setup lang="ts">
import type { ActivityLabels } from './types'
import type { HeluSolarTerms } from '@/stores/activity'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import BaseButton from '@/components/ui/BaseButton.vue'
import HeluSolarTermsPanel from './HeluSolarTermsPanel.vue'

defineProps<{ labels: ActivityLabels }>()
defineEmits<{ back: [] }>()
const { currentAccountId } = storeToRefs(useAccountStore())
const toast = useToastStore()
const solar = ref<HeluSolarTerms | null>(null)
const busy = ref(false)
const error = ref('')
let generation = 0
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined
async function refresh() {
  if (disposed || busy.value || !currentAccountId.value) return
  const version = generation
  busy.value = true
  try {
    const { data } = await api.get('/api/activity/solar-terms')
    if (version !== generation) return
    solar.value = data.solarTerms
    error.value = ''
  }
  catch (e: any) {
    if (version === generation) error.value = e.response?.data?.error || e.message || '节令读取失败'
  }
  finally {
    busy.value = false
    if (version !== generation && currentAccountId.value) refresh()
  }
}
async function claim(term: { id: number }) {
  if (disposed || busy.value || !currentAccountId.value) return
  const version = generation
  busy.value = true
  try {
    const { data } = await api.post('/api/activity/solar-terms/claim', { termId: term.id })
    if (version !== generation) return
    if (!data.ok) throw new Error(data.error || '领取失败')
    solar.value = data.solarTerms
    toast.success('节令奖励领取完成')
  }
  catch (e: any) { if (version === generation) toast.error(e.response?.data?.error || e.message) }
  finally {
    busy.value = false
    if (version !== generation && currentAccountId.value) refresh()
  }
}
function visibility() { if (document.visibilityState === 'visible') refresh() }
watch(currentAccountId, async () => {
  generation++
  solar.value = null
  error.value = ''
  // An outstanding request refreshes the newly selected account after releasing its lock.
  await refresh()
})
onMounted(() => {
  refresh()
  timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 30_000)
  document.addEventListener('visibilitychange', visibility)
})
onUnmounted(() => {
  disposed = true
  generation++
  clearInterval(timer)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <BaseButton variant="secondary" @click="$emit('back')">← 返回活动列表</BaseButton>
      <BaseButton variant="secondary" :loading="busy" :disabled="busy || !currentAccountId" @click="refresh">刷新</BaseButton>
    </div>
    <p v-if="!currentAccountId" class="rounded-xl bg-white p-8 text-center text-sm text-gray-500 dark:bg-gray-800">请先选择账号</p>
    <p v-else-if="error" role="alert" class="rounded-xl bg-red-50 p-6 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{{ error }}</p>
    <p v-else-if="!solar" class="rounded-xl bg-white p-8 text-center text-sm text-gray-500 dark:bg-gray-800" role="status">{{ busy ? '正在读取节令…' : '暂无节令数据' }}</p>
    <HeluSolarTermsPanel v-else :solar-terms="solar" :loading="busy" :labels="labels" @claim="claim" />
  </section>
</template>

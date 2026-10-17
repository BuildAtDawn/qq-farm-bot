<script setup lang="ts">
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import AccountOverviewCards from '@/components/AccountOverviewCards.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useFarmStore } from '@/stores/farm'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const bagStore = useBagStore()
const farmStore = useFarmStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { currentStatusReady } = storeToRefs(statusStore)
const { dashboardItems } = storeToRefs(bagStore)
const status = computed(() => currentStatusReady.value ? statusStore.status : null)
const visibility = useDocumentVisibility()
const illustratedLevels = ref({ crop: 0, mutant: 0 })
const localUptime = ref(0)
function retryStatus() {
  if (currentAccountId.value && !statusStore.loading)
    void statusStore.fetchStatus(currentAccountId.value)
}
const pending = new Map<string, Promise<void>>()
let disposed = false
let generation = 0
let lastBagFetchAt = 0
let lastIllustratedFetchAt = 0

async function refreshResources(accountId: string, requestGeneration: number, force: boolean) {
  if (disposed || visibility.value !== 'visible' || accountId !== currentAccountId.value
    || requestGeneration !== generation || !currentStatusReady.value || !status.value?.connection?.connected) {
    return
  }
  const now = Date.now()
  const tasks: Promise<unknown>[] = []
  if (force || now - lastBagFetchAt >= 2500) {
    lastBagFetchAt = now
    tasks.push(bagStore.fetchBag(accountId))
  }
  if (force || now - lastIllustratedFetchAt >= 60000) {
    lastIllustratedFetchAt = now
    tasks.push((async () => {
      try {
        const headers = { 'x-account-id': accountId }
        const [crop, mutant] = await Promise.all([
          api.get('/api/illustrated', { params: { illustrated_type: 1 }, headers, skipErrorToast: true } as any),
          api.get('/api/illustrated', { params: { illustrated_type: 2 }, headers, skipErrorToast: true } as any),
        ])
        if (disposed || requestGeneration !== generation || accountId !== currentAccountId.value)
          return
        illustratedLevels.value = { crop: Number(crop.data?.data?.level) || 0, mutant: Number(mutant.data?.data?.level) || 0 }
      }
      catch {
        // Keep the last successful levels while the existing API handles authentication failures.
      }
    })())
  }
  await Promise.allSettled(tasks)
}

function refresh(force = false) {
  const accountId = currentAccountId.value
  if (!accountId || disposed || visibility.value !== 'visible')
    return Promise.resolve()
  const key = `${generation}:${accountId}`
  if (pending.has(key))
    return pending.get(key)!
  const requestGeneration = generation
  const request = (async () => {
    if (!statusStore.realtimeConnected || !currentStatusReady.value)
      await statusStore.fetchStatus(accountId)
    await refreshResources(accountId, requestGeneration, force)
  })().catch(() => {}).finally(() => { pending.delete(key) })
  pending.set(key, request)
  return request
}

watch(currentAccountId, (accountId, previousId) => {
  generation++
  illustratedLevels.value = { crop: 0, mutant: 0 }
  localUptime.value = 0
  lastBagFetchAt = 0
  lastIllustratedFetchAt = 0
  if (accountId !== previousId)
    bagStore.clearBag()
  if (accountId)
    statusStore.connectRealtime(accountId)
  void refresh(true)
}, { immediate: true })
watch(() => status.value?.uptime, (uptime) => {
  localUptime.value = Math.max(0, Number(uptime) || 0)
}, { immediate: true })
watch(() => status.value?.connection?.connected, (connected) => {
  if (connected)
    void refresh(true)
})
watch(() => farmStore.fertilizePending, (pending, previous) => {
  if (!pending && previous)
    void refresh()
})
watch(() => JSON.stringify(status.value?.operations || {}), () => {
  void refresh()
})
watch(visibility, (visible) => {
  if (visible === 'visible')
    void refresh(true)
})
useIntervalFn(() => {
  void refresh()
}, 10000)
useIntervalFn(() => {
  if (visibility.value === 'visible' && status.value?.connection?.connected)
    localUptime.value++
}, 1000)
onUnmounted(() => {
  disposed = true
  generation++
})
</script>

<template>
  <AccountOverviewCards
    strip :status="status" :current-status-ready="currentStatusReady" :current-account="currentAccount"
    :dashboard-items="dashboardItems" :illustrated-levels="illustratedLevels" :local-uptime="localUptime"
    :status-error="statusStore.error" :status-loading="statusStore.loading" @retry="retryStatus"
  />
</template>

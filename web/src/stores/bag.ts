import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export const useBagStore = defineStore('bag', () => {
  const allItems = ref<any[]>([])
  const originalItems = ref<any[]>([])
  const loading = ref(false)
  const error = ref('')
  const loadedAccountId = ref('')
  const fertilizerContainers = ref<Record<string, { seconds: number, capacitySeconds: number }> | null>(null)
  const pendingFetches = new Map<string, Promise<void>>()

  function clearBag() {
    allItems.value = []
    originalItems.value = []
    fertilizerContainers.value = null
    loadedAccountId.value = ''
    error.value = ''
  }

  const items = computed(() => {
    const hiddenIds = new Set([1, 1001, 1002, 1101, 1011, 1012, 3001, 3002])
    return allItems.value.filter((it: any) => !hiddenIds.has(Number(it.id || 0)))
  })

  const dashboardItems = computed(() => {
    const targetIds = new Set([1011, 1012, 3001, 3002])
    return allItems.value.filter((it: any) => targetIds.has(Number(it.id || 0)))
  })

  async function fetchBag(accountId: string, force = false) {
    if (!accountId)
      return

    const pending = pendingFetches.get(accountId)
    if (pending) {
      if (!force)
        return pending
      await pending
      return fetchBag(accountId)
    }

    const request = fetchBagOnce(accountId).finally(() => {
      if (pendingFetches.get(accountId) === request)
        pendingFetches.delete(accountId)
      loading.value = pendingFetches.size > 0
    })
    pendingFetches.set(accountId, request)
    loading.value = true
    return request
  }

  async function fetchBagOnce(accountId: string) {
    const requestedId = accountId
    try {
      const res = await api.get('/api/bag', {
        headers: { 'x-account-id': accountId },
      })
      const acc = useAccountStore()
      const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
      if (curId !== requestedId)
        return
      if (res.data.ok && res.data.data) {
        allItems.value = Array.isArray(res.data.data.items) ? res.data.data.items : []
        originalItems.value = Array.isArray(res.data.data.originalItems) ? res.data.data.originalItems : []
        fertilizerContainers.value = res.data.data.fertilizerContainers || null
        loadedAccountId.value = requestedId
        error.value = ''
      }
      else {
        clearBag()
        error.value = String(res.data?.error || '背包读取失败，请重新读取')
      }
    }
    catch (e) {
      const acc = useAccountStore()
      const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
      if (curId === requestedId) {
        clearBag()
        error.value = '背包读取失败，请重新读取'
      }
      console.error(e)
    }
  }

  async function useItem(accountId: string, itemId: number, count = 1, uid = 0) {
    const res = await api.post('/api/bag/use', { itemId, count, uid }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  async function sellItems(accountId: string, items: Array<{ id: number, count: number, uid?: number }>) {
    const res = await api.post('/api/bag/sell', { items }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  async function setItemsLocked(accountId: string, itemUids: number[], locked: boolean) {
    const res = await api.post('/api/bag/lock', { itemUids, locked }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  return { items, allItems, originalItems, dashboardItems, fertilizerContainers, loadedAccountId, error, loading, fetchBag, clearBag, useItem, sellItems, setItemsLocked }
})
